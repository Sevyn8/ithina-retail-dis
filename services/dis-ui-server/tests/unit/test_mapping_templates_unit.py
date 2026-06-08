"""Mapping-template endpoints, the DB-free half (auth gates, 400-before-write, envelopes).

The client's database is UNREACHABLE: any 4xx asserted here is proven to occur
BEFORE any DB touch (validation-first ordering — a request rejected by the gate
never opens an rls_session, so nothing invalid can be written even in principle).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from dis_ui_server.repos.mapping_templates import _violates

TENANT_A = "019e89f9-dbd5-7703-8221-ae6b811599bb"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _valid_create_body() -> dict[str, Any]:
    """The Slice 16a create shape: semantic intent per column, no engine ops."""
    return {
        "source_id": "manual_csv_upload",
        "template_name": "sales",
        "template_type": "sales",
        "columns": [
            {"src_key": "item", "dest_key": "sku_id"},
            {"src_key": " qty ", "dest_key": "quantity_sold"},
        ],
    }


# -- auth gates (tenant from token only; §2.1 posture) ------------------------------


def test_endpoints_require_a_token(client: TestClient) -> None:
    assert client.get("/api/v1/mapping-templates").status_code == 401
    assert client.get("/api/v1/stores-onboarded").status_code == 401
    assert client.post("/api/v1/mapping-templates", json=_valid_create_body()).status_code == 401
    assert (
        client.patch(
            "/api/v1/mapping-templates/019e9804-12ce-7f57-b9c0-eb3c7d0e8609",
            json={"template_name": "x"},
        ).status_code
        == 401
    )


def test_platform_token_is_refused_on_tenant_endpoints(
    client: TestClient, mint_token: Callable[..., str]
) -> None:
    ops = _bearer(mint_token(tenant_id=None, roles=("dis:ops",)))
    for response in (
        client.get("/api/v1/mapping-templates", headers=ops),
        client.get("/api/v1/stores-onboarded", headers=ops),
        client.post("/api/v1/mapping-templates", headers=ops, json=_valid_create_body()),
    ):
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "tenant_scope"


def test_malformed_tenant_claim_is_403_not_500(client: TestClient, mint_token: Callable[..., str]) -> None:
    # A non-UUID tenant claim must be refused at the seam edge (tenant_uuid_of),
    # never reach a query cast. The envelope must not echo the claim value.
    response = client.get(
        "/api/v1/stores-onboarded",
        headers=_bearer(mint_token(tenant_id="t_not_a_uuid")),
    )
    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "tenant_scope"
    assert "t_not_a_uuid" not in response.text


# -- 16a synthetic create (shape-validate, no persistence, no mapping_rules) --------
#
# The client's DB is UNREACHABLE (conftest), so a 201 from the create path is itself
# the proof that no rls_session / write was attempted (the hard 16a limit: no DB write
# in the create path). Persistence + the real mapping_rules return in 16c.


def test_create_returns_201_synthetic_detail(client: TestClient, mint_token: Callable[..., str]) -> None:
    response = client.post(
        "/api/v1/mapping-templates", headers=_bearer(mint_token()), json=_valid_create_body()
    )
    assert response.status_code == 201, response.text
    body = response.json()
    # Echoed request fields.
    assert body["source_id"] == "manual_csv_upload"
    assert body["template_name"] == "sales"
    assert body["template_type"] == "sales"
    # A realistic but non-persisted UUIDv7 (Q2).
    assert UUID(body["template_id"]).version == 7
    # Lineage summary: a single synthetic DRAFT.
    assert body["latest_version"] == 1
    assert body["draft_version"] == 1
    assert body["active_version"] is None and body["staged_version"] is None
    assert body["versions_count"] == 1
    (version,) = body["versions"]
    assert version["status"] == "draft"
    assert version["version"] == 1
    assert version["mapping_version_id"] == 0  # sentinel: nothing persisted
    # Empty mapping_rules = the explicit "translation pending (16c)" signal.
    assert version["mapping_rules"] == {
        "version": 1,
        "rename": {},
        "normalize": {},
        "cast": {},
        "derive": {},
    }
    assert version["field_count"] == 0
    assert version["transform_count"] == 0


def test_create_does_not_touch_the_db(client: TestClient, mint_token: Callable[..., str]) -> None:
    # With the DB unreachable, a 201 proves the create path opened no rls_session and
    # attempted no write (a DB touch would raise, never return 201). The hard 16a limit.
    response = client.post(
        "/api/v1/mapping-templates", headers=_bearer(mint_token()), json=_valid_create_body()
    )
    assert response.status_code == 201, response.text


def test_well_formed_declarations_are_accepted(client: TestClient, mint_token: Callable[..., str]) -> None:
    # Every format-declaration field, plus an __ignore__ column. 16a checks they are
    # well-formed; it does NOT check membership or whether one is required (16c).
    body = _valid_create_body()
    body["columns"] = [
        {"src_key": "sku", "dest_key": "sku_id"},
        {
            "src_key": "prezzovend",
            "dest_key": "current_retail_price",
            "src_decimal_separator": ".",
            "src_thousand_separator": ",",
            "src_is_percentage": True,
        },
        {"src_key": "dataprezzo", "dest_key": "expiry_date", "src_datetime_format": "DD-MM-YYYY"},
        {"src_key": "in_volantino", "dest_key": "__ignore__"},
    ]
    response = client.post("/api/v1/mapping-templates", headers=_bearer(mint_token()), json=body)
    assert response.status_code == 201, response.text


# -- 16a shape rejections (4xx ahead of any DB) -------------------------------------


def test_unknown_template_type_is_400(client: TestClient, mint_token: Callable[..., str]) -> None:
    body = _valid_create_body()
    body["template_type"] = "not_a_type"
    response = client.post("/api/v1/mapping-templates", headers=_bearer(mint_token()), json=body)
    assert response.status_code == 400
    envelope = response.json()["error"]
    assert envelope["code"] == "invalid_template_type"
    assert envelope["details"]["tenant_id"] == TENANT_A


def test_missing_column_key_is_422(client: TestClient, mint_token: Callable[..., str]) -> None:
    headers = _bearer(mint_token())
    no_dest = _valid_create_body()
    no_dest["columns"] = [{"src_key": "item"}]  # dest_key missing
    assert client.post("/api/v1/mapping-templates", headers=headers, json=no_dest).status_code == 422
    no_src = _valid_create_body()
    no_src["columns"] = [{"dest_key": "sku_id"}]  # src_key missing
    assert client.post("/api/v1/mapping-templates", headers=headers, json=no_src).status_code == 422


def test_malformed_declaration_is_422(client: TestClient, mint_token: Callable[..., str]) -> None:
    body = _valid_create_body()
    body["columns"] = [{"src_key": "p", "dest_key": "current_retail_price", "src_decimal_separator": ";"}]
    response = client.post("/api/v1/mapping-templates", headers=_bearer(mint_token()), json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_validation"
    assert ";" not in response.text  # 422 strips submitted values


def test_eu_thousands_separator_is_accepted_and_non_member_is_422(
    client: TestClient, mint_token: Callable[..., str]
) -> None:
    # Slice 16b widens src_thousand_separator to include "." so EU-format numbers
    # (1.234,56) are declarable. The closed set still rejects a genuine non-member.
    headers = _bearer(mint_token())
    eu = _valid_create_body()
    eu["columns"] = [
        {"src_key": "sku", "dest_key": "sku_id"},
        {
            "src_key": "prezzovend",
            "dest_key": "current_retail_price",
            "src_decimal_separator": ",",
            "src_thousand_separator": ".",
        },
    ]
    assert client.post("/api/v1/mapping-templates", headers=headers, json=eu).status_code == 201

    bad = _valid_create_body()
    bad["columns"] = [{"src_key": "p", "dest_key": "current_retail_price", "src_thousand_separator": ";"}]
    response = client.post("/api/v1/mapping-templates", headers=headers, json=bad)
    assert response.status_code == 422
    assert ";" not in response.text  # 422 strips submitted values


def test_unknown_column_key_is_422(client: TestClient, mint_token: Callable[..., str]) -> None:
    # Strict columns (extra="forbid", open Q1): a stray key fails loud, not silently dropped.
    body = _valid_create_body()
    body["columns"] = [{"src_key": "item", "dest_key": "sku_id", "typo_field": "x"}]
    response = client.post("/api/v1/mapping-templates", headers=_bearer(mint_token()), json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_validation"


def test_unknown_top_level_key_is_422(client: TestClient, mint_token: Callable[..., str]) -> None:
    # Strict body (extra="forbid"): a stray TOP-LEVEL key fails loud, not silently dropped
    # (pins MappingTemplateCreate.model_config — the column-level guard does not cover it).
    body = _valid_create_body()
    body["mapping_rules"] = {"version": 1}  # the superseded 14b field must NOT be silently accepted
    response = client.post("/api/v1/mapping-templates", headers=_bearer(mint_token()), json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_validation"


def test_empty_columns_is_422(client: TestClient, mint_token: Callable[..., str]) -> None:
    body = _valid_create_body()
    body["columns"] = []
    response = client.post("/api/v1/mapping-templates", headers=_bearer(mint_token()), json=body)
    assert response.status_code == 422


def test_malformed_source_id_is_422(client: TestClient, mint_token: Callable[..., str]) -> None:
    body = _valid_create_body()
    body["source_id"] = "Not Valid!"  # pattern ^[a-z0-9_]{1,128}$
    response = client.post("/api/v1/mapping-templates", headers=_bearer(mint_token()), json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_validation"
    assert "Not Valid!" not in response.text  # 422 strips submitted values


def test_template_name_bounds_are_422(client: TestClient, mint_token: Callable[..., str]) -> None:
    """``template_name`` is bounded min_length=1 / max_length=200 at the schema
    (schemas/mapping_templates.py): empty and over-long names are both a 422
    request_validation envelope, with the submitted value stripped."""
    headers = _bearer(mint_token())

    body = _valid_create_body()
    body["template_name"] = ""
    empty = client.post("/api/v1/mapping-templates", headers=headers, json=body)
    assert empty.status_code == 422
    assert empty.json()["error"]["code"] == "request_validation"

    body = _valid_create_body()
    body["template_name"] = "x" * 201
    too_long = client.post("/api/v1/mapping-templates", headers=headers, json=body)
    assert too_long.status_code == 422
    assert too_long.json()["error"]["code"] == "request_validation"
    assert "x" * 201 not in too_long.text  # 422 strips submitted values


def test_empty_patch_body_is_422(client: TestClient, mint_token: Callable[..., str]) -> None:
    response = client.patch(
        "/api/v1/mapping-templates/019e9804-12ce-7f57-b9c0-eb3c7d0e8609",
        headers=_bearer(mint_token()),
        json={},
    )
    assert response.status_code == 422


def test_non_uuid_template_id_is_422(client: TestClient, mint_token: Callable[..., str]) -> None:
    response = client.get("/api/v1/mapping-templates/not-a-uuid", headers=_bearer(mint_token()))
    assert response.status_code == 422


# -- the IntegrityError discriminator (rule 6: nothing broader than the named ones) --


def _integrity_error(constraint_name: str | None) -> IntegrityError:
    """A real sqlalchemy IntegrityError wrapping a psycopg-shaped orig."""

    class _Diag:
        pass

    class _FakePgDbError(Exception):
        pass

    orig = _FakePgDbError("violation")
    diag = _Diag()
    diag.constraint_name = constraint_name  # type: ignore[attr-defined]
    orig.diag = diag  # type: ignore[attr-defined]
    return IntegrityError("INSERT ...", {}, orig)


def test_violates_matches_only_the_named_constraint() -> None:
    assert _violates(_integrity_error("ex_csm_template_name_per_source"), "ex_csm_template_name_per_source")
    # A DIFFERENT constraint (the partial-unique ACTIVE index, a CHECK, anything)
    # must NOT match — the repo's except blocks then fall through to a bare
    # `raise`, so the error surfaces as a 500, never a misleading 409/403.
    assert not _violates(_integrity_error("uq_csm_active_per_source"), "ex_csm_template_name_per_source")
    assert not _violates(_integrity_error("ck_csm_status_vocab"), "ex_csm_template_name_per_source")
    assert not _violates(_integrity_error(None), "ex_csm_template_name_per_source")


def test_violates_handles_a_diagless_orig() -> None:
    # An orig with no .diag at all (non-psycopg DBAPI shape): False, fall through.
    class _BareDbError(Exception):
        pass

    assert not _violates(IntegrityError("stmt", {}, _BareDbError()), "ex_csm_template_name_per_source")


# -- the new error-family envelopes (probe routes; §7.4 additions) ------------------


def test_new_error_envelopes(client: TestClient) -> None:
    cases = {
        "/api/v1/probe/raise/resource-not-found": (404, "resource_not_found"),
        "/api/v1/probe/raise/template-name-conflict": (409, "mapping_template_name_conflict"),
        "/api/v1/probe/raise/mapping-state-conflict": (409, "mapping_state_conflict"),
    }
    for path, (status, code) in cases.items():
        response = client.get(path)
        assert response.status_code == status, path
        assert response.json()["error"]["code"] == code
