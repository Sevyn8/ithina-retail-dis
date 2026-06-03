"""Unit tests for the Identity Service fake.

Every response is validated against the authoritative OpenAPI component schema
(acceptance criterion 4). The fake is also driven through ``HttpIdentityClient``
to confirm the drop-in client interface works against it (criterion 8).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
import yaml
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from dis_core.identity import HttpIdentityClient, Identity, IdentityNotFoundError
from dis_testing import fixtures as fx
from dis_testing.fakes.customer_master import issue_jwt
from dis_testing.fakes.identity_service import create_app


def _repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "contracts" / "identity-service").is_dir():
            return parent
    raise RuntimeError("could not locate repo root")


_OPENAPI = yaml.safe_load(
    (_repo_root() / "contracts" / "identity-service" / "identity_service.openapi.yaml").read_text()
)
_REGISTRY = Registry().with_resource(
    "urn:oas", Resource.from_contents(_OPENAPI, default_specification=DRAFT202012)
)


def _validator(component: str) -> Draft202012Validator:
    return Draft202012Validator({"$ref": f"urn:oas#/components/schemas/{component}"}, registry=_REGISTRY)


def _assert_valid(component: str, instance: Any) -> None:
    _validator(component).validate(instance)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_healthz_and_readyz(client: TestClient) -> None:
    assert client.get("/healthz").status_code == 200
    assert client.get("/readyz").status_code == 200


def test_resolve_from_token_conforms_to_identity(client: TestClient) -> None:
    token = issue_jwt(tenant=fx.PRIMARY_TENANT, store=fx.PRIMARY_STORE)
    resp = client.post("/v1/resolve_from_token", json={"jwt": token})
    assert resp.status_code == 200
    body = resp.json()
    _assert_valid("Identity", body)
    assert body["tenant_id"] == fx.PRIMARY_TENANT.external_id
    assert body["store_id"] == fx.PRIMARY_STORE.external_id


def test_resolve_from_upload_conforms_to_identity(client: TestClient) -> None:
    resp = client.post("/v1/resolve_from_upload", json={"upload_session_id": "us_a1b2c3d4e5f6"})
    assert resp.status_code == 200
    _assert_valid("Identity", resp.json())


def test_resolve_from_endpoint_conforms_to_identity(client: TestClient) -> None:
    resp = client.post("/v1/resolve_from_endpoint", json={"endpoint_config_id": "ec_aabbccddeeff"})
    assert resp.status_code == 200
    _assert_valid("Identity", resp.json())


def test_validate_conforms_to_validate_response(client: TestClient) -> None:
    resp = client.post(
        "/v1/validate",
        json={"tenant_id": fx.PRIMARY_TENANT.external_id, "store_id": fx.PRIMARY_STORE.external_id},
    )
    assert resp.status_code == 200
    body = resp.json()
    _assert_valid("ValidateResponse", body)
    assert body["exists"] is True
    assert body["is_active"] is True


def test_validate_unknown_pair_returns_exists_false(client: TestClient) -> None:
    resp = client.post(
        "/v1/validate",
        json={"tenant_id": "t_unknown00000", "store_id": "s_unknown00000"},
    )
    assert resp.status_code == 200
    body = resp.json()
    _assert_valid("ValidateResponse", body)
    assert body["exists"] is False
    assert body["is_active"] is False


def test_inactive_store_resolves_with_is_active_false(client: TestClient) -> None:
    # Acme suburb store is INACTIVE in the fixture set.
    token = issue_jwt(tenant=fx.PRIMARY_TENANT, store=fx.store_by_external_id("s_acme0002c5d8"))
    body = client.post("/v1/resolve_from_token", json={"jwt": token}).json()
    _assert_valid("Identity", body)
    assert body["is_active"] is False


def test_unknown_tenant_token_returns_error_envelope(client: TestClient) -> None:
    # A token whose tenant claim is unknown -> 404 + Error schema.
    unsigned = _unsigned_jwt({"tenant_id": "t_unknown00000", "store_id": "s_unknown00000"})
    resp = client.post("/v1/resolve_from_token", json={"jwt": unsigned})
    assert resp.status_code == 404
    _assert_valid("Error", resp.json())
    assert resp.json()["error_code"] == "identity_not_found"


async def test_drop_in_client_against_fake() -> None:
    # The same HttpIdentityClient consumers will use, pointed at the in-process fake.
    app = create_app()
    transport = httpx.ASGITransport(app=app)
    inner = httpx.AsyncClient(base_url="http://identity-service-fake", transport=transport)
    client = HttpIdentityClient("http://identity-service-fake", client=inner)

    token = issue_jwt(tenant=fx.PRIMARY_TENANT, store=fx.PRIMARY_STORE)
    identity = await client.resolve_from_token(token)
    assert isinstance(identity, Identity)
    assert identity.tenant_id == fx.PRIMARY_TENANT.external_id

    with pytest.raises(IdentityNotFoundError):
        await client.resolve_from_token(_unsigned_jwt({"tenant_id": "t_unknown00000"}))

    await client.aclose()


def _unsigned_jwt(claims: dict[str, Any]) -> str:
    # alg=none token: header.payload. (The fake decodes claims without verifying.)
    import base64

    def b64(obj: dict[str, Any]) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    return f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64(claims)}."
