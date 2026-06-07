"""``/mapping-templates`` against the live stack — RLS scoping, the trigger, the EXCLUDE.

Each test works under a scratch ``source_id`` unique to the run; teardown
deletes those rows via the admin role (BYPASSRLS — cleanup only, never the path
under test). Lifecycle states beyond DRAFT (ACTIVE/DEPRECATED heads) are staged
by direct admin UPDATE — simulating the future promote slice's output — because
no endpoint may produce them (that absence is itself asserted).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text

from dis_core.ids import new_uuid7
from dis_mapping import SourceMapping
from dis_ui_server.main import create_app

pytestmark = pytest.mark.integration

TENANT_A = "019e89f9-dbd5-7703-8221-ae6b811599bb"
TENANT_B = "019e89f9-dbd5-7703-8221-ae707db9b918"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _sale_rules(constant_currency: str = "EUR") -> dict[str, Any]:
    """A complete valid sale template (the unit-test shape, full mandatory coverage)."""
    return {
        "version": 1,
        "rename": {
            "item_code": "sku_id",
            "qty": "quantity",
            "price": "unit_retail_price",
            "paid": "unit_sale_price",
            "ts": "source_sale_timestamp",
            "kind": "event_subtype",
        },
        "normalize": {
            "quantity": [
                {"op": "parse_decimal", "args": {"decimal_separator": ".", "thousands_separator": None}}
            ],
            "source_sale_timestamp": [
                {"op": "parse_datetime", "args": {"format": "%Y-%m-%d %H:%M:%S", "timezone": "UTC"}}
            ],
        },
        "cast": {
            "quantity": {"type": "decimal", "precision": 14, "scale": 3},
            "source_sale_timestamp": {"type": "datetime"},
        },
        "derive": {
            "event_date": [{"op": "date_from_datetime", "args": {"source_column": "source_sale_timestamp"}}],
            "currency": [{"op": "constant", "args": {"value": constant_currency}}],
        },
    }


def _canonical(rules: dict[str, Any]) -> dict[str, Any]:
    """What create/edit stores and reads serve: the VALIDATED model's dump (the
    canonical normalized form — e.g. non-decimal casts carry explicit null
    precision/scale), not the request's surface syntax."""
    return SourceMapping.model_validate(rules).model_dump(mode="json")


@pytest.fixture
def live_client(stack_env: dict[str, str], monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("POSTGRES_URL", stack_env["POSTGRES_URL"])
    with TestClient(create_app()) as client:
        yield client


@pytest.fixture
def admin_engine(stack_env: dict[str, str]) -> Iterator[Engine]:
    engine = create_engine(stack_env["POSTGRES_ADMIN_URL"])
    yield engine
    engine.dispose()


@pytest.fixture
def scratch_source(admin_engine: Engine) -> Iterator[str]:
    """A run-unique source_id; rows under it are admin-deleted at teardown."""
    source_id = f"t14b_{new_uuid7().hex[:12]}"
    yield source_id
    with admin_engine.begin() as conn:
        conn.execute(
            text("DELETE FROM config.source_mappings WHERE source_id = :sid"),
            {"sid": source_id},
        )


def _create(
    client: TestClient,
    mint_token: Callable[..., str],
    source_id: str,
    *,
    template_name: str = "sales",
    tenant_id: str = TENANT_A,
) -> Any:
    return client.post(
        "/api/v1/mapping-templates",
        headers=_bearer(mint_token(tenant_id=tenant_id)),
        json={"source_id": source_id, "template_name": template_name, "mapping_rules": _sale_rules()},
    )


def _force_status(admin_engine: Engine, mapping_version_id: int, status: str) -> None:
    """Stage a post-promote lifecycle state (the future slice's output) for a test."""
    timestamps = {
        "ACTIVE": "activated_at = NOW(), deprecated_at = NULL",
        "DEPRECATED": "activated_at = COALESCE(activated_at, NOW()), deprecated_at = NOW()",
    }[status]
    with admin_engine.begin() as conn:
        conn.execute(
            text(
                f"UPDATE config.source_mappings SET status = :status, {timestamps} "  # noqa: S608
                "WHERE mapping_version_id = :mvid"
            ),
            {"status": status, "mvid": mapping_version_id},
        )


# -- create (d) ---------------------------------------------------------------------


def test_create_writes_a_valid_draft_with_a_minted_uuid7(
    live_client: TestClient,
    mint_token: Callable[..., str],
    scratch_source: str,
    admin_engine: Engine,
) -> None:
    response = _create(live_client, mint_token, scratch_source)
    assert response.status_code == 201, response.text
    body = response.json()

    assert UUID(body["template_id"]).version == 7  # minted server-side, UUIDv7 (hard rule 3)
    assert body["source_id"] == scratch_source
    assert body["template_name"] == "sales"
    assert body["latest_version"] == 1  # trigger-assigned, lineage starts at 1
    assert body["draft_version"] == 1
    assert body["active_version"] is None and body["staged_version"] is None
    assert body["versions_count"] == 1

    (version,) = body["versions"]
    assert version["status"] == "draft"
    assert version["version"] == 1
    assert version["predecessor_version_id"] is None
    assert version["mapping_rules"] == _canonical(_sale_rules())  # the validated document round-trips
    assert version["field_count"] == 6
    assert version["transform_count"] == 6  # 2 normalize lists' ops + 2 casts + 2 derive ops

    # The stored row, off the database directly (admin read): DRAFT, seq 1, tenant A.
    with admin_engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT tenant_id, status, version_seq_per_source, predecessor_version_id "
                "FROM config.source_mappings WHERE source_id = :sid"
            ),
            {"sid": scratch_source},
        ).one()
    assert str(row.tenant_id) == TENANT_A
    assert row.status == "DRAFT"
    assert row.version_seq_per_source == 1
    assert row.predecessor_version_id is None


def test_duplicate_template_name_is_a_clean_409(
    live_client: TestClient, mint_token: Callable[..., str], scratch_source: str
) -> None:
    assert _create(live_client, mint_token, scratch_source).status_code == 201
    duplicate = _create(live_client, mint_token, scratch_source)  # same name, same source
    assert duplicate.status_code == 409, duplicate.text
    envelope = duplicate.json()["error"]
    assert envelope["code"] == "mapping_template_name_conflict"
    assert envelope["details"]["source_id"] == scratch_source
    assert envelope["details"]["template_name"] == "sales"
    # A second template under the SAME source with a DIFFERENT name is fine (D68 grain)...
    assert _create(live_client, mint_token, scratch_source, template_name="inventory").status_code == 201


def test_same_name_under_another_source_is_fine(
    live_client: TestClient,
    mint_token: Callable[..., str],
    scratch_source: str,
    admin_engine: Engine,
) -> None:
    other_source = f"{scratch_source}_b"
    try:
        assert _create(live_client, mint_token, scratch_source).status_code == 201
        assert _create(live_client, mint_token, other_source).status_code == 201
    finally:
        with admin_engine.begin() as conn:
            conn.execute(
                text("DELETE FROM config.source_mappings WHERE source_id = :sid"),
                {"sid": other_source},
            )


# -- reads (c) — RLS isolation -------------------------------------------------------


def test_templates_are_invisible_across_tenants(
    live_client: TestClient, mint_token: Callable[..., str], scratch_source: str
) -> None:
    created = _create(live_client, mint_token, scratch_source)
    template_id = created.json()["template_id"]

    # Owner: list (filtered) shows it, detail serves it.
    own_list = live_client.get(
        f"/api/v1/mapping-templates?source_id={scratch_source}",
        headers=_bearer(mint_token(tenant_id=TENANT_A)),
    )
    assert [t["template_id"] for t in own_list.json()] == [template_id]
    assert (
        live_client.get(
            f"/api/v1/mapping-templates/{template_id}",
            headers=_bearer(mint_token(tenant_id=TENANT_A)),
        ).status_code
        == 200
    )

    # Tenant B: the same template does not exist — empty list, 404 detail, 404 PATCH.
    b_headers = _bearer(mint_token(tenant_id=TENANT_B))
    assert (
        live_client.get(f"/api/v1/mapping-templates?source_id={scratch_source}", headers=b_headers).json()
        == []
    )
    detail = live_client.get(f"/api/v1/mapping-templates/{template_id}", headers=b_headers)
    assert detail.status_code == 404
    assert detail.json()["error"]["code"] == "resource_not_found"
    patch = live_client.patch(
        f"/api/v1/mapping-templates/{template_id}",
        headers=b_headers,
        json={"template_name": "stolen"},
    )
    assert patch.status_code == 404


def test_unknown_template_is_404(live_client: TestClient, mint_token: Callable[..., str]) -> None:
    response = live_client.get(
        f"/api/v1/mapping-templates/{new_uuid7()}",
        headers=_bearer(mint_token(tenant_id=TENANT_A)),
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "resource_not_found"


def test_non_uuid_token_sub_creates_with_null_created_by(
    live_client: TestClient,
    mint_token: Callable[..., str],
    scratch_source: str,
    admin_engine: Engine,
) -> None:
    """A verified token whose ``sub`` is not a UUID still creates (201); the
    authorship column is NULL by design (handlers/mapping_templates.py
    ``_created_by_uuid`` — the claim vocabulary is unsigned, D56/Blocker 5),
    on the wire AND on the written row."""
    response = live_client.post(
        "/api/v1/mapping-templates",
        headers=_bearer(mint_token(tenant_id=TENANT_A, sub="svc-account-7")),  # not a UUID
        json={"source_id": scratch_source, "template_name": "sales", "mapping_rules": _sale_rules()},
    )
    assert response.status_code == 201
    assert response.json()["versions"][0]["created_by_user_id"] is None  # the wire shape

    with admin_engine.begin() as conn:  # and the written row itself
        stored = conn.execute(
            text("SELECT created_by_user_id FROM config.source_mappings WHERE source_id = :sid"),
            {"sid": scratch_source},
        ).scalar_one()
    assert stored is None


# -- edit (e) — the D17 lifecycle ------------------------------------------------------


def test_patch_edits_a_draft_in_place(
    live_client: TestClient, mint_token: Callable[..., str], scratch_source: str
) -> None:
    created = _create(live_client, mint_token, scratch_source).json()
    template_id = created["template_id"]
    original_mvid = created["versions"][0]["mapping_version_id"]

    response = live_client.patch(
        f"/api/v1/mapping-templates/{template_id}",
        headers=_bearer(mint_token(tenant_id=TENANT_A)),
        json={"mapping_rules": _sale_rules(constant_currency="GBP")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    # In place: no new version, same surrogate id, same seq, rules replaced.
    assert body["versions_count"] == 1
    (version,) = body["versions"]
    assert version["mapping_version_id"] == original_mvid
    assert version["version"] == 1
    assert version["status"] == "draft"
    assert version["mapping_rules"]["derive"]["currency"][0]["args"]["value"] == "GBP"


def test_patch_on_an_active_head_chains_a_new_draft(
    live_client: TestClient,
    mint_token: Callable[..., str],
    scratch_source: str,
    admin_engine: Engine,
) -> None:
    created = _create(live_client, mint_token, scratch_source).json()
    template_id = created["template_id"]
    active_mvid = created["versions"][0]["mapping_version_id"]
    _force_status(admin_engine, active_mvid, "ACTIVE")  # the future promote slice's output

    response = live_client.patch(
        f"/api/v1/mapping-templates/{template_id}",
        headers=_bearer(mint_token(tenant_id=TENANT_A)),
        json={"mapping_rules": _sale_rules(constant_currency="GBP")},
    )
    assert response.status_code == 200, response.text
    body = response.json()

    # A NEW version: DRAFT, next seq, chained to the immutable head.
    assert body["versions_count"] == 2
    assert body["active_version"] == 1
    assert body["draft_version"] == 2
    draft, active = body["versions"]  # version desc
    assert draft["status"] == "draft" and draft["version"] == 2
    assert draft["predecessor_version_id"] == active_mvid
    assert draft["mapping_rules"]["derive"]["currency"][0]["args"]["value"] == "GBP"
    # The ACTIVE version is byte-unchanged (D17 immutability) — and still the only ACTIVE.
    assert active["mapping_version_id"] == active_mvid
    assert active["status"] == "active"
    assert active["mapping_rules"] == _canonical(_sale_rules())
    assert sum(1 for v in body["versions"] if v["status"] == "active") == 1

    # A further rules PATCH reuses the one DRAFT (write-path convention) — never a second.
    again = live_client.patch(
        f"/api/v1/mapping-templates/{template_id}",
        headers=_bearer(mint_token(tenant_id=TENANT_A)),
        json={"mapping_rules": _sale_rules(constant_currency="USD")},
    )
    assert again.json()["versions_count"] == 2


def test_patch_on_a_fully_deprecated_lineage_is_409(
    live_client: TestClient,
    mint_token: Callable[..., str],
    scratch_source: str,
    admin_engine: Engine,
) -> None:
    created = _create(live_client, mint_token, scratch_source).json()
    _force_status(admin_engine, created["versions"][0]["mapping_version_id"], "DEPRECATED")

    response = live_client.patch(
        f"/api/v1/mapping-templates/{created['template_id']}",
        headers=_bearer(mint_token(tenant_id=TENANT_A)),
        json={"mapping_rules": _sale_rules()},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "mapping_state_conflict"


def test_patch_with_invalid_rules_is_400_and_writes_nothing(
    live_client: TestClient, mint_token: Callable[..., str], scratch_source: str
) -> None:
    """PATCH validates ``mapping_rules`` through the same four-step gate as POST
    BEFORE any write (handlers/mapping_templates.py): bad rules are a 400
    ``mapping_config``, and the lineage is byte-identical afterwards — no new
    DRAFT chained, no in-place edit."""
    headers = _bearer(mint_token(tenant_id=TENANT_A))
    created = _create(live_client, mint_token, scratch_source)
    assert created.status_code == 201
    template_id = created.json()["template_id"]

    bad_rules = {"version": 1, "rename": {}, "normalize": {}, "cast": {}, "derive": {}}  # empty rename
    patched = live_client.patch(
        f"/api/v1/mapping-templates/{template_id}",
        headers=headers,
        json={"mapping_rules": bad_rules},
    )
    assert patched.status_code == 400
    assert patched.json()["error"]["code"] == "mapping_config"

    detail = live_client.get(f"/api/v1/mapping-templates/{template_id}", headers=headers)
    assert detail.status_code == 200
    body = detail.json()
    assert body["versions_count"] == 1, "no new DRAFT was chained by the rejected PATCH"
    assert body["draft_version"] == 1
    assert body["versions"][0]["mapping_rules"] == _canonical(_sale_rules()), "rules unchanged"


def test_rename_updates_the_whole_lineage_and_conflicts_cleanly(
    live_client: TestClient,
    mint_token: Callable[..., str],
    scratch_source: str,
    admin_engine: Engine,
) -> None:
    headers = _bearer(mint_token(tenant_id=TENANT_A))
    first = _create(live_client, mint_token, scratch_source, template_name="sales").json()
    _create(live_client, mint_token, scratch_source, template_name="inventory")

    # Give the first template a two-row lineage (ACTIVE head + chained DRAFT).
    _force_status(admin_engine, first["versions"][0]["mapping_version_id"], "ACTIVE")
    live_client.patch(
        f"/api/v1/mapping-templates/{first['template_id']}",
        headers=headers,
        json={"mapping_rules": _sale_rules(constant_currency="GBP")},
    )

    renamed = live_client.patch(
        f"/api/v1/mapping-templates/{first['template_id']}",
        headers=headers,
        json={"template_name": "sales-eu"},
    )
    assert renamed.status_code == 200
    body = renamed.json()
    assert body["template_name"] == "sales-eu"
    assert body["versions_count"] == 2  # a rename mints NO version (lineage metadata)
    with admin_engine.connect() as conn:
        names = (
            conn.execute(
                text("SELECT DISTINCT template_name FROM config.source_mappings WHERE template_id = :tid"),
                {"tid": first["template_id"]},
            )
            .scalars()
            .all()
        )
    assert names == ["sales-eu"]  # every lineage row, coherently

    # Renaming onto the sibling template's name: the EXCLUDE constraint, as a 409.
    conflict = live_client.patch(
        f"/api/v1/mapping-templates/{first['template_id']}",
        headers=headers,
        json={"template_name": "inventory"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "mapping_template_name_conflict"


def test_concurrent_patches_converge_to_one_draft(
    live_client: TestClient,
    mint_token: Callable[..., str],
    scratch_source: str,
    admin_engine: Engine,
) -> None:
    """The lock-then-reread proof (found in the 14b validation pass).

    Deterministic interleaving: txn1 holds the lineage FOR UPDATE, inserts a
    DRAFT v2, commits; txn2's patch_template was blocked behind it the whole
    time. Under a single locked read txn2 resumes on a stale statement snapshot
    (no v2), takes the new-version branch, and the seq trigger — running on a
    FRESH snapshot — assigns seq 3 without tripping the unique backstop: a
    double-DRAFT (reproduced live before the fix). The re-read makes txn2 see
    v2 and edit it in place.
    """
    import asyncio
    import json as jsonlib

    from dis_rls import create_rls_engine, rls_session
    from dis_ui_server.repos.mapping_templates import get_template_rows, patch_template

    created = _create(live_client, mint_token, scratch_source).json()
    template_id = UUID(created["template_id"])
    active_mvid = created["versions"][0]["mapping_version_id"]
    _force_status(admin_engine, active_mvid, "ACTIVE")

    tenant = UUID(TENANT_A)
    concurrent_rules = _sale_rules(constant_currency="GBP")
    patched_rules = _sale_rules(constant_currency="USD")

    async def _race() -> list[Any]:
        engine = create_rls_engine()
        try:

            async def txn1() -> None:
                async with rls_session(engine, tenant) as conn:
                    await conn.execute(
                        text("SELECT * FROM config.source_mappings WHERE template_id = :t FOR UPDATE"),
                        {"t": str(template_id)},
                    )
                    await asyncio.sleep(1.0)  # txn2 is now blocked behind the lock
                    await conn.execute(
                        text(
                            "INSERT INTO config.source_mappings (tenant_id, source_id, template_id, "
                            "template_name, status, mapping_rules, predecessor_version_id) VALUES "
                            "(:ten, :src, :t, 'sales', 'DRAFT', CAST(:r AS jsonb), :p)"
                        ),
                        {
                            "ten": str(tenant),
                            "src": scratch_source,
                            "t": str(template_id),
                            "r": jsonlib.dumps(concurrent_rules),
                            "p": active_mvid,
                        },
                    )
                # context exit commits the DRAFT v2

            async def txn2() -> None:
                await asyncio.sleep(0.3)  # start while txn1 holds the lock
                await patch_template(
                    engine,
                    tenant,
                    template_id,
                    template_name=None,
                    mapping_rules=patched_rules,
                    created_by_user_id=None,
                )

            await asyncio.gather(txn1(), txn2())
            return list(await get_template_rows(engine, tenant, template_id))
        finally:
            await engine.dispose()

    rows = asyncio.run(_race())
    drafts = [row for row in rows if row.status == "DRAFT"]
    assert len(rows) == 2, [(r.version_seq_per_source, r.status) for r in rows]
    assert len(drafts) == 1  # NOT a double-DRAFT
    (draft,) = drafts
    assert draft.version_seq_per_source == 2
    assert draft.predecessor_version_id == active_mvid  # chain stays coherent
    # txn2 edited txn1's committed DRAFT in place (branch 3), not a new version.
    assert draft.mapping_rules["derive"]["currency"][0]["args"]["value"] == "USD"


def test_rename_plus_rules_conflict_rolls_back_together(
    live_client: TestClient,
    mint_token: Callable[..., str],
    scratch_source: str,
) -> None:
    """One PATCH carrying BOTH a colliding rename AND new rules: 409, and the
    transaction leaves NOTHING behind — neither the rename nor the rules edit."""
    headers = _bearer(mint_token(tenant_id=TENANT_A))
    first = _create(live_client, mint_token, scratch_source, template_name="sales").json()
    _create(live_client, mint_token, scratch_source, template_name="inventory")

    response = live_client.patch(
        f"/api/v1/mapping-templates/{first['template_id']}",
        headers=headers,
        json={
            "template_name": "inventory",  # collides on the EXCLUDE
            "mapping_rules": _sale_rules(constant_currency="GBP"),
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "mapping_template_name_conflict"

    detail = live_client.get(f"/api/v1/mapping-templates/{first['template_id']}", headers=headers).json()
    assert detail["template_name"] == "sales"  # rename rolled back
    assert detail["versions_count"] == 1  # no rules edit landed
    rules = detail["versions"][0]["mapping_rules"]
    assert rules["derive"]["currency"][0]["args"]["value"] == "EUR"  # original rules intact


def test_well_formed_unknown_tenant_reads_empty_writes_403(
    live_client: TestClient, mint_token: Callable[..., str], scratch_source: str
) -> None:
    """A verified token whose tenant_id is a well-formed UUID DIS never mirrored:
    reads are indistinguishable from 'tenant with no data' (no oracle), and the
    one place the difference is detectable — the tenant FK on create — is a
    clean 403, not a 500."""
    ghost = str(new_uuid7())
    headers = _bearer(mint_token(tenant_id=ghost))

    assert live_client.get("/api/v1/mapping-templates", headers=headers).json() == []
    detail = live_client.get(f"/api/v1/mapping-templates/{new_uuid7()}", headers=headers)
    assert detail.status_code == 404
    assert detail.json()["error"]["code"] == "resource_not_found"  # same 404 as no-data tenants

    create = live_client.post(
        "/api/v1/mapping-templates",
        headers=headers,
        json={"source_id": scratch_source, "template_name": "ghost", "mapping_rules": _sale_rules()},
    )
    assert create.status_code == 403, create.text
    body = create.json()["error"]
    assert body["code"] == "tenant_scope"
    assert "not provisioned" in body["message"]


def test_no_endpoint_can_mint_active_or_staged(
    live_client: TestClient, mint_token: Callable[..., str], scratch_source: str
) -> None:
    # The 14a consumer `.first()` hazard guard: across a create + an in-place edit
    # + a rename, every stored row is still DRAFT (lifecycle transitions belong
    # to the promote slice — no path here writes ACTIVE/STAGED).
    headers = _bearer(mint_token(tenant_id=TENANT_A))
    template_id = _create(live_client, mint_token, scratch_source).json()["template_id"]
    live_client.patch(
        f"/api/v1/mapping-templates/{template_id}",
        headers=headers,
        json={"mapping_rules": _sale_rules(constant_currency="USD"), "template_name": "renamed"},
    )
    detail = live_client.get(f"/api/v1/mapping-templates/{template_id}", headers=headers).json()
    assert {v["status"] for v in detail["versions"]} == {"draft"}
