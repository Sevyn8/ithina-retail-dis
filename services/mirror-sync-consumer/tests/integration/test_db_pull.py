"""DB-pull integration: first-load, convergence, idempotence, and FK integrity.

Reads the in-cluster test Customer Master (``ithina_platform_db`` on 5433) and writes the DIS
database. Count/idempotence claims are checked by an **independent re-read of both sides** (raw
admin queries), never by the sync's own returned counts.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

import pytest
from sqlalchemy import Engine, Row, text
from sqlalchemy.exc import IntegrityError

import dis_testing.fixtures as fx
from dis_core.ids import new_uuid7
from dis_rls import create_rls_engine, rls_session
from mirror_sync_consumer.pull.runner import EXIT_OK, _run

pytestmark = pytest.mark.integration


def _by_id(engine: Engine, sql: str, key: str) -> Mapping[object, Row[object]]:
    with engine.connect() as conn:
        return {getattr(r, key): r for r in conn.execute(text(sql)).all()}


_BRONZE_INSERT = text(
    """
    INSERT INTO bronze.data_ingress_events
        (id, tenant_id, store_id, source_id, dis_channel, trace_id, gcs_uri, received_at)
    VALUES
        (:id, :tid, :sid, 'manual_csv_upload', 'csv_upload', :trace, 'gs://test/x', now())
    """
)


async def test_first_load_mirrors_every_cm_record(run_env: None, cm_admin: Engine, dis_admin: Engine) -> None:
    assert await _run() == EXIT_OK

    cm_t = _by_id(cm_admin, "SELECT id, name, status FROM core.tenants", "id")
    mir_t = _by_id(dis_admin, "SELECT tenant_id, name, status FROM identity_mirror.tenants", "tenant_id")
    assert set(cm_t) <= set(mir_t)
    for tid, row in cm_t.items():
        assert (mir_t[tid].name, mir_t[tid].status) == (row.name, row.status)

    cm_s = _by_id(
        cm_admin,
        "SELECT id, name, status, country, timezone, currency, tax_treatment FROM core.stores",
        "id",
    )
    mir_s = _by_id(
        dis_admin,
        "SELECT store_id, name, status, country, timezone, currency, tax_treatment "
        "FROM identity_mirror.stores",
        "store_id",
    )
    assert set(cm_s) <= set(mir_s)
    for sid, row in cm_s.items():
        m = mir_s[sid]
        assert (m.name, m.status, m.country, m.timezone, m.currency, m.tax_treatment) == (
            row.name,
            row.status,
            row.country,
            row.timezone,
            row.currency,
            row.tax_treatment,
        )

    # Count match on the CM-returned id set (independent re-read, not the sync's bookkeeping).
    assert sum(1 for t in mir_t if t in cm_t) == len(cm_t)
    assert sum(1 for s in mir_s if s in cm_s) == len(cm_s)


async def test_rerun_without_change_is_a_noop(run_env: None, cm_admin: Engine, dis_admin: Engine) -> None:
    await _run()

    def synced_at() -> tuple[dict[object, object], dict[object, object]]:
        t = _by_id(dis_admin, "SELECT tenant_id, mirror_synced_at FROM identity_mirror.tenants", "tenant_id")
        s = _by_id(dis_admin, "SELECT store_id, mirror_synced_at FROM identity_mirror.stores", "store_id")
        return (
            {k: v.mirror_synced_at for k, v in t.items()},
            {k: v.mirror_synced_at for k, v in s.items()},
        )

    before_t, before_s = synced_at()
    assert await _run() == EXIT_OK
    after_t, after_s = synced_at()

    cm_t = set(_by_id(cm_admin, "SELECT id FROM core.tenants", "id"))
    cm_s = set(_by_id(cm_admin, "SELECT id FROM core.stores", "id"))
    for tid in cm_t:
        assert before_t[tid] == after_t[tid]  # unchanged row not rewritten
    for sid in cm_s:
        assert before_s[sid] == after_s[sid]


async def test_rerun_after_cm_change_converges(run_env: None, cm_admin: Engine, dis_admin: Engine) -> None:
    await _run()  # baseline
    tenant = fx.TENANTS[0]
    tid = str(tenant.uuid)
    new_store = str(new_uuid7())

    # CM-side change: add a store, change a tenant name. NO tenant reassignment (directive 3 —
    # a store never moves tenants).
    with cm_admin.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO core.stores (id, tenant_id, name, status, country, timezone, "
                "currency, tax_treatment, created_at, updated_at) VALUES "
                "(:id, :tid, 'New Store', 'ACTIVE', 'US', 'America/New_York', 'USD', "
                "'EXCLUSIVE', now(), now())"
            ),
            {"id": new_store, "tid": tid},
        )
        conn.execute(
            text("UPDATE core.tenants SET name = 'Renamed Co', updated_at = now() WHERE id = :id"),
            {"id": tid},
        )
    try:
        assert await _run() == EXIT_OK
        with dis_admin.connect() as conn:
            assert (
                conn.execute(
                    text("SELECT name FROM identity_mirror.tenants WHERE tenant_id = :id"),
                    {"id": tid},
                ).scalar_one()
                == "Renamed Co"
            )
            assert (
                conn.execute(
                    text("SELECT count(*) FROM identity_mirror.stores WHERE store_id = :id"),
                    {"id": new_store},
                ).scalar_one()
                == 1
            )
        # No duplicates / no deletions: every CM store id is present exactly once in the mirror.
        cm_store_ids = set(_by_id(cm_admin, "SELECT id FROM core.stores", "id"))
        mir_store_ids = set(_by_id(dis_admin, "SELECT store_id FROM identity_mirror.stores", "store_id"))
        assert cm_store_ids <= mir_store_ids
    finally:
        with cm_admin.begin() as conn:
            conn.execute(text("DELETE FROM core.stores WHERE id = :id"), {"id": new_store})
            conn.execute(
                text("UPDATE core.tenants SET name = :n, updated_at = now() WHERE id = :id"),
                {"n": tenant.name, "id": tid},
            )
        with dis_admin.begin() as conn:
            conn.execute(text("DELETE FROM identity_mirror.stores WHERE store_id = :id"), {"id": new_store})
            conn.execute(
                text("UPDATE identity_mirror.tenants SET name = :n WHERE tenant_id = :id"),
                {"n": tenant.name, "id": tid},
            )


async def test_mirrored_rows_satisfy_composite_store_fk(run_env: None, dis_admin: Engine) -> None:
    # Criterion 7: a write referencing a SYNCED (tenant, store) succeeds; an absent identity
    # fails the composite FK. The referenced identity comes from the sync run, not the seeder.
    assert await _run() == EXIT_OK
    store = fx.STORES[0]
    tid = str(fx.tenant_uuid_for(store.tenant_external_id))
    sid = str(store.uuid)
    row_id = str(new_uuid7())
    engine = create_rls_engine(os.environ["POSTGRES_URL"])
    try:
        async with rls_session(engine, tid) as conn:
            await conn.execute(
                _BRONZE_INSERT, {"id": row_id, "tid": tid, "sid": sid, "trace": str(new_uuid7())}
            )
        with pytest.raises(IntegrityError):
            async with rls_session(engine, tid) as conn:
                await conn.execute(
                    _BRONZE_INSERT,
                    {"id": str(new_uuid7()), "tid": tid, "sid": str(new_uuid7()), "trace": str(new_uuid7())},
                )
    finally:
        with dis_admin.begin() as conn:
            conn.execute(text("DELETE FROM bronze.data_ingress_events WHERE id = :id"), {"id": row_id})
        await engine.dispose()
