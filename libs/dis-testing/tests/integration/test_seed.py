"""Seeder integration tests (acceptance criterion 5).

Runs against the live DIS Postgres. Asserts the default set is present and that
re-running the seeder is a no-op (idempotent). Assertions are on the resulting DB
state, so they hold whether or not rows pre-existed from an earlier run.
"""

from __future__ import annotations

import pytest
from sqlalchemy import Engine, text

from dis_testing import fixtures as fx
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

    with dis_engine.connect() as conn:
        tenants = conn.execute(text("SELECT count(*) FROM identity_mirror.tenants")).scalar_one()
        stores = conn.execute(text("SELECT count(*) FROM identity_mirror.stores")).scalar_one()
        active = conn.execute(
            text("SELECT count(*) FROM config.source_mappings WHERE status = 'ACTIVE'")
        ).scalar_one()

    assert tenants >= len(fx.TENANTS)
    assert stores >= len(fx.STORES)
    assert active >= 1


def test_default_mapping_version_seq_is_one(dis_engine: Engine) -> None:
    seed_default_fixtures(engine=dis_engine)
    tenant_uuid = fx.tenant_uuid_for(str(fx.DEFAULT_SOURCE_MAPPING["tenant_display_code"]))
    with dis_engine.connect() as conn:
        seq = conn.execute(
            text(
                "SELECT version_seq_per_source FROM config.source_mappings "
                "WHERE tenant_id = :tid AND source_id = :sid AND status = 'ACTIVE'"
            ),
            {"tid": str(tenant_uuid), "sid": fx.DEFAULT_SOURCE_MAPPING["source_id"]},
        ).scalar_one()
    assert seq == 1


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
