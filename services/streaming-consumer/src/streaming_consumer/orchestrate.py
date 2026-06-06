"""Per-event stage orchestration: fetch → load → gate → map → gate → write.

(Named ``orchestrate.py``: a top-level ``pipeline.py`` cannot coexist with the
``pipeline/`` package; repo-structure reserves no orchestrator name.)

Stage order (one concern per function, code-quality rule 7):

1. fetch            — cross-check + bronze read + GCS download (D5, D53, rule 9)
2. mapping load     — per-lookup ACTIVE mapping (D6); routing (sale-vs-change)
3. store read       — sale path only: tax_treatment denormalization source
4. pre-validation   — source-shape suite (D13/D18); failure → disposition
5. engine           — the pure four sub-stages; ANY cell failure → disposition
                      (no B2 threshold, no per-row split — Slice 11)
6. post-validation  — canonical-shape suite + drift guard; failure → disposition
7. dual-write       — mapping_version_id stamp (D22) + atomic hot+event (D30)
8. duplicate audit  — D42 ROW events for dedup-key hits (read-time-dedup posture)

**Minimal failure disposition (audit-and-nack):** a failing chunk gets a FAILURE
audit (fire-and-forget) and a ``failed_*`` disposition the subscriber NACKS —
never silently dropped (bronze remains the recoverable source, D5; the message
stays live for Slice 11's quarantine), never partially written (validation
precedes the write; write failures roll the batch back, D30). Deterministic
failures therefore redeliver until Slice 11 lands — the accepted interim posture
(service CLAUDE.md). Exceptions propagate after the FAILURE audit; the subscriber
nacks those too.

The consumer reads ``trace_id`` and identity off the event and mints neither
(hard rule 4); any IDs it does mint (event-row ids) come from dis-core ``ids``.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable
from dataclasses import dataclass, field
from typing import Literal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from dis_audit import EventScope, FailureCode, Outcome, Stage, failure_code_for
from dis_canonical import StoreSkuSaleEvent
from dis_core.logging import get_logger
from dis_rls import rls_session
from streaming_consumer.config import BATCH_SIZE_ROW_PAIRS, SERVICE_NAME
from streaming_consumer.envelope import IngressReadyEvent
from streaming_consumer.pipeline.fetch import FetchedChunk, ObjectStore, fetch_chunk, read_store_tax_treatment
from streaming_consumer.pipeline.mapping import (
    LoadedMapping,
    apply_loaded_mapping,
    load_active_mapping,
)
from streaming_consumer.pipeline.normalize import build_event_rows
from streaming_consumer.pipeline.validate_post import run_post_validation
from streaming_consumer.pipeline.validate_pre import run_pre_validation
from streaming_consumer.sinks.audit import ConsumerAudit
from streaming_consumer.sinks.canonical import WriteReport, write_chunk

_log = get_logger(SERVICE_NAME)

Disposition = Literal[
    "written",
    "failed_pre_validation",
    "failed_mapping",
    "failed_post_validation",
]


@dataclass(frozen=True)
class ConsumeOutcome:
    """What one ingress.ready event produced. The subscriber acks ONLY 'written'."""

    disposition: Disposition
    report: WriteReport | None = None


# The gate-summary failure codes per validating stage (Slice 30b stable vocabulary).
_GATE_FAILURE_CODES: dict[Stage, FailureCode] = {
    Stage.PRE_MAPPING_VALIDATED: FailureCode.PRE_VALIDATION_FAILED,
    Stage.MAPPING_EXECUTED: FailureCode.MAPPING_EXECUTION_FAILED,
    Stage.POST_MAPPING_VALIDATED: FailureCode.POST_VALIDATION_FAILED,
}


@dataclass
class _FlowContext:
    """What the catch-all needs to know about a partially-processed event.

    ``_process`` records the correlation ids as they become known (post-fetch →
    ``bronze_id``; post-lookup → ``mapping_version_id``) so a FAILURE audit never
    buries an id it knows in ``failure_message`` (the Slice 30b failure-audit
    shape — the seam the quarantine work consumes). ``lap()`` is the per-stage
    duration seam: stages run strictly sequentially, so elapsed-since-the-
    previous-audit-point IS the stage span (at audit grain — small non-emitting
    work like the tax read rides the following stage's lap; not micro-profiled).
    """

    bronze_id: UUID | None = None
    mapping_version_id: int | None = None
    _mark: float = field(default_factory=time.monotonic)

    def lap(self) -> int:
        now = time.monotonic()
        elapsed_ms = int((now - self._mark) * 1000)
        self._mark = now
        return max(elapsed_ms, 0)


@dataclass
class ConsumerPipeline:
    """One consumer process's wired dependencies (caller-owned, 9b pattern)."""

    engine: AsyncEngine
    storage: ObjectStore
    audit: ConsumerAudit
    bronze_bucket: str
    batch_size: int = BATCH_SIZE_ROW_PAIRS

    async def process(self, event: IngressReadyEvent) -> ConsumeOutcome:
        """Run one event through the pipeline.

        Raises on infrastructure/contract errors AFTER emitting a FAILURE audit
        where identity is known; the subscriber nacks any raise (audit-and-nack).
        The FAILURE audit carries every correlation id known at the point of
        failure (``_FlowContext``) and a stable ``FailureCode`` — never a bare
        exception class name (Slice 30b failure-audit shape).
        """
        stage = Stage.RECEIVED
        ctx = _FlowContext()
        try:
            return await self._process(event, ctx)
        except Exception as exc:
            stage = getattr(exc, "_dis_stage", stage)
            await self.audit.emit(
                stage=stage if isinstance(stage, Stage) else Stage.RECEIVED,
                outcome=Outcome.FAILURE,
                tenant_id=event.tenant_id,
                trace_id=event.trace_id,
                bronze_id=ctx.bronze_id,
                mapping_version_id=ctx.mapping_version_id,
                duration_ms=ctx.lap(),
                failure_code=failure_code_for(exc),
                failure_message=str(exc)[:2000],
                # The class name is always preserved (the no-information-loss rule
                # behind the INFRA_FAILURE fallback; harmless for mapped codes).
                event_data={"exception_class": type(exc).__name__},
            )
            raise

    async def _process(self, event: IngressReadyEvent, ctx: _FlowContext) -> ConsumeOutcome:
        log = _log.bind(stage="pipeline", tenant_id=str(event.tenant_id), trace_id=str(event.trace_id))
        tenant_id, trace_id = event.tenant_id, event.trace_id

        # 0. Redelivery detection (Slice 30b): best-effort audit readback so a
        #    redelivered chunk's intake is legible as RETRIED rather than an
        #    indistinguishable duplicate SUCCESS row.
        seen_before = await self._seen_before(tenant_id, trace_id)

        # 1. Fetch (intake + bronze + GCS; the chunk arrives tokenized, D24).
        fetched = await self._staged(
            Stage.RECEIVED,
            fetch_chunk(self.engine, self.storage, event, bronze_bucket=self.bronze_bucket),
        )
        ctx.bronze_id = fetched.bronze.bronze_id
        await self.audit.emit(
            stage=Stage.RECEIVED,
            outcome=Outcome.RETRIED if seen_before else Outcome.SUCCESS,
            tenant_id=tenant_id,
            trace_id=trace_id,
            bronze_id=fetched.bronze.bronze_id,
            row_count=fetched.frame.height,
            duration_ms=ctx.lap(),
            event_data={"columns": len(fetched.frame.columns), "dis_channel": fetched.bronze.dis_channel},
        )

        # 2. Mapping load (per-lookup side-input, D6) + routing.
        loaded = await self._staged(Stage.MAPPING_LOOKED_UP, load_active_mapping(self.engine, event))
        ctx.mapping_version_id = loaded.mapping_version_id
        await self.audit.emit(
            stage=Stage.MAPPING_LOOKED_UP,
            outcome=Outcome.SUCCESS,
            tenant_id=tenant_id,
            trace_id=trace_id,
            bronze_id=fetched.bronze.bronze_id,
            mapping_version_id=loaded.mapping_version_id,
            duration_ms=ctx.lap(),
            event_data={
                "target_model": loaded.target_model.__name__,
                "source_id": event.source_id,
                # Slice 8a (D71): the template the lookup keyed on, additive.
                "template_id": str(event.template_id),
            },
        )

        # 3. Sale path: the store row's tax_treatment (a data read, not identity
        #    validation — D39's FK is the enforcement; no Identity Service, D28).
        tax_treatment: str | None = None
        if loaded.target_model is StoreSkuSaleEvent:
            tax_treatment = await self._staged(
                Stage.MAPPING_LOOKED_UP, read_store_tax_treatment(self.engine, event)
            )

        # 4. Pre-mapping (source-shape) gate — D13: semantic validation lives here.
        pre = run_pre_validation(loaded, fetched.frame, tenant_id=str(tenant_id), trace_id=str(trace_id))
        if not pre.passed:
            await self._emit_gate_failure(
                Stage.PRE_MAPPING_VALIDATED,
                event,
                fetched,
                loaded,
                ctx,
                failures=[(f.column, f.row_index, f.check, f.reason) for f in pre.failures],
            )
            return ConsumeOutcome(disposition="failed_pre_validation")
        await self.audit.emit(
            stage=Stage.PRE_MAPPING_VALIDATED,
            outcome=Outcome.SUCCESS,
            tenant_id=tenant_id,
            trace_id=trace_id,
            bronze_id=fetched.bronze.bronze_id,
            mapping_version_id=loaded.mapping_version_id,
            row_count=fetched.frame.height,
            duration_ms=ctx.lap(),
        )

        # 5. The four sub-stages (pure engine). ANY failed cell fails the chunk —
        #    the minimal disposition has no per-row split (Slice 11).
        result = apply_loaded_mapping(loaded, fetched.frame, tenant_id=str(tenant_id), trace_id=str(trace_id))
        if result.failures:
            await self._emit_gate_failure(
                Stage.MAPPING_EXECUTED,
                event,
                fetched,
                loaded,
                ctx,
                failures=[(f.column, f.row_index, f"{f.stage}:{f.op}", f.reason) for f in result.failures],
            )
            return ConsumeOutcome(disposition="failed_mapping")
        await self.audit.emit(
            stage=Stage.MAPPING_EXECUTED,
            outcome=Outcome.SUCCESS,
            tenant_id=tenant_id,
            trace_id=trace_id,
            bronze_id=fetched.bronze.bronze_id,
            mapping_version_id=loaded.mapping_version_id,
            row_count=fetched.frame.height,
            rows_succeeded=result.contribution.height,
            rows_failed=0,
            duration_ms=ctx.lap(),
        )

        # 6. Post-mapping (canonical-shape) gate + the drift guard (ERRORS, never skips).
        post = run_post_validation(
            loaded, result.contribution, tenant_id=str(tenant_id), trace_id=str(trace_id)
        )
        if not post.passed:
            await self._emit_gate_failure(
                Stage.POST_MAPPING_VALIDATED,
                event,
                fetched,
                loaded,
                ctx,
                failures=[(f.column, f.row_index, f.check, f.reason) for f in post.failures],
            )
            return ConsumeOutcome(disposition="failed_post_validation")
        await self.audit.emit(
            stage=Stage.POST_MAPPING_VALIDATED,
            outcome=Outcome.SUCCESS,
            tenant_id=tenant_id,
            trace_id=trace_id,
            bronze_id=fetched.bronze.bronze_id,
            mapping_version_id=loaded.mapping_version_id,
            row_count=result.contribution.height,
            duration_ms=ctx.lap(),
        )

        # 7. mapping_version_id stamp (D22) + the atomic dual-write (D30).
        rows = build_event_rows(event, fetched.bronze, loaded, result, tax_treatment=tax_treatment)
        report = await self._staged(
            Stage.CANONICAL_WRITTEN,
            write_chunk(
                self.engine,
                event,
                loaded,
                rows,
                dis_channel=fetched.bronze.dis_channel,
                tax_treatment=tax_treatment,
                batch_size=self.batch_size,
            ),
        )
        await self.audit.emit(
            stage=Stage.CANONICAL_WRITTEN,
            outcome=Outcome.SUCCESS,
            tenant_id=tenant_id,
            trace_id=trace_id,
            bronze_id=fetched.bronze.bronze_id,
            mapping_version_id=loaded.mapping_version_id,
            row_count=report.event_rows_written,
            rows_succeeded=report.event_rows_written,
            duration_ms=ctx.lap(),
            event_data={
                "written_to_table": report.written_to_table,
                "hot_rows_upserted": report.hot_rows_upserted,
                "hot_noops": report.hot_noops,
                "batches": report.batches,
                "duplicates": len(report.duplicates),
            },
        )

        # 8. D42 duplicate detail: one ROW-scoped event per dedup-key hit.
        for hit in report.duplicates:
            await self.audit.emit_duplicate(
                hit,
                tenant_id=tenant_id,
                store_id=event.store_id,
                source_id=event.source_id,
                trace_id=trace_id,
                bronze_id=fetched.bronze.bronze_id,
                mapping_version_id=loaded.mapping_version_id,
            )

        log.info(
            "chunk written: %s event rows, %s hot upserts, %s duplicates",
            report.event_rows_written,
            report.hot_rows_upserted,
            len(report.duplicates),
        )
        return ConsumeOutcome(disposition="written", report=report)

    async def _emit_gate_failure(
        self,
        stage: Stage,
        event: IngressReadyEvent,
        fetched: FetchedChunk,
        loaded: LoadedMapping,
        ctx: _FlowContext,
        *,
        failures: list[tuple[str | None, int | None, str, str]],
    ) -> None:
        """One INGRESS_EVENT FAILURE summary + ROW-scoped events (Option B).

        Slice 30b stable vocabulary: the summary carries the per-gate
        ``FailureCode``; ROW events carry ``VALIDATION_ROW_FAILED`` with the
        pandera check name in ``event_data["check"]`` (an unbounded vocabulary
        cannot be enum members; column/reason stay in ``failure_message``).
        """
        await self.audit.emit(
            stage=stage,
            outcome=Outcome.FAILURE,
            tenant_id=event.tenant_id,
            trace_id=event.trace_id,
            bronze_id=fetched.bronze.bronze_id,
            mapping_version_id=loaded.mapping_version_id,
            row_count=fetched.frame.height,
            rows_failed=len(failures),
            duration_ms=ctx.lap(),
            failure_code=_GATE_FAILURE_CODES[stage],
            failure_message=f"{len(failures)} failure(s); chunk nacked (Slice 10 minimal disposition)",
        )
        for column, row_index, check, reason in failures:
            await self.audit.emit(
                stage=stage,
                outcome=Outcome.FAILURE,
                scope=EventScope.ROW,
                tenant_id=event.tenant_id,
                trace_id=event.trace_id,
                bronze_id=fetched.bronze.bronze_id,
                mapping_version_id=loaded.mapping_version_id,
                row_offset=row_index,
                failure_code=FailureCode.VALIDATION_ROW_FAILED,
                event_data={"check": check[:256]},
                # Reasons are column/check-grained and never carry cell values
                # (dis-validation/dis-mapping contract: values are quarantine
                # payload, never logged or audited here).
                failure_message=f"column={column}: {reason}"[:2000],
            )

    async def _seen_before(self, tenant_id: UUID, trace_id: UUID) -> bool:
        """Best-effort redelivery detection for the RETRIED outcome (Slice 30b).

        One indexed read (``ix_audit_events_trace_id``) for a prior RECEIVED row
        emitted by THIS service for the same trace. Fire-and-forget like every
        audit concern: a read failure degrades to ``False`` (the intake emits
        SUCCESS) — it never wedges or fails the data path. Best-effort by design:
        audit is itself fire-and-forget, so a missing prior row simply re-reads
        as a first delivery (D44 tolerates the duplicate-shaped result).

        Upgrade path (the quarantine work): once a dead-letter policy exists on
        the subscription, Pub/Sub populates ``delivery_attempt`` on the pull
        response — a transport-level signal that replaces this readback.
        """
        try:
            async with rls_session(self.engine, tenant_id) as conn:
                row = (
                    await conn.execute(
                        text(
                            "SELECT 1 FROM audit.events "
                            "WHERE trace_id = :trace_id AND service_name = :service "
                            "AND stage = 'RECEIVED' LIMIT 1"
                        ),
                        {"trace_id": trace_id, "service": SERVICE_NAME},
                    )
                ).first()
            return row is not None
        except Exception:  # noqa: BLE001 — audit-side read; never blocks the data path
            _log.bind(stage="redelivery_check", tenant_id=str(tenant_id), trace_id=str(trace_id)).warning(
                "redelivery readback failed; assuming first delivery (best-effort)", exc_info=True
            )
            return False

    @staticmethod
    async def _staged[T](stage: Stage, awaitable: Awaitable[T]) -> T:
        """Tag in-flight exceptions with the stage they died in (for the FAILURE audit)."""
        try:
            return await awaitable
        except Exception as exc:
            exc._dis_stage = stage  # type: ignore[attr-defined]  # noqa: SLF001
            raise
