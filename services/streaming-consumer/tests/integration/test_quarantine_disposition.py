"""Slice 11a: deterministic failure → quarantine (direct write) → ACK.

The storm-stopper acceptance criteria against the live stack (5433 + emulators):

- THE STORM-FIX PROOF (exception path): the storm's exact cause — no ACTIVE
  mapping (``MAPPING_CONFIG_INVALID``) — writes a ``quarantined_chunks`` row
  (status=NEW, correlation populated, ``mapping_version_id`` NULL pre-lookup),
  the message ACKS, and a QUARANTINED audit row carries the D78 shape.
- The ROW path: a row-indexed engine failure holds ONLY the failing rows in
  ``quarantined_rows`` (row_offset + failure detail; ``mapping_version_id`` NOT
  NULL); the chunk's good rows behave per the grounded current model (NOT
  written — no partial success exists; bronze is the recoverable source).
- The self-heal EXCLUSION: ``HOT_POSITION_MISSING`` (the D63 miss) still nacks —
  redelivery is its designed recovery once the catalogue/position onboards
  (the governing principle; the store-miss carve-out is proven in
  ``test_failure_disposition.py``).
- The quarantine-WRITE-failure posture: a failing hold falls back to nack on
  both the exception path and the gate path — never ack-and-lose, no
  QUARANTINED audit for an unheld chunk.
- The audit fire-and-forget posture is UNCHANGED: a dead audit writer never
  blocks the hold or the ack (quarantine-write-loud → audit-emit-forget → ack).

Subscriber-level ack/nack (publish → pull → redelivery observation) is proven in
``test_failure_disposition.py``; here ``process_message`` pins the Decision and
the store/audit shapes are read back independently via the admin engine.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text

from dis_core.errors import QuarantineWriteError
from dis_core.ids import new_uuid7
from streaming_consumer.clients.pubsub import process_message
from streaming_consumer.envelope import IngressReadyEvent
from streaming_consumer.orchestrate import ConsumerPipeline
from streaming_consumer.sinks.audit import ConsumerAudit
from streaming_consumer.sinks.quarantine import ConsumerQuarantine

from .conftest import SALE_SOURCE_ID, Cleanup, sale_csv, seed_chunk, ts

if TYPE_CHECKING:
    from sqlalchemy.engine import Engine

    from dis_storage.client import StorageClient

pytestmark = pytest.mark.integration

# No config.source_mappings row exists for this source: the mapping load raises
# MappingConfigError — the empty/invalid-ACTIVE-mapping class that caused the storm.
_UNMAPPED_SOURCE_ID = "sc_nomap_v1"

_GOOD_ROW = ("2026-01-01 10:00:00", "SKU-Q", "1", "9.99", "8.50", "T-Q", "1")


def _payload(chunk_event: IngressReadyEvent) -> bytes:
    return chunk_event.model_dump_json(exclude_none=True).encode()


def _held_counts(dis_admin: Engine, trace_id: object) -> tuple[int, int]:
    with dis_admin.begin() as conn:
        chunks = conn.execute(
            text("SELECT COUNT(*) FROM quarantine.quarantined_chunks WHERE trace_id = CAST(:t AS uuid)"),
            {"t": str(trace_id)},
        ).scalar_one()
        rows = conn.execute(
            text("SELECT COUNT(*) FROM quarantine.quarantined_rows WHERE trace_id = CAST(:t AS uuid)"),
            {"t": str(trace_id)},
        ).scalar_one()
    return int(chunks), int(rows)


def _quarantined_audits(dis_admin: Engine, trace_id: object) -> list[dict[str, object]]:
    with dis_admin.begin() as conn:
        rows = (
            conn.execute(
                text(
                    "SELECT tenant_id::text, trace_id::text, data_ingress_event_id::text, "
                    "mapping_version_id, failure_code, outcome, event_data "
                    "FROM audit.events WHERE trace_id = CAST(:t AS uuid) AND stage = 'QUARANTINED'"
                ),
                {"t": str(trace_id)},
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


async def test_mapping_config_invalid_quarantines_chunk_and_acks(
    pipeline: ConsumerPipeline,
    dis_admin: Engine,
    storage: StorageClient,
    cleanup: Cleanup,
    stack_env: dict[str, str],
) -> None:
    """THE STORM-FIX PROOF: the storm's exact failure is held + acked, D78-correlated."""
    chunk = seed_chunk(
        dis_admin,
        storage,
        cleanup,
        csv_data=sale_csv([_GOOD_ROW]),
        source_id=_UNMAPPED_SOURCE_ID,
        bronze_bucket=stack_env["GCS_BUCKET_BRONZE"],
    )

    decision = await process_message(pipeline, _payload(chunk.event))
    assert decision == "ack", "a quarantined deterministic failure must ACK (the storm fix)"

    with dis_admin.begin() as conn:
        held = conn.execute(
            text(
                "SELECT tenant_id::text, store_id::text, data_ingress_event_id::text, "
                "source_id, dis_channel, gcs_uri, failure_stage, failure_reason, "
                "failure_context, mapping_version_id, row_count_in_chunk, status, "
                "resolved_at "
                "FROM quarantine.quarantined_chunks WHERE trace_id = CAST(:t AS uuid)"
            ),
            {"t": str(chunk.trace_id)},
        ).one()
    # The correlation columns, populated off the envelope + flow context.
    assert held.tenant_id == str(chunk.event.tenant_id)
    assert held.store_id == str(chunk.event.store_id)
    assert held.data_ingress_event_id == str(chunk.bronze_ref)
    assert held.source_id == _UNMAPPED_SOURCE_ID
    assert held.dis_channel == "csv_upload"  # read off the BRONZE row, not assumed
    assert held.gcs_uri == chunk.event.gcs_uri
    # The failure identity: the stable D79 code, the quarantine stage vocabulary,
    # NULL mapping_version_id (the lookup itself failed — known-where, D78).
    assert held.failure_stage == "MAPPING_LOOKUP"
    assert held.failure_reason == "MAPPING_CONFIG_INVALID"
    assert held.failure_context["exception_class"] == "MappingConfigError"
    assert held.mapping_version_id is None
    assert held.row_count_in_chunk == 1
    # The lifecycle: written as NEW (DB default), untouched resolution columns.
    assert held.status == "NEW" and held.resolved_at is None

    # The QUARANTINED audit row carries the D78 failure-audit shape.
    audits = _quarantined_audits(dis_admin, chunk.trace_id)
    assert len(audits) == 1
    audit = audits[0]
    assert audit["tenant_id"] == str(chunk.event.tenant_id)
    assert audit["data_ingress_event_id"] == str(chunk.bronze_ref)
    assert audit["mapping_version_id"] is None  # known-where: the lookup failed
    assert audit["failure_code"] == "MAPPING_CONFIG_INVALID"
    assert audit["outcome"] == "SUCCESS"  # the disposition record; FAILURE row is separate
    assert audit["event_data"]["quarantine_table"] == "quarantined_chunks"  # type: ignore[index]
    assert audit["event_data"]["failed_stage"] == "MAPPING_LOOKED_UP"  # type: ignore[index]

    # The FAILURE record (the pre-11a posture) still landed alongside.
    with dis_admin.begin() as conn:
        failures = conn.execute(
            text(
                "SELECT COUNT(*) FROM audit.events WHERE trace_id = CAST(:t AS uuid) "
                "AND outcome = 'FAILURE' AND failure_code = 'MAPPING_CONFIG_INVALID'"
            ),
            {"t": str(chunk.trace_id)},
        ).scalar_one()
    assert failures == 1


async def test_row_indexed_engine_failure_holds_rows_good_rows_not_written(
    pipeline: ConsumerPipeline,
    dis_admin: Engine,
    storage: StorageClient,
    cleanup: Cleanup,
    stack_env: dict[str, str],
    consumer_mappings: dict[str, int],
) -> None:
    """The ROW path: only the failing row is held; the good row follows the
    grounded current model (whole-chunk, NOT written — no partial success)."""
    bad_row = ("2026-01-01 10:05:00", "SKU-Q2", "abc", "9.99", "8.50", "T-Q2", "2")
    chunk = seed_chunk(
        dis_admin,
        storage,
        cleanup,
        csv_data=sale_csv([(ts(0), "SKU-Q1", "1", "9.99", "8.50", "T-Q1", "1"), bad_row]),
        source_id=SALE_SOURCE_ID,
        bronze_bucket=stack_env["GCS_BUCKET_BRONZE"],
    )

    decision = await process_message(pipeline, _payload(chunk.event))
    assert decision == "ack"

    with dis_admin.begin() as conn:
        held = conn.execute(
            text(
                "SELECT row_offset, row_sha256, failure_stage, failure_reason, failure_context, "
                "mapping_version_id, status, gcs_uri "
                "FROM quarantine.quarantined_rows WHERE trace_id = CAST(:t AS uuid)"
            ),
            {"t": str(chunk.trace_id)},
        ).all()
        canonical = conn.execute(
            text("SELECT COUNT(*) FROM canonical.store_sku_sale_events WHERE trace_id = CAST(:t AS uuid)"),
            {"t": str(chunk.trace_id)},
        ).scalar_one()
    assert len(held) == 1, "exactly the FAILING row is held (one record per distinct row)"
    row = held[0]
    assert row.row_offset == 1  # the second data row (qty='abc')
    assert row.row_sha256 is None  # no row hash exists at gate time (by design)
    assert row.failure_stage == "MAPPING_EXECUTION"
    assert row.failure_reason == "VALIDATION_ROW_FAILED"
    assert row.failure_context["failures"], "column/check/reason detail rides failure_context"
    assert row.mapping_version_id == consumer_mappings[SALE_SOURCE_ID]  # NOT NULL + FK satisfied
    assert row.status == "NEW"
    assert row.gcs_uri == chunk.event.gcs_uri  # the raw row stays in GCS, located by uri+offset
    # The grounded current model: NO partial success — the good row is not written
    # (recoverable from bronze via a future replay), and the chunk acked.
    assert canonical == 0

    audits = _quarantined_audits(dis_admin, chunk.trace_id)
    assert len(audits) == 1
    assert audits[0]["failure_code"] == "VALIDATION_ROW_FAILED"
    assert audits[0]["mapping_version_id"] == consumer_mappings[SALE_SOURCE_ID]
    assert audits[0]["event_data"]["quarantine_table"] == "quarantined_rows"  # type: ignore[index]
    assert audits[0]["event_data"]["held"] == 1  # type: ignore[index]


async def test_hot_position_missing_is_excluded_and_still_nacks(
    pipeline: ConsumerPipeline,
    dis_admin: Engine,
    storage: StorageClient,
    cleanup: Cleanup,
    stack_env: dict[str, str],
) -> None:
    """The governing principle: the D63 miss self-heals via redelivery once the
    position onboards, so it is NOT quarantinable — today's nack is preserved."""
    sku = f"QHM-{new_uuid7().hex[:10]}"
    cleanup.skus.append(sku)
    # A valid sale chunk whose hot row was never seeded: gates pass, the
    # INCOMPLETE-mapping hot merge misses, write_chunk raises loudly.
    chunk = seed_chunk(
        dis_admin,
        storage,
        cleanup,
        csv_data=sale_csv([(ts(0), sku, "1", "9.99", "8.50", "T-QHM", "1")]),
        source_id=SALE_SOURCE_ID,
        bronze_bucket=stack_env["GCS_BUCKET_BRONZE"],
    )

    decision = await process_message(pipeline, _payload(chunk.event))
    assert decision == "nack", "HOT_POSITION_MISSING keeps the self-heal nack (excluded from 11a)"
    assert _held_counts(dis_admin, chunk.trace_id) == (0, 0)
    assert _quarantined_audits(dis_admin, chunk.trace_id) == []
    with dis_admin.begin() as conn:
        failures = conn.execute(
            text(
                "SELECT COUNT(*) FROM audit.events WHERE trace_id = CAST(:t AS uuid) "
                "AND outcome = 'FAILURE' AND failure_code = 'HOT_POSITION_MISSING'"
            ),
            {"t": str(chunk.trace_id)},
        ).scalar_one()
    assert failures == 1  # audit-and-nack unchanged


class _ExplodingQuarantine(ConsumerQuarantine):
    """A quarantine sink whose holds always fail — the store-down shape."""

    def __init__(self) -> None:  # no writer needed; every hold explodes first
        super().__init__(writer=None)  # type: ignore[arg-type]

    async def hold_chunk_failure(self, *args: object, **kwargs: object) -> None:
        raise QuarantineWriteError("quarantine store down (induced)")

    async def hold_row_failures(self, *args: object, **kwargs: object) -> int:
        raise QuarantineWriteError("quarantine store down (induced)")


async def test_quarantine_write_failure_nacks_never_ack_and_lose(
    pipeline: ConsumerPipeline,
    dis_admin: Engine,
    storage: StorageClient,
    cleanup: Cleanup,
    stack_env: dict[str, str],
) -> None:
    """Posture E on BOTH paths: a failing hold falls back to nack — the message
    stays live (the DLQ backstops); no QUARANTINED audit for an unheld chunk."""
    broken = ConsumerPipeline(
        engine=pipeline.engine,
        storage=pipeline.storage,
        audit=pipeline.audit,
        quarantine=_ExplodingQuarantine(),
        bronze_bucket=pipeline.bronze_bucket,
    )

    # Exception path: the storm failure itself, with the store down → nack.
    exc_chunk = seed_chunk(
        dis_admin,
        storage,
        cleanup,
        csv_data=sale_csv([_GOOD_ROW]),
        source_id=_UNMAPPED_SOURCE_ID,
        bronze_bucket=stack_env["GCS_BUCKET_BRONZE"],
    )
    assert await process_message(broken, _payload(exc_chunk.event)) == "nack"
    assert _held_counts(dis_admin, exc_chunk.trace_id) == (0, 0)
    assert _quarantined_audits(dis_admin, exc_chunk.trace_id) == []
    with dis_admin.begin() as conn:
        failures = conn.execute(
            text(
                "SELECT COUNT(*) FROM audit.events WHERE trace_id = CAST(:t AS uuid) AND outcome = 'FAILURE'"
            ),
            {"t": str(exc_chunk.trace_id)},
        ).scalar_one()
    assert failures >= 1  # the FAILURE audit landed before the hold attempt

    # Gate path: a row-indexed failure with the store down → the pre-11a
    # failed_* disposition → nack.
    gate_chunk = seed_chunk(
        dis_admin,
        storage,
        cleanup,
        csv_data=sale_csv([("2026-01-01 10:00:00", "SKU-QF", "abc", "9.99", "8.50", "T-QF", "1")]),
        source_id=SALE_SOURCE_ID,
        bronze_bucket=stack_env["GCS_BUCKET_BRONZE"],
    )
    assert await process_message(broken, _payload(gate_chunk.event)) == "nack"
    assert _held_counts(dis_admin, gate_chunk.trace_id) == (0, 0)
    assert _quarantined_audits(dis_admin, gate_chunk.trace_id) == []


class _DeadAuditWriter:
    """An audit backend that always fails — the audit-store-down shape."""

    async def write(self, event: object) -> bool:
        raise ConnectionError("audit store down (induced)")


async def test_dead_audit_writer_never_blocks_the_hold_or_the_ack(
    pipeline: ConsumerPipeline,
    dis_admin: Engine,
    storage: StorageClient,
    cleanup: Cleanup,
    stack_env: dict[str, str],
) -> None:
    """Hard rule 11 unchanged, and the load-bearing ordering: quarantine-write-loud
    → audit-emit-forget → ack. A dead audit writer drops the QUARANTINED record
    but the chunk is still HELD and still ACKED."""
    deaf = ConsumerPipeline(
        engine=pipeline.engine,
        storage=pipeline.storage,
        audit=ConsumerAudit(_DeadAuditWriter()),
        quarantine=pipeline.quarantine,
        bronze_bucket=pipeline.bronze_bucket,
    )
    chunk = seed_chunk(
        dis_admin,
        storage,
        cleanup,
        csv_data=sale_csv([_GOOD_ROW]),
        source_id=_UNMAPPED_SOURCE_ID,
        bronze_bucket=stack_env["GCS_BUCKET_BRONZE"],
    )
    assert await process_message(deaf, _payload(chunk.event)) == "ack"
    chunks_held, _ = _held_counts(dis_admin, chunk.trace_id)
    assert chunks_held == 1, "the hold succeeded despite the dead audit writer"
    assert _quarantined_audits(dis_admin, chunk.trace_id) == []  # the emit was dropped, not the ack
