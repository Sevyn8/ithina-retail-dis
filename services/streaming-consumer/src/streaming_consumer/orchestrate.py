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

from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncEngine

from dis_audit import EventScope, Outcome, Stage
from dis_canonical import StoreSkuSaleEvent
from dis_core.logging import get_logger
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
        """
        stage = Stage.RECEIVED
        try:
            return await self._process(event)
        except Exception as exc:
            stage = getattr(exc, "_dis_stage", stage)
            await self.audit.emit(
                stage=stage if isinstance(stage, Stage) else Stage.RECEIVED,
                outcome=Outcome.FAILURE,
                tenant_id=event.tenant_id,
                trace_id=event.trace_id,
                failure_code=type(exc).__name__,
                failure_message=str(exc)[:2000],
            )
            raise

    async def _process(self, event: IngressReadyEvent) -> ConsumeOutcome:
        log = _log.bind(stage="pipeline", tenant_id=str(event.tenant_id), trace_id=str(event.trace_id))
        tenant_id, trace_id = event.tenant_id, event.trace_id

        # 1. Fetch (intake + bronze + GCS; the chunk arrives tokenized, D24).
        fetched = await self._staged(
            Stage.RECEIVED,
            fetch_chunk(self.engine, self.storage, event, bronze_bucket=self.bronze_bucket),
        )
        await self.audit.emit(
            stage=Stage.RECEIVED,
            outcome=Outcome.SUCCESS,
            tenant_id=tenant_id,
            trace_id=trace_id,
            bronze_id=fetched.bronze.bronze_id,
            row_count=fetched.frame.height,
            event_data={"columns": len(fetched.frame.columns), "dis_channel": fetched.bronze.dis_channel},
        )

        # 2. Mapping load (per-lookup side-input, D6) + routing.
        loaded = await self._staged(Stage.MAPPING_LOOKED_UP, load_active_mapping(self.engine, event))
        await self.audit.emit(
            stage=Stage.MAPPING_LOOKED_UP,
            outcome=Outcome.SUCCESS,
            tenant_id=tenant_id,
            trace_id=trace_id,
            bronze_id=fetched.bronze.bronze_id,
            mapping_version_id=loaded.mapping_version_id,
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
        *,
        failures: list[tuple[str | None, int | None, str, str]],
    ) -> None:
        """One INGRESS_EVENT FAILURE summary + ROW-scoped events (Option B)."""
        await self.audit.emit(
            stage=stage,
            outcome=Outcome.FAILURE,
            tenant_id=event.tenant_id,
            trace_id=event.trace_id,
            bronze_id=fetched.bronze.bronze_id,
            mapping_version_id=loaded.mapping_version_id,
            row_count=fetched.frame.height,
            rows_failed=len(failures),
            failure_code=str(stage.value),
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
                failure_code=check[:64],
                # Reasons are column/check-grained and never carry cell values
                # (dis-validation/dis-mapping contract: values are quarantine
                # payload, never logged or audited here).
                failure_message=f"column={column}: {reason}"[:2000],
            )

    @staticmethod
    async def _staged[T](stage: Stage, awaitable: Awaitable[T]) -> T:
        """Tag in-flight exceptions with the stage they died in (for the FAILURE audit)."""
        try:
            return await awaitable
        except Exception as exc:
            exc._dis_stage = stage  # type: ignore[attr-defined]  # noqa: SLF001
            raise
