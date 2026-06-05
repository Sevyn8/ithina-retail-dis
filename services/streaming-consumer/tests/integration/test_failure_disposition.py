"""AC9: the minimal failure disposition — audited and NACKED, never dropped,
never partially written.

A structurally-wrong chunk goes through the REAL subscriber: the message is
nacked (modifyAckDeadline 0 — the emulator redelivers it, observed by a
subsequent pull), a FAILURE audit row exists, and ZERO canonical rows landed.
The quarantine-topic publish is ABSENT by design (Slice 11) — a review-only
property (its module does not exist; asserted as an import check).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text

from dis_testing.fakes.pubsub import EmulatorPublisher
from streaming_consumer.clients.pubsub import Subscriber, process_message
from streaming_consumer.config import INGRESS_READY_TOPIC
from streaming_consumer.orchestrate import ConsumerPipeline

from .conftest import SALE_SOURCE_ID, Cleanup, drain_subscription, seed_chunk

if TYPE_CHECKING:
    from sqlalchemy.engine import Engine

    from dis_storage.client import StorageClient

pytestmark = pytest.mark.integration

_PROJECT = "local-dis"

# Missing the 'qty' column: fails the pre-mapping gate deterministically.
_BAD_CSV = b"sold_at,sku,retail,price,txn,line\n2026-01-01 10:00:00,X,9.99,8.50,T,1\n"


async def test_failing_chunk_is_audited_and_nacked(
    pipeline: ConsumerPipeline,
    dis_admin: Engine,
    storage: StorageClient,
    cleanup: Cleanup,
    stack_env: dict[str, str],
) -> None:
    chunk = seed_chunk(
        dis_admin,
        storage,
        cleanup,
        csv_data=_BAD_CSV,
        source_id=SALE_SOURCE_ID,
        bronze_bucket=stack_env["GCS_BUCKET_BRONZE"],
    )
    payload = chunk.event.model_dump_json(exclude_none=True).encode()

    # The routing decision itself: a failed disposition nacks.
    decision = await process_message(pipeline, payload)
    assert decision == "nack"

    # Through the real subscriber: publish, pull (nacked), and observe the
    # emulator REDELIVER it (deadline 0) — the message was not dropped. The
    # try/finally DRAIN is test hygiene only: by design the nacked message
    # would redeliver forever until Slice 11; without the drain it poisons
    # later subscriber-level tests on the shared subscription.
    try:
        publisher = EmulatorPublisher(project_id=_PROJECT)
        publisher.publish(INGRESS_READY_TOPIC, payload)
        subscriber = Subscriber(project_id=_PROJECT, pipeline=pipeline, max_messages=10)
        first = 0
        for _ in range(10):
            first = await subscriber.poll_once()
            if first:
                break
        assert first >= 1
        redelivered = 0
        for _ in range(10):
            redelivered = await subscriber.poll_once()
            if redelivered:
                break
        assert redelivered >= 1, "the nacked message was never redelivered (silent drop?)"
    finally:
        drain_subscription(_PROJECT)

    with dis_admin.begin() as conn:
        failure_audits = conn.execute(
            text(
                "SELECT COUNT(*) FROM audit.events WHERE trace_id = CAST(:t AS uuid) "
                "AND outcome = 'FAILURE' AND stage = 'PRE_MAPPING_VALIDATED'"
            ),
            {"t": str(chunk.trace_id)},
        ).scalar_one()
        sale_rows = conn.execute(
            text("SELECT COUNT(*) FROM canonical.store_sku_sale_events WHERE trace_id = CAST(:t AS uuid)"),
            {"t": str(chunk.trace_id)},
        ).scalar_one()
    assert failure_audits >= 1  # audited (fire-and-forget landed)
    assert sale_rows == 0  # never partially written


def test_quarantine_publish_is_absent() -> None:
    # Review-only property (Slice 11), backed by an import check: neither the
    # quarantine nor the dlq sink module exists in Slice 10.
    with pytest.raises(ImportError):
        __import__("streaming_consumer.sinks.quarantine")
    with pytest.raises(ImportError):
        __import__("streaming_consumer.sinks.dlq")
