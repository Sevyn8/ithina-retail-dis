"""Fixtures for the Slice 10 consumer integration tests.

These tests WRITE the DIS database and use the Pub/Sub + GCS emulators, so — the
Slice 4/7 lesson — they must NOT skip silently when the stack is absent: a missing
env or unreachable emulator is a loud ERROR (``StackRequiredError``), never a skip.
Everything runs against ``ithina_dis_db`` on 5433; Customer Master (5432) is never
touched.

Date robustness (M-D38/D64 gate finding): the event tables are RANGE-partitioned
by ``event_date`` with NO rolling partition manager and NO DEFAULT partition, so
``ensure_event_partitions`` idempotently creates the daily partitions the tests'
event dates need (test-fixture provisioning of the local DB, mirroring the 0001
bootstrap's naming — not service DDL). The suite never depends on the bootstrap
partition window.

Each test mints a unique trace and uses per-test SKUs/transaction ids so runs
cannot couple; created canonical/audit/bronze rows are deleted in teardown via
the admin engine.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url

from dis_core.ids import new_uuid7
from dis_storage import build_object_path

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine

    from dis_storage.client import StorageClient
    from streaming_consumer.envelope import IngressReadyEvent
    from streaming_consumer.orchestrate import ConsumerPipeline


class StackRequiredError(RuntimeError):
    """The local stack is required for these load-bearing tests but is absent."""


_REQUIRED_ENV = (
    "POSTGRES_URL",
    "POSTGRES_ADMIN_URL",
    "PUBSUB_EMULATOR_HOST",
    "STORAGE_EMULATOR_HOST",
    "GCS_BUCKET_BRONZE",
)

_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"

# The consumer-test source registrations (distinct from the seeder's
# manual_csv_upload so its empty mapping_rules row is never read here).
SALE_SOURCE_ID = "sc_pos_v1"
CHANGE_SOURCE_ID = "sc_inv_v1"
BAD_SUBTYPE_SOURCE_ID = "sc_pos_badsub_v1"

_MAPPING_FILES = {
    SALE_SOURCE_ID: "sale_pos_v1.json",
    CHANGE_SOURCE_ID: "inventory_count_v1.json",
    BAD_SUBTYPE_SOURCE_ID: "sale_pos_bad_subtype_v1.json",
}

# All test event timestamps anchor here: today at a mid-day hour, so the chunk's
# rows and a ±1-day spread stay inside the partitions ensure_event_partitions makes.
BASE_TS = datetime.now(tz=UTC).replace(hour=12, minute=0, second=0, microsecond=0)


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise StackRequiredError(
            f"{name} is not set — the Slice 10 consumer integration tests refuse to skip "
            "silently. Bring up the stack (make run-local) and load .env."
        )
    return value


@pytest.fixture(scope="session")
def stack_env() -> dict[str, str]:
    return {name: _require_env(name) for name in _REQUIRED_ENV}


@pytest.fixture(scope="session")
def seeded(stack_env: dict[str, str]) -> None:
    """Seed the Slice 2 tenants/stores so identity FKs resolve."""
    from dis_testing.seed import seed_default_fixtures

    seed_default_fixtures(url=stack_env["POSTGRES_URL"])


@pytest.fixture(scope="session")
def admin_engine_session(stack_env: dict[str, str]) -> Iterator[Engine]:
    """Session-scoped admin engine (partition + mapping provisioning, cleanup)."""
    url = make_url(stack_env["POSTGRES_ADMIN_URL"])
    assert url.database == "ithina_dis_db"  # target safety for the fixture itself
    assert url.port == 5433
    eng = create_engine(stack_env["POSTGRES_ADMIN_URL"])
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture(scope="session")
def event_partitions(admin_engine_session: Engine) -> None:
    """Idempotently create the daily event partitions the tests' dates need."""
    dates = [BASE_TS.date() + timedelta(days=offset) for offset in (-1, 0, 1)]
    parents = ("store_sku_sale_events", "store_sku_change_events")
    with admin_engine_session.begin() as conn:
        for day in dates:
            upper = day + timedelta(days=1)
            for parent in parents:
                conn.execute(
                    text(
                        f"CREATE TABLE IF NOT EXISTS canonical.{parent}_p{day:%Y%m%d} "  # noqa: S608
                        f"PARTITION OF canonical.{parent} "
                        f"FOR VALUES FROM ('{day:%Y-%m-%d}') TO ('{upper:%Y-%m-%d}')"
                    )
                )


@pytest.fixture(scope="session")
def consumer_mappings(admin_engine_session: Engine, seeded: None) -> dict[str, int]:
    """Seed the consumer-test ACTIVE mappings; returns source_id -> version id.

    Test-only upsert by the (tenant, source, seq) natural key so a rules edit in
    the fixture file lands on re-run (live mapping rows are immutable in
    production; this is dev-DB seeding, the admin path).
    """
    from dis_testing.fixtures import PRIMARY_TENANT

    versions: dict[str, int] = {}
    with admin_engine_session.begin() as conn:
        for source_id, filename in _MAPPING_FILES.items():
            rules = json.loads((_FIXTURES / "mappings" / filename).read_text())
            row = conn.execute(
                text(
                    "INSERT INTO config.source_mappings "
                    "(tenant_id, source_id, version_seq_per_source, status, mapping_rules, activated_at) "
                    "VALUES (CAST(:tenant_id AS uuid), :source_id, 1, 'ACTIVE', "
                    "CAST(:rules AS JSONB), NOW()) "
                    "ON CONFLICT (tenant_id, source_id, version_seq_per_source) "
                    "DO UPDATE SET mapping_rules = EXCLUDED.mapping_rules "
                    "RETURNING mapping_version_id"
                ),
                {
                    "tenant_id": str(PRIMARY_TENANT.uuid),
                    "source_id": source_id,
                    "rules": json.dumps(rules),
                },
            ).first()
            assert row is not None
            versions[source_id] = int(row.mapping_version_id)
    return versions


@pytest.fixture
async def engine(stack_env: dict[str, str], seeded: None) -> AsyncIterator[AsyncEngine]:
    """The consumer's RLS engine (loop-scoped per test, the Slice 6 pattern)."""
    from dis_rls import create_rls_engine

    eng = create_rls_engine(stack_env["POSTGRES_URL"])
    try:
        yield eng
    finally:
        await eng.dispose()


@pytest.fixture
def dis_admin(admin_engine_session: Engine) -> Engine:
    """Per-test alias for the admin engine (independent re-reads, cleanup)."""
    return admin_engine_session


@dataclass
class Cleanup:
    """Trace ids + SKUs to scrub in teardown (canonical + audit + bronze)."""

    traces: list[UUID] = field(default_factory=list)
    skus: list[str] = field(default_factory=list)


@pytest.fixture
def cleanup(dis_admin: Engine) -> Iterator[Cleanup]:
    items = Cleanup()
    yield items
    if not (items.traces or items.skus):
        return
    with dis_admin.begin() as conn:
        if items.traces:
            params = {"tids": items.traces}
            conn.execute(
                text("DELETE FROM canonical.store_sku_sale_events WHERE trace_id = ANY(:tids)"),
                params,
            )
            conn.execute(
                text("DELETE FROM canonical.store_sku_change_events WHERE trace_id = ANY(:tids)"),
                params,
            )
            conn.execute(text("DELETE FROM audit.events WHERE trace_id = ANY(:tids)"), params)
            conn.execute(
                text("DELETE FROM bronze.data_ingress_events WHERE trace_id = ANY(:tids)"),
                params,
            )
        if items.skus:
            conn.execute(
                text("DELETE FROM canonical.store_sku_current_position WHERE sku_id = ANY(:skus)"),
                {"skus": items.skus},
            )


@pytest.fixture
def storage(stack_env: dict[str, str]) -> StorageClient:
    """The dis-storage client on the bronze bucket (created idempotently)."""
    from google.api_core.exceptions import Conflict

    from dis_storage.client import StorageClient

    bucket = stack_env["GCS_BUCKET_BRONZE"]
    try:
        client = StorageClient(bucket=bucket)
        try:
            client._client.create_bucket(bucket)  # noqa: SLF001 - test provisioning
        except Conflict:
            pass
    except Exception as exc:
        raise StackRequiredError(
            f"GCS emulator unreachable ({exc!r}); refusing to skip. make run-local."
        ) from exc
    return client


@pytest.fixture
def pipeline(
    engine: AsyncEngine,
    storage: StorageClient,
    stack_env: dict[str, str],
    event_partitions: None,
    consumer_mappings: dict[str, int],
) -> ConsumerPipeline:
    """A fully wired consumer pipeline against the live stack."""
    from dis_audit import AuditBackend, select_writer
    from streaming_consumer.orchestrate import ConsumerPipeline
    from streaming_consumer.sinks.audit import ConsumerAudit

    return ConsumerPipeline(
        engine=engine,
        storage=storage,
        audit=ConsumerAudit(select_writer(AuditBackend.POSTGRES, engine=engine)),
        bronze_bucket=stack_env["GCS_BUCKET_BRONZE"],
    )


@dataclass(frozen=True)
class SeededChunk:
    """One seeded ingress: GCS object + bronze row + the typed envelope."""

    event: IngressReadyEvent
    bronze_ref: UUID
    trace_id: UUID


def seed_chunk(
    dis_admin: Engine,
    storage: StorageClient,
    cleanup: Cleanup,
    *,
    csv_data: bytes,
    source_id: str,
    bronze_bucket: str,
    store_uuid: UUID | None = None,
    tenant_uuid: UUID | None = None,
    event_store_uuid: UUID | None = None,
) -> SeededChunk:
    """Play the 9b worker: land the object + bronze row, return the envelope.

    ``event_store_uuid`` overrides the ENVELOPE's store only (the bronze row
    keeps a mirror-valid store — bronze carries its own composite store FK):
    the malformed-producer construction the canonical no-orphan FK (D39) is the
    last line of defense against.
    """
    from dis_testing.fixtures import PRIMARY_STORE, PRIMARY_TENANT
    from streaming_consumer.envelope import IngressReadyEvent

    tenant = tenant_uuid or PRIMARY_TENANT.uuid
    store = store_uuid or PRIMARY_STORE.uuid
    trace_id = new_uuid7()
    bronze_ref = new_uuid7()
    cleanup.traces.append(trace_id)

    object_key = build_object_path(
        tenant_id=tenant,
        source_id=source_id,
        trace_id=trace_id,
        event_ts=BASE_TS,
        ext="csv",
    )
    storage.upload_bytes(object_key, csv_data, content_type="text/csv")
    gcs_uri = f"gs://{bronze_bucket}/{object_key}"

    with dis_admin.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO bronze.data_ingress_events "
                "(id, tenant_id, store_id, source_id, dis_channel, trace_id, gcs_uri, "
                " payload_size_bytes, received_at, processing_status, published_at) "
                "VALUES (CAST(:id AS uuid), CAST(:tenant_id AS uuid), CAST(:store_id AS uuid), "
                " :source_id, 'csv_upload', CAST(:trace_id AS uuid), :gcs_uri, "
                " :size, NOW(), 'PUBLISHED', NOW())"
            ),
            {
                "id": str(bronze_ref),
                "tenant_id": str(tenant),
                "store_id": str(store),
                "source_id": source_id,
                "trace_id": str(trace_id),
                "gcs_uri": gcs_uri,
                "size": len(csv_data),
            },
        )

    event = IngressReadyEvent(
        schema_version=1,
        trace_id=trace_id,
        tenant_id=tenant,
        store_id=event_store_uuid or store,
        source_id=source_id,
        bronze_ref=bronze_ref,
        gcs_uri=gcs_uri,
        received_ts=BASE_TS,
        tenant_display_code="acme-retail",
        store_code="AC-001",
    )
    return SeededChunk(event=event, bronze_ref=bronze_ref, trace_id=trace_id)


def seed_hot_row(
    dis_admin: Engine,
    cleanup: Cleanup,
    *,
    sku_id: str,
    mapping_version_id: int,
    sku_variant: str | None = None,
    sku_lot_batch: str | None = None,
) -> UUID:
    """Pre-seed the hot row a sale chunk merges into (D63: catalogue-before-sales)."""
    from dis_testing.fixtures import PRIMARY_STORE, PRIMARY_TENANT

    row_id = new_uuid7()
    cleanup.skus.append(sku_id)
    with dis_admin.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO canonical.store_sku_current_position "
                "(id, tenant_id, store_id, sku_id, sku_variant, sku_lot_batch, "
                " product_name, product_category, current_retail_price, unit_cost, "
                " tax_treatment, currency, mapping_version_id, trace_id, dis_channel) "
                "VALUES (CAST(:id AS uuid), CAST(:tenant_id AS uuid), CAST(:store_id AS uuid), "
                " :sku_id, :sku_variant, :sku_lot_batch, "
                " 'Seeded Widget', 'Hardware', 1.0000, 0.5000, "
                " 'EXCLUSIVE', 'USD', :mapping_version_id, CAST(:trace_id AS uuid), 'csv_upload')"
            ),
            {
                "id": str(row_id),
                "tenant_id": str(PRIMARY_TENANT.uuid),
                "store_id": str(PRIMARY_STORE.uuid),
                "sku_id": sku_id,
                "sku_variant": sku_variant,
                "sku_lot_batch": sku_lot_batch,
                "mapping_version_id": mapping_version_id,
                "trace_id": str(new_uuid7()),
            },
        )
    return row_id


def sale_csv(rows: list[tuple[str, str, str, str, str, str, str]]) -> bytes:
    """sold_at, sku, qty, retail, price, txn, line."""
    body = "\n".join(",".join(row) for row in rows)
    return f"sold_at,sku,qty,retail,price,txn,line\n{body}\n".encode()


def change_csv(rows: list[tuple[str, str, str]]) -> bytes:
    """counted_at, sku, stock."""
    body = "\n".join(",".join(row) for row in rows)
    return f"counted_at,sku,stock\n{body}\n".encode()


def ts(offset_minutes: int = 0, *, day_offset: int = 0) -> str:
    """A chunk timestamp string anchored at BASE_TS (partition-window safe)."""
    moment = BASE_TS + timedelta(days=day_offset, minutes=offset_minutes)
    return f"{moment:%Y-%m-%d %H:%M:%S}"


def event_date_of(day_offset: int = 0) -> date:
    return (BASE_TS + timedelta(days=day_offset)).date()


def drain_subscription(project_id: str) -> int:
    """Pull-and-ACK everything currently on the consumer's real subscription.

    Test hygiene only: audit-and-nack deliberately leaves a deterministically
    failing message REDELIVERING (the Slice 10 interim posture) — without a
    drain it poisons later subscriber-level tests on the shared subscription.
    The production consumer never acks a failure; this helper is the test
    stand-in for Slice 11's quarantine drain.
    """
    from google.cloud import pubsub_v1

    from streaming_consumer.config import INGRESS_READY_SUBSCRIPTION

    client = pubsub_v1.SubscriberClient()
    sub_path = client.subscription_path(project_id, INGRESS_READY_SUBSCRIPTION)
    drained = 0
    try:
        while True:
            response = client.pull(
                request={"subscription": sub_path, "max_messages": 50}, timeout=3, retry=None
            )
            if not response.received_messages:
                return drained
            client.acknowledge(
                request={
                    "subscription": sub_path,
                    "ack_ids": [m.ack_id for m in response.received_messages],
                }
            )
            drained += len(response.received_messages)
    except Exception:  # noqa: BLE001 - empty-subscription pull timeouts are fine
        return drained
    finally:
        client.close()
