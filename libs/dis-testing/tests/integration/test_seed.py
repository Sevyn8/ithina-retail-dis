"""Seeder integration tests (acceptance criterion 5).

Runs against the live DIS Postgres. Asserts the default set is present and that
re-running the seeder is a no-op (idempotent). Assertions are on the resulting DB
state, so they hold whether or not rows pre-existed from an earlier run.
"""

from __future__ import annotations

from dataclasses import replace
from uuid import UUID

import pytest
from sqlalchemy import Engine, text

from dis_testing import fixtures as fx
from dis_testing.errors import SeedError
from dis_testing.seed import seed_default_fixtures

pytestmark = pytest.mark.integration


def test_seed_writes_default_set_and_is_idempotent(dis_engine: Engine) -> None:
    # First call ensures the set is present (may insert, may be a no-op if pre-seeded).
    seed_default_fixtures(engine=dis_engine)

    # Second call must insert nothing and must not raise — the idempotency contract.
    second = seed_default_fixtures(engine=dis_engine)
    assert second.tenants_inserted == 0
    assert second.stores_inserted == 0
    assert second.mappings_inserted == 0

    # config.source_mappings is RLS ON (Slice 14a) and dis_engine is the
    # NOBYPASSRLS service role: the mapping count must read under the fixture
    # tenant's GUC or it returns zero rows. identity_mirror stays RLS-OFF.
    primary_uuid = fx.tenant_uuid_for(fx.PRIMARY_TENANT.display_code)
    with dis_engine.begin() as conn:
        tenants = conn.execute(text("SELECT count(*) FROM identity_mirror.tenants")).scalar_one()
        stores = conn.execute(text("SELECT count(*) FROM identity_mirror.stores")).scalar_one()
        conn.execute(
            text("SELECT set_config('app.tenant_id', :tid, true)"),
            {"tid": str(primary_uuid)},
        )
        active = conn.execute(
            text("SELECT count(*) FROM config.source_mappings WHERE status = 'ACTIVE'")
        ).scalar_one()

    assert tenants >= len(fx.TENANTS)
    assert stores >= len(fx.STORES)
    assert active >= 1


def test_default_mapping_version_seq_is_one(dis_engine: Engine) -> None:
    seed_default_fixtures(engine=dis_engine)
    tenant_uuid = fx.tenant_uuid_for(str(fx.DEFAULT_SOURCE_MAPPING["tenant_display_code"]))
    # RLS ON (Slice 14a): the read must carry the tenant GUC (NOBYPASSRLS role).
    with dis_engine.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.tenant_id', :tid, true)"),
            {"tid": str(tenant_uuid)},
        )
        row = conn.execute(
            text(
                "SELECT version_seq_per_source, template_id, template_name "
                "FROM config.source_mappings "
                "WHERE tenant_id = :tid AND source_id = :sid AND status = 'ACTIVE'"
            ),
            {"tid": str(tenant_uuid), "sid": fx.DEFAULT_SOURCE_MAPPING["source_id"]},
        ).one()
    assert row.version_seq_per_source == 1
    # The Slice 14a grain: the row carries a template. Its id is the fixture
    # pin on a virgin DB but the 0005-backfill mint on a DB that pre-dates
    # 14a (the seeder existence-guard never rewrites it), so assert validity
    # plus the deterministic name — identical in both provenances.
    assert isinstance(UUID(str(row.template_id)), UUID)
    assert row.template_name == fx.DEFAULT_TEMPLATE_NAME


def test_seeded_tenant_uuid_matches_fixture_bridge(dis_engine: Engine) -> None:
    # The bridge: a fixture external id maps to the exact UUID row the seeder wrote.
    seed_default_fixtures(engine=dis_engine)
    primary_uuid = fx.tenant_uuid_for(fx.PRIMARY_TENANT.display_code)
    with dis_engine.connect() as conn:
        row = conn.execute(
            text("SELECT name, status FROM identity_mirror.tenants WHERE tenant_id = :tid"),
            {"tid": str(primary_uuid)},
        ).first()
    assert row is not None
    assert row.name == fx.PRIMARY_TENANT.name
    assert row.status == fx.PRIMARY_TENANT.status


def test_seeder_raises_seed_error_on_orphan_store(
    dis_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The orphan-store guard: a fixture store whose tenant is absent from fx.TENANTS
    # is unreachable by the per-tenant loop (stores_for_tenant never yields it), so
    # seeded_stores falls short of len(fx.STORES). The seeder must RAISE, not silently
    # drop it (the pre-17c flat loop would have written it relying on the FK).
    orphan = replace(
        fx.STORES[0],
        uuid=UUID("019e89f9-dbd5-7703-8221-aaaaaaaaaaaa"),
        store_code="ORPHAN-1",
        tenant_display_code="no-such-tenant",  # not in fx.TENANTS
    )
    monkeypatch.setattr(fx, "STORES", (*fx.STORES, orphan))
    with pytest.raises(SeedError):
        seed_default_fixtures(engine=dis_engine)
