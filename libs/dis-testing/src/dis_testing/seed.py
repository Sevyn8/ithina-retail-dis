"""Test fixture seeder.

Writes the default fixture set (:mod:`dis_testing.fixtures`) into the DIS
database so later slices' tests have tenants, stores, and a default
``config.source_mappings`` row to exercise FK and RLS behaviour against.

SCOPE — read carefully:
  * **Test infrastructure only.** Never a runtime path. Runtime population of
    ``identity_mirror`` is Slice 7 (Mirror Sync, DB-pull from real Customer
    Master); runtime source-mapping creation is Slice 14. This seeder is the
    test shortcut around Slice 7 and implements none of its sync logic.
  * **DIS database only.** It uses ``POSTGRES_URL`` (5433 / ithina_dis_db) and has
    no code path to Customer Master (5432). See the Slice 2 plan §1.
  * **Direct SQLAlchemy is intentional here.** The root rule "canonical reads/writes
    go through libs/dis-rls" is about *canonical* schemas; this writes only to
    ``identity_mirror`` (RLS-not-enabled, Slice 1 schema header) and ``config``.
    ``config.source_mappings`` is RLS ON since Slice 14a, so the mapping
    existence-check + INSERT set the transaction-local ``app.tenant_id`` GUC
    (the NOBYPASSRLS service role would otherwise read zero rows and fail the
    policy WITH CHECK). The ``identity_mirror`` writes are done per-tenant — each
    tenant in its own transaction with BOTH GUCs set (``app.user_type='TENANT'`` +
    ``app.tenant_id=<that tenant>``), matching the production mirror-sync write
    shape (``mirror-sync-consumer`` ``sinks/postgres.py:upsert_identity``, "one
    transaction per tenant", Slice 17c). ``identity_mirror`` is RLS-OFF, so the
    GUCs are a harmless no-op here (D41): the seeder matches the write *shape*, not
    a policy. The sync seeder sets the GUCs by hand on the ``Connection`` rather
    than calling the async ``rls_session``.

Idempotency: tenants/stores use ``ON CONFLICT DO NOTHING`` on their fixed UUID
PKs; the single ACTIVE ``config.source_mappings`` row is guarded by an
existence check (its PK is a BIGSERIAL that cannot conflict; the partial unique
index ``uq_csm_active_per_source`` backstops a duplicate ACTIVE per template).
The fixture's ``template_id`` is pinned (fixtures.py), never minted per run, so
re-running is a no-op and never raises.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

from sqlalchemy import Engine, create_engine, text

from dis_testing import fixtures as fx
from dis_testing.errors import SeedError

_INSERT_TENANT = text(
    """
    INSERT INTO identity_mirror.tenants
        (tenant_id, name, display_code, status, pc_created_at, pc_updated_at)
    VALUES
        (:tenant_id, :name, :display_code, :status, :pc_created_at, :pc_updated_at)
    ON CONFLICT (tenant_id) DO NOTHING
    """
)

_INSERT_STORE = text(
    """
    INSERT INTO identity_mirror.stores
        (store_id, tenant_id, name, store_code, status, country, timezone,
         currency, tax_treatment, pc_created_at, pc_updated_at)
    VALUES
        (:store_id, :tenant_id, :name, :store_code, :status, :country, :timezone,
         :currency, :tax_treatment, :pc_created_at, :pc_updated_at)
    ON CONFLICT (tenant_id, store_id) DO NOTHING
    """
)

_SELECT_ACTIVE_MAPPING = text(
    """
    SELECT 1 FROM config.source_mappings
    WHERE tenant_id = :tenant_id AND source_id = :source_id AND status = 'ACTIVE'
    LIMIT 1
    """
)

_INSERT_MAPPING = text(
    """
    INSERT INTO config.source_mappings
        (tenant_id, source_id, template_id, template_name, template_type, status, mapping_rules,
         activated_at)
    VALUES
        (:tenant_id, :source_id, :template_id, :template_name, :template_type, 'ACTIVE',
         CAST(:mapping_rules AS JSONB), NOW())
    """
)

# config.source_mappings is RLS ON (FORCE, Slice 14a); the seeding role is
# NOBYPASSRLS, so the mapping check/insert need the transaction-local GUC.
_SET_TENANT_GUC = text("SELECT set_config('app.tenant_id', :tenant_id, true)")

# The seeder only ever establishes a tenant's own data, so the identity_mirror
# per-tenant sessions set app.user_type='TENANT' (root CLAUDE.md hard rule 1,
# two-GUC RLS), matching rls_session's TENANT path. PLATFORM never enters the
# seeder. The value is a literal (always TENANT), as in dis-rls/session.py.
_SET_USER_TYPE_TENANT_GUC = text("SELECT set_config('app.user_type', 'TENANT', true)")


@dataclass
class SeedSummary:
    """What the seeder did, for logging / CLI output / test assertions."""

    tenants_inserted: int = 0
    stores_inserted: int = 0
    mappings_inserted: int = 0

    def __str__(self) -> str:
        return (
            f"seeded: tenants +{self.tenants_inserted}, stores +{self.stores_inserted}, "
            f"source_mappings +{self.mappings_inserted}"
        )


def _resolve_url(url: str | None) -> str:
    resolved = url or os.environ.get("POSTGRES_URL")
    if not resolved:
        # No silent default for a required value (root CLAUDE.md error rule).
        raise SeedError("POSTGRES_URL is not set and no url was passed to the seeder")
    return resolved


def seed_default_fixtures(*, engine: Engine | None = None, url: str | None = None) -> SeedSummary:
    """Seed the default fixture set into the DIS database. Idempotent.

    Pass an ``engine`` (tests reuse one) or a ``url``; otherwise ``POSTGRES_URL`` is
    read from the environment.
    """
    own_engine = engine is None
    eng = engine or create_engine(_resolve_url(url))
    try:
        return _seed(eng)
    finally:
        if own_engine:
            eng.dispose()


def _seed(eng: Engine) -> SeedSummary:
    summary = SeedSummary()

    # 1 + 2. identity_mirror tenants and their stores, written per-tenant. Each
    #         tenant gets its own transaction with BOTH GUCs set
    #         (app.user_type='TENANT' + app.tenant_id=<that tenant>), matching the
    #         production mirror-sync write shape (one transaction per tenant). The
    #         GUCs are set by hand on the sync Connection (the seeder is sync; it
    #         does not call the async rls_session). identity_mirror is RLS-OFF, so
    #         the GUCs are a harmless no-op here (D41) — the seeder matches the
    #         write shape, not a policy. One engine is reused across the per-tenant
    #         transactions, as production reuses one write_engine.
    seeded_stores = 0
    for t in fx.TENANTS:
        tid = str(t.uuid)
        with eng.begin() as conn:
            conn.execute(_SET_USER_TYPE_TENANT_GUC)
            conn.execute(_SET_TENANT_GUC, {"tenant_id": tid})
            result = conn.execute(
                _INSERT_TENANT,
                {
                    "tenant_id": tid,
                    "name": t.name,
                    "display_code": t.display_code,
                    "status": t.status,
                    "pc_created_at": t.pc_created_at,
                    "pc_updated_at": t.pc_updated_at,
                },
            )
            summary.tenants_inserted += result.rowcount if result.rowcount > 0 else 0
            for s in fx.stores_for_tenant(t.display_code):
                result = conn.execute(
                    _INSERT_STORE,
                    {
                        "store_id": str(s.uuid),
                        # the session's app.tenant_id — provably the GUC, the exact
                        # invariant a future tenant-pinned WITH CHECK would need.
                        "tenant_id": tid,
                        "name": s.name,
                        "store_code": s.store_code,  # None for the code-less store (D55)
                        "status": s.status,
                        "country": s.country,
                        "timezone": s.timezone,
                        "currency": s.currency,
                        "tax_treatment": s.tax_treatment,
                        "pc_created_at": s.pc_created_at,
                        "pc_updated_at": s.pc_updated_at,
                    },
                )
                summary.stores_inserted += result.rowcount if result.rowcount > 0 else 0
                seeded_stores += 1

    # Orphan-store guard: the per-tenant loop only writes stores whose
    # tenant_display_code is among fx.TENANTS. Any fixture store naming a tenant
    # absent from fx.TENANTS would be silently dropped (the old flat loop would
    # have written it and relied on the FK). Fail loudly instead — production
    # surfaces the same as SyncResult.skipped_stores.
    if seeded_stores != len(fx.STORES):
        raise SeedError(
            f"orphan fixture store(s): seeded {seeded_stores} of {len(fx.STORES)} stores — "
            "every fx.STORES entry must name a tenant present in fx.TENANTS"
        )

    # 3. Default ACTIVE source mapping (existence-guarded; BIGSERIAL PK can't
    #    conflict). Its own transaction after the per-tenant loop; statements
    #    unchanged. RLS ON (Slice 14a): scope the transaction to the fixture
    #    tenant first — without the GUC the existence check reads zero rows and
    #    the INSERT fails the policy WITH CHECK. Single-tenant and self-contained,
    #    so a standalone transaction reproduces today's semantics exactly.
    mapping = fx.DEFAULT_SOURCE_MAPPING
    tenant_uuid = str(fx.tenant_uuid_for(str(mapping["tenant_display_code"])))
    with eng.begin() as conn:
        conn.execute(_SET_TENANT_GUC, {"tenant_id": tenant_uuid})
        exists = conn.execute(
            _SELECT_ACTIVE_MAPPING,
            {"tenant_id": tenant_uuid, "source_id": mapping["source_id"]},
        ).first()
        if exists is None:
            conn.execute(
                _INSERT_MAPPING,
                {
                    "tenant_id": tenant_uuid,
                    "source_id": mapping["source_id"],
                    "template_id": str(mapping["template_id"]),
                    "template_name": mapping["template_name"],
                    "template_type": mapping["template_type"],
                    "mapping_rules": json.dumps(mapping["mapping_rules"]),
                },
            )
            summary.mappings_inserted += 1

    return summary


def main() -> None:
    summary = seed_default_fixtures()
    print(summary)  # noqa: T201 — dev helper output


if __name__ == "__main__":
    main()
