"""Unit tests for the Customer Master fake.

Covers JWT issuance + JWKS verification (acceptance criterion 2) and
``identity.changed`` emission against the frozen schema (criterion 3), all
in-process via FastAPI ``TestClient`` with an injected in-memory publisher.
"""

from __future__ import annotations

import json
from pathlib import Path

import jwt
import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker

from dis_testing import fixtures as fx
from dis_testing.fakes.customer_master import create_app
from dis_testing.fakes.pubsub import InMemoryPublisher
from dis_testing.jwt_verify import verify_cm_jwt


def _repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "contracts" / "pubsub").is_dir():
            return parent
    raise RuntimeError("could not locate repo root (contracts/pubsub)")


def _identity_changed_validator() -> Draft202012Validator:
    schema_path = _repo_root() / "contracts" / "pubsub" / "identity.changed.schema.json"
    schema = json.loads(schema_path.read_text())
    return Draft202012Validator(schema, format_checker=FormatChecker())


@pytest.fixture
def client() -> TestClient:
    app = create_app(publisher=InMemoryPublisher())
    return TestClient(app)


def test_healthz(client: TestClient) -> None:
    assert client.get("/healthz").json() == {"status": "ok"}


def test_jwks_shape(client: TestClient) -> None:
    jwks = client.get("/.well-known/jwks.json").json()
    assert len(jwks["keys"]) == 1
    key = jwks["keys"][0]
    assert key["kty"] == "RSA"
    assert key["kid"] == fx.TEST_JWT_KID
    assert key["alg"] == "RS256"
    assert key["use"] == "sig"


def test_issued_jwt_verifies_against_published_jwks(client: TestClient) -> None:
    # Consumer path: issue token, fetch JWKS, verify signature + claims.
    token = client.post("/v1/tokens", json={}).json()["jwt"]
    jwks = client.get("/.well-known/jwks.json").json()

    claims = verify_cm_jwt(token, jwks, issuer=fx.TEST_JWT_ISSUER, audience=fx.TEST_JWT_AUDIENCE)
    assert claims["tenant_id"] == fx.PRIMARY_TENANT.external_id
    assert claims["store_id"] == fx.PRIMARY_STORE.external_id
    assert claims["roles"] == ["dis:upload"]


def test_tampered_jwt_fails_verification(client: TestClient) -> None:
    token = client.post("/v1/tokens", json={}).json()["jwt"]
    jwks = client.get("/.well-known/jwks.json").json()
    # Flip a character in the signature segment.
    head, payload, sig = token.split(".")
    tampered = f"{head}.{payload}.{sig[:-2]}xx"
    with pytest.raises(jwt.InvalidTokenError):
        verify_cm_jwt(tampered, jwks, issuer=fx.TEST_JWT_ISSUER, audience=fx.TEST_JWT_AUDIENCE)


def test_wrong_audience_rejected(client: TestClient) -> None:
    token = client.post("/v1/tokens", json={}).json()["jwt"]
    jwks = client.get("/.well-known/jwks.json").json()
    with pytest.raises(jwt.InvalidAudienceError):
        verify_cm_jwt(token, jwks, issuer=fx.TEST_JWT_ISSUER, audience="not-dis")


def test_upload_session_create_and_serve(client: TestClient) -> None:
    created = client.post("/v1/upload-sessions", json={}).json()
    assert created["upload_session_id"].startswith("us_")
    assert len(created["upload_session_id"]) == len("us_") + 12
    assert created["tenant_id"] == fx.PRIMARY_TENANT.external_id

    fetched = client.get(f"/v1/upload-sessions/{created['upload_session_id']}").json()
    assert fetched == created


def test_upload_session_404(client: TestClient) -> None:
    assert client.get("/v1/upload-sessions/us_doesnotexist").status_code == 404


@pytest.mark.parametrize(
    ("entity", "external_id", "event_type"),
    [
        ("tenant", fx.PRIMARY_TENANT.external_id, "updated"),
        ("store", fx.PRIMARY_STORE.external_id, "created"),
        ("store", "s_acme0002c5d8", "deactivated"),
    ],
)
def test_identity_changed_validates_against_frozen_schema(
    entity: str, external_id: str, event_type: str
) -> None:
    publisher = InMemoryPublisher()
    app = create_app(publisher=publisher)
    client = TestClient(app)

    resp = client.post(
        "/v1/changes",
        json={"entity": entity, "external_id": external_id, "event_type": event_type},
    )
    assert resp.status_code == 200
    body = resp.json()

    validator = _identity_changed_validator()
    # The returned message is exactly what was published — validate it.
    validator.validate(body["message"])
    # And confirm it was actually handed to the publisher (same bytes).
    published = publisher.messages_for("identity.changed")
    assert len(published) == 1
    validator.validate(json.loads(published[0]))

    assert body["message"]["entity"] == entity
    assert body["message"]["entity_id"] == external_id
    if event_type == "deactivated":
        assert body["message"]["payload"]["is_active"] is False
