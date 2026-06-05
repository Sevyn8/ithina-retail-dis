"""AC10: audit is fire-and-forget; the D42 duplicate representation is emitted.

- An injected audit-writer failure (raises on every write) does NOT stop the
  data path: the chunk still lands (logged, never raised — hard rule 11).
- The duplicate path (a redelivered chunk) emits ROW-scoped CANONICAL_WRITTEN
  events whose ``event_data`` carries the D42 representation: the
  ``DUPLICATE_NOOP``/``DUPLICATE_OVERWRITTEN`` distinction, ``prior_trace_id``,
  ``row_hash``, and the dedup key — within the live outcome CHECK (SUCCESS).
- Duplicate audit rows are tolerated (D44): the second delivery re-emits the
  same stages under the same trace; both sets exist.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text
from streaming_consumer.orchestrate import ConsumerPipeline
from streaming_consumer.sinks.audit import ConsumerAudit

from dis_audit import AuditEvent
from dis_core.ids import new_uuid7

from .conftest import SALE_SOURCE_ID, Cleanup, sale_csv, seed_chunk, seed_hot_row, ts

if TYPE_CHECKING:
    from sqlalchemy.engine import Engine

    from dis_storage.client import StorageClient

pytestmark = pytest.mark.integration


class _ExplodingWriter:
    """An audit writer that always raises — the injected failure."""

    async def write(self, event: AuditEvent) -> bool:
        raise RuntimeError("injected audit backend failure")


async def test_audit_failure_never_blocks_the_data_path(
    pipeline: ConsumerPipeline,
    dis_admin: Engine,
    storage: StorageClient,
    cleanup: Cleanup,
    stack_env: dict[str, str],
    consumer_mappings: dict[str, int],
) -> None:
    pipeline.audit = ConsumerAudit(_ExplodingWriter())  # inject the failure
    sku = f"AU-{new_uuid7().hex[:10]}"
    seed_hot_row(dis_admin, cleanup, sku_id=sku, mapping_version_id=consumer_mappings[SALE_SOURCE_ID])
    chunk = seed_chunk(
        dis_admin,
        storage,
        cleanup,
        csv_data=sale_csv([(ts(0), sku, "1", "9.99", "9.50", "T-AU", "1")]),
        source_id=SALE_SOURCE_ID,
        bronze_bucket=stack_env["GCS_BUCKET_BRONZE"],
    )

    outcome = await pipeline.process(chunk.event)  # must NOT raise (hard rule 11)
    assert outcome.disposition == "written"

    with dis_admin.begin() as conn:
        rows = conn.execute(
            text("SELECT COUNT(*) FROM canonical.store_sku_sale_events WHERE trace_id = CAST(:t AS uuid)"),
            {"t": str(chunk.trace_id)},
        ).scalar_one()
    assert rows == 1  # the data path completed despite every audit write failing


async def test_duplicate_path_emits_d42_event_data(
    pipeline: ConsumerPipeline,
    dis_admin: Engine,
    storage: StorageClient,
    cleanup: Cleanup,
    stack_env: dict[str, str],
    consumer_mappings: dict[str, int],
) -> None:
    sku = f"AU-{new_uuid7().hex[:10]}"
    txn = f"T-{new_uuid7().hex[:8]}"
    seed_hot_row(dis_admin, cleanup, sku_id=sku, mapping_version_id=consumer_mappings[SALE_SOURCE_ID])
    chunk = seed_chunk(
        dis_admin,
        storage,
        cleanup,
        csv_data=sale_csv([(ts(0), sku, "2", "9.99", "8.50", txn, "1")]),
        source_id=SALE_SOURCE_ID,
        bronze_bucket=stack_env["GCS_BUCKET_BRONZE"],
    )
    assert (await pipeline.process(chunk.event)).disposition == "written"

    # Redelivery: identical payload -> DUPLICATE_NOOP under the same trace.
    assert (await pipeline.process(chunk.event)).disposition == "written"

    # A correction (same dedup key, different payload, new bronze) -> OVERWRITTEN.
    correction = seed_chunk(
        dis_admin,
        storage,
        cleanup,
        csv_data=sale_csv([(ts(45), sku, "3", "9.99", "8.50", txn, "1")]),
        source_id=SALE_SOURCE_ID,
        bronze_bucket=stack_env["GCS_BUCKET_BRONZE"],
    )
    assert (await pipeline.process(correction.event)).disposition == "written"

    with dis_admin.begin() as conn:
        duplicate_rows = (
            conn.execute(
                text(
                    "SELECT trace_id, event_data FROM audit.events "
                    "WHERE event_scope = 'ROW' AND stage = 'CANONICAL_WRITTEN' "
                    "AND outcome = 'SUCCESS' AND trace_id = ANY(:traces) "
                    "AND event_data ? 'duplicate'"
                ),
                {"traces": [chunk.trace_id, correction.trace_id]},
            )
            .mappings()
            .all()
        )
        same_trace_stage_rows = conn.execute(
            text(
                "SELECT COUNT(*) FROM audit.events WHERE trace_id = CAST(:t AS uuid) "
                "AND stage = 'CANONICAL_WRITTEN' AND event_scope = 'INGRESS_EVENT'"
            ),
            {"t": str(chunk.trace_id)},
        ).scalar_one()

    by_kind = {row["event_data"]["duplicate"]: row for row in duplicate_rows}
    assert "DUPLICATE_NOOP" in by_kind, "redelivery did not emit the NOOP detail"
    assert "DUPLICATE_OVERWRITTEN" in by_kind, "the correction did not emit OVERWRITTEN"

    noop = by_kind["DUPLICATE_NOOP"]["event_data"]
    assert noop["prior_trace_id"] == str(chunk.trace_id)
    assert noop["dedup_key"]["source_event_id"] == f"{txn}:1"
    assert noop["dedup_key"]["source_id"] == SALE_SOURCE_ID
    assert "row_hash" in noop

    overwritten = by_kind["DUPLICATE_OVERWRITTEN"]["event_data"]
    assert overwritten["prior_trace_id"] == str(chunk.trace_id)

    # D44: the redelivery re-emitted CANONICAL_WRITTEN under the same trace —
    # duplicate audit rows exist and are tolerated, not prevented.
    assert same_trace_stage_rows >= 2
