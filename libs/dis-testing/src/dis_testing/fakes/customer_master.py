"""Customer Master fake (FastAPI) for the local devbox and tests.

Stands in for the real Customer Master so DIS can be tested without it. It:
  * issues signed (RS256) test JWTs,
  * publishes a JWKS endpoint for signature verification,
  * creates/serves upload sessions (``us_*``),
  * emits ``identity.changed`` Pub/Sub events on a "change".

HARD BOUNDARIES (slice scope):
  * **No real authentication / authorization.** It signs whatever token is asked
    for; it validates no credentials and enforces no access. The signature +
    JWKS exist only so the *consumer's* verification path is exercised for real.
  * **No identity resolution** (that's the Identity Service fake / Slice 13).

PROVISIONAL (R2/R3): the Customer Master contract is not yet signed off. The JWT
claim set, JWKS shape, issuer/audience, and the very fact that this fake (rather
than the Identity Service) emits ``identity.changed`` are provisional. The emitted
message still validates against the frozen ``identity.changed`` schema; the
publication *topology* is what is provisional. Revisit on CM contract sign-off.
"""

from __future__ import annotations

import json
import secrets
import time
from typing import Literal

import jwt
import uuid_utils
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from dis_testing import fixtures as fx
from dis_testing.fakes.pubsub import EmulatorPublisher, Publisher

IDENTITY_CHANGED_TOPIC = "identity.changed"
IDENTITY_CHANGED_SCHEMA_VERSION = 1


# ---------------------------------------------------------------------------
# JWKS + token issuance
# ---------------------------------------------------------------------------
def build_jwks() -> dict[str, object]:
    """Build the JWKS document from the committed test public key."""
    public_key = load_pem_public_key(fx.TEST_RSA_PUBLIC_KEY_PEM.encode())
    # load_pem_public_key returns a broad key union; our committed PEM is RSA.
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(public_key))  # type: ignore[arg-type]
    jwk.update({"kid": fx.TEST_JWT_KID, "use": "sig", "alg": fx.TEST_JWT_ALG})
    return {"keys": [jwk]}


def issue_jwt(
    *,
    tenant: fx.TenantFixture,
    store: fx.StoreFixture | None,
    user_id: str = fx.DEFAULT_USER_ID,
    roles: tuple[str, ...] = fx.DEFAULT_ROLES,
    expires_in: int = 3600,
) -> str:
    """Issue a signed (RS256) test JWT carrying the provisional CM claim set."""
    now = int(time.time())
    claims = fx.build_claims(
        tenant, store, user_id=user_id, roles=roles, issued_at=now, expires_at=now + expires_in
    )
    return jwt.encode(
        claims,
        fx.TEST_RSA_PRIVATE_KEY_PEM,
        algorithm=fx.TEST_JWT_ALG,
        headers={"kid": fx.TEST_JWT_KID},
    )


def build_identity_changed(req: ChangeRequest) -> dict[str, object]:
    """Build an ``identity.changed`` message conforming to the frozen schema."""
    if req.entity == "tenant":
        tenant = fx.tenant_by_external_id(req.external_id)
        owning_tenant = tenant.external_id
        name = tenant.name
        metadata: dict[str, object] = dict(tenant.metadata)
        source_ts = tenant.pc_updated_at
        is_active = tenant.is_active
    else:
        store = fx.store_by_external_id(req.external_id)
        owning_tenant = store.tenant_external_id
        name = store.name
        metadata = {}
        source_ts = store.pc_updated_at
        is_active = store.is_active

    if req.event_type == "deactivated":
        is_active = False

    return {
        "schema_version": IDENTITY_CHANGED_SCHEMA_VERSION,
        "event_id": str(uuid_utils.uuid7()),
        "event_type": req.event_type,
        "entity": req.entity,
        "entity_id": req.external_id,
        "tenant_id": owning_tenant,
        "source_ts": source_ts.isoformat(),
        "payload": {"name": name, "is_active": is_active, "metadata": metadata},
    }


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------
class TokenRequest(BaseModel):
    tenant_external_id: str | None = None
    store_external_id: str | None = None
    user_id: str | None = None
    roles: list[str] | None = None
    expires_in: int = 3600


class TokenResponse(BaseModel):
    jwt: str
    token_type: str = "Bearer"
    expires_in: int


class UploadSessionRequest(BaseModel):
    tenant_external_id: str | None = None
    store_external_id: str | None = None


class UploadSessionResponse(BaseModel):
    upload_session_id: str
    tenant_id: str
    store_id: str
    expires_at: int


class ChangeRequest(BaseModel):
    entity: Literal["tenant", "store"]
    external_id: str
    event_type: Literal["created", "updated", "deactivated"] = "updated"


class ChangeResponse(BaseModel):
    message_id: str
    message: dict[str, object]


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------
def create_app(publisher: Publisher | None = None) -> FastAPI:
    """Build the CM fake app.

    ``publisher`` may be injected (tests pass an ``InMemoryPublisher``). If left
    ``None`` it is created lazily as an :class:`EmulatorPublisher` on first publish,
    so importing this module / building the app for unit tests does not require the
    emulator.
    """
    app = FastAPI(title="DIS Customer Master fake", version="0.0.0")
    app.state.publisher = publisher
    # Upload sessions live on the app instance so each app has its own store.
    sessions: dict[str, dict[str, object]] = {}
    app.state.upload_sessions = sessions

    def _publisher() -> Publisher:
        if app.state.publisher is None:
            app.state.publisher = EmulatorPublisher()
        return app.state.publisher

    def _resolve_tenant_store(
        tenant_external_id: str | None, store_external_id: str | None
    ) -> tuple[fx.TenantFixture, fx.StoreFixture | None]:
        tenant = fx.tenant_by_external_id(tenant_external_id) if tenant_external_id else fx.PRIMARY_TENANT
        if store_external_id:
            return tenant, fx.store_by_external_id(store_external_id)
        if tenant_external_id is None:
            return tenant, fx.PRIMARY_STORE
        stores = fx.stores_for_tenant(tenant.external_id)
        return tenant, (stores[0] if stores else None)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/.well-known/jwks.json")
    def jwks() -> dict[str, object]:
        return build_jwks()

    @app.post("/v1/tokens", response_model=TokenResponse)
    def issue_token(req: TokenRequest) -> TokenResponse:
        tenant, store = _resolve_tenant_store(req.tenant_external_id, req.store_external_id)
        token = issue_jwt(
            tenant=tenant,
            store=store,
            user_id=req.user_id or fx.DEFAULT_USER_ID,
            roles=tuple(req.roles) if req.roles is not None else fx.DEFAULT_ROLES,
            expires_in=req.expires_in,
        )
        return TokenResponse(jwt=token, expires_in=req.expires_in)

    @app.post("/v1/upload-sessions", response_model=UploadSessionResponse)
    def create_upload_session(req: UploadSessionRequest) -> UploadSessionResponse:
        tenant, store = _resolve_tenant_store(req.tenant_external_id, req.store_external_id)
        if store is None:
            store = fx.PRIMARY_STORE
        session_id = "us_" + secrets.token_hex(6)  # 12 hex chars -> matches ^us_[a-z0-9]{12}$
        expires_at = int(time.time()) + 3600
        sessions[session_id] = {
            "upload_session_id": session_id,
            "tenant_id": tenant.external_id,
            "store_id": store.external_id,
            "expires_at": expires_at,
        }
        return UploadSessionResponse(**sessions[session_id])  # type: ignore[arg-type]

    @app.get("/v1/upload-sessions/{session_id}", response_model=UploadSessionResponse)
    def get_upload_session(session_id: str) -> UploadSessionResponse:
        session = sessions.get(session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="upload session not found")
        return UploadSessionResponse(**session)  # type: ignore[arg-type]

    @app.post("/v1/changes", response_model=ChangeResponse)
    def emit_change(req: ChangeRequest) -> ChangeResponse:
        message = build_identity_changed(req)
        data = json.dumps(message).encode()
        message_id = _publisher().publish(IDENTITY_CHANGED_TOPIC, data)
        return ChangeResponse(message_id=message_id, message=message)

    return app


# Module-level app for uvicorn (docker-compose). Publisher is created lazily.
app = create_app()
