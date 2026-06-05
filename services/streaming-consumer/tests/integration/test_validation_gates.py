"""AC5: both validation gates, both ways — and the D13 posture.

- Pre-mapping (source-shape) REJECTS a structurally wrong chunk (a required
  source column absent) and ACCEPTS a well-formed one.
- Post-mapping (canonical-shape) REJECTS a contribution that maps to an invalid
  canonical frame (the bad-subtype mapping derives ``event_subtype='GIFT'``,
  off the model's enum vocab) and ACCEPTS a valid one.
- Failures take the minimal disposition: a ``failed_*`` outcome (the subscriber
  nacks it), ZERO canonical rows, and FAILURE audit rows (D13: the consumer is
  where semantic validation lives — the receiver stayed permissive).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text
from streaming_consumer.orchestrate import ConsumerPipeline

from dis_core.ids import new_uuid7

from .conftest import (
    BAD_SUBTYPE_SOURCE_ID,
    SALE_SOURCE_ID,
    Cleanup,
    sale_csv,
    seed_chunk,
    seed_hot_row,
    ts,
)

if TYPE_CHECKING:
    from sqlalchemy.engine import Engine

    from dis_storage.client import StorageClient

pytestmark = pytest.mark.integration


def _no_canonical_rows(dis_admin: Engine, trace_id: object) -> bool:
    with dis_admin.begin() as conn:
        sale = conn.execute(
            text("SELECT COUNT(*) FROM canonical.store_sku_sale_events WHERE trace_id = CAST(:t AS uuid)"),
            {"t": str(trace_id)},
        ).scalar_one()
        change = conn.execute(
            text("SELECT COUNT(*) FROM canonical.store_sku_change_events WHERE trace_id = CAST(:t AS uuid)"),
            {"t": str(trace_id)},
        ).scalar_one()
    return int(sale) == 0 and int(change) == 0


def _failure_audit_rows(dis_admin: Engine, trace_id: object, stage: str) -> int:
    with dis_admin.begin() as conn:
        return int(
            conn.execute(
                text(
                    "SELECT COUNT(*) FROM audit.events WHERE trace_id = CAST(:t AS uuid) "
                    "AND stage = :stage AND outcome = 'FAILURE'"
                ),
                {"t": str(trace_id), "stage": stage},
            ).scalar_one()
        )


async def test_pre_validation_rejects_structurally_wrong_chunk(
    pipeline: ConsumerPipeline,
    dis_admin: Engine,
    storage: StorageClient,
    cleanup: Cleanup,
    stack_env: dict[str, str],
) -> None:
    # The sale mapping requires sold_at/sku/qty/retail/price/txn/line; this chunk
    # is missing 'qty' entirely — structural drift, caught PRE-mapping (D62
    # reactive posture).
    bad_csv = b"sold_at,sku,retail,price,txn,line\n2026-01-01 10:00:00,X,9.99,8.50,T,1\n"
    chunk = seed_chunk(
        dis_admin,
        storage,
        cleanup,
        csv_data=bad_csv,
        source_id=SALE_SOURCE_ID,
        bronze_bucket=stack_env["GCS_BUCKET_BRONZE"],
    )
    outcome = await pipeline.process(chunk.event)
    assert outcome.disposition == "failed_pre_validation"
    assert _no_canonical_rows(dis_admin, chunk.trace_id)
    assert _failure_audit_rows(dis_admin, chunk.trace_id, "PRE_MAPPING_VALIDATED") >= 1


async def test_pre_validation_accepts_well_formed_chunk(
    pipeline: ConsumerPipeline,
    dis_admin: Engine,
    storage: StorageClient,
    cleanup: Cleanup,
    stack_env: dict[str, str],
    consumer_mappings: dict[str, int],
) -> None:
    sku = f"VG-{new_uuid7().hex[:10]}"
    seed_hot_row(dis_admin, cleanup, sku_id=sku, mapping_version_id=consumer_mappings[SALE_SOURCE_ID])
    chunk = seed_chunk(
        dis_admin,
        storage,
        cleanup,
        csv_data=sale_csv([(ts(0), sku, "1", "9.99", "9.99", "T-VG", "1")]),
        source_id=SALE_SOURCE_ID,
        bronze_bucket=stack_env["GCS_BUCKET_BRONZE"],
    )
    outcome = await pipeline.process(chunk.event)
    assert outcome.disposition == "written"


async def test_post_validation_rejects_invalid_canonical_frame(
    pipeline: ConsumerPipeline,
    dis_admin: Engine,
    storage: StorageClient,
    cleanup: Cleanup,
    stack_env: dict[str, str],
) -> None:
    # The bad-subtype mapping derives event_subtype='GIFT' — structurally a fine
    # chunk (passes pre), but the canonical frame violates the model's enum
    # vocab (SALE/RETURN/VOID) at the post gate.
    sku = f"VG-{new_uuid7().hex[:10]}"
    chunk = seed_chunk(
        dis_admin,
        storage,
        cleanup,
        csv_data=sale_csv([(ts(0), sku, "1", "9.99", "8.99", "T-VB", "1")]),
        source_id=BAD_SUBTYPE_SOURCE_ID,
        bronze_bucket=stack_env["GCS_BUCKET_BRONZE"],
    )
    outcome = await pipeline.process(chunk.event)
    assert outcome.disposition == "failed_post_validation"
    assert _no_canonical_rows(dis_admin, chunk.trace_id)
    assert _failure_audit_rows(dis_admin, chunk.trace_id, "POST_MAPPING_VALIDATED") >= 1
