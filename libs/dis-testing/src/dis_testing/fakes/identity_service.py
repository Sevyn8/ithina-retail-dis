"""Identity Service fake (FastAPI) for the local devbox and tests.

Answers the four contract methods (``resolve_from_token``, ``resolve_from_upload``,
``resolve_from_endpoint``, ``validate``) with canned data drawn from the single
fixture-truth module, conforming to the authoritative OpenAPI
(``contracts/identity-service/identity_service.openapi.yaml``).

HARD BOUNDARIES (slice scope):
  * **No real identity resolution.** No Customer Master lookup, no cache, no
    circuit breaker, no stale-while-error. Canned answers only. That is Slice 13.
  * Per the contract + service README, this service does **not** verify the JWT
    signature — it extracts identity from claims (the receiver verified the
    signature). So ``resolve_from_token`` decodes the token *unverified*.

Responses are built with the shared ``dis_core.identity`` models, so the fake and
the ``HttpIdentityClient`` consumers use against it agree by construction.
"""

from __future__ import annotations

import jwt
import uuid_utils
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from dis_core.identity.models import (
    Error,
    ErrorCode,
    Identity,
    ResolveFromEndpointRequest,
    ResolveFromTokenRequest,
    ResolveFromUploadRequest,
    ValidateRequest,
    ValidateResponse,
)
from dis_testing import fixtures as fx


class _NotResolvedError(Exception):
    """Internal: identity could not be resolved -> 404 identity_not_found."""


def _error_response(error_code: ErrorCode, message: str, status_code: int) -> JSONResponse:
    err = Error(error_code=error_code, message=message, trace_id=str(uuid_utils.uuid7()))
    return JSONResponse(status_code=status_code, content=err.model_dump())


def _resolve_store(tenant: fx.TenantFixture, store_external_id: str | None) -> fx.StoreFixture:
    if store_external_id:
        store = fx.store_by_external_id(store_external_id)
        if store.tenant_external_id != tenant.external_id:
            raise _NotResolvedError(f"store {store_external_id} not under tenant {tenant.external_id}")
        return store
    stores = fx.stores_for_tenant(tenant.external_id)
    if not stores:
        raise _NotResolvedError(f"tenant {tenant.external_id} has no store")
    return stores[0]


def _identity_for(tenant_external_id: str | None, store_external_id: str | None) -> Identity:
    if not tenant_external_id:
        raise _NotResolvedError("no tenant in artifact")
    try:
        tenant = fx.tenant_by_external_id(tenant_external_id)
    except fx.FixtureError as exc:
        raise _NotResolvedError(str(exc)) from exc
    try:
        store = _resolve_store(tenant, store_external_id)
    except fx.FixtureError as exc:
        raise _NotResolvedError(str(exc)) from exc

    return Identity(
        tenant_id=tenant.external_id,
        store_id=store.external_id,
        is_active=tenant.is_active and store.is_active,
        source="customer_master",
        metadata=dict(tenant.metadata),
        resolved_at=tenant.pc_updated_at.isoformat(),
    )


def create_app() -> FastAPI:
    app = FastAPI(title="DIS Identity Service fake", version="0.0.0")

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    def readyz() -> dict[str, str]:
        # The fake has no upstream; it is always ready.
        return {"status": "ready"}

    @app.post("/v1/resolve_from_token")
    def resolve_from_token(req: ResolveFromTokenRequest) -> JSONResponse:
        try:
            claims = jwt.decode(req.jwt, options={"verify_signature": False})
        except jwt.PyJWTError:
            return _error_response("identity_not_found", "could not decode token", 404)
        return _resolve_or_error(claims.get("tenant_id"), claims.get("store_id"))

    @app.post("/v1/resolve_from_upload")
    def resolve_from_upload(req: ResolveFromUploadRequest) -> JSONResponse:
        # Canned: an upload session resolves to the primary identity. (The fake does
        # not share the CM fake's session store; this is canned data, not resolution.)
        return _resolve_or_error(fx.PRIMARY_TENANT.external_id, fx.PRIMARY_STORE.external_id)

    @app.post("/v1/resolve_from_endpoint")
    def resolve_from_endpoint(req: ResolveFromEndpointRequest) -> JSONResponse:
        # Canned: an endpoint config resolves to the primary identity.
        return _resolve_or_error(fx.PRIMARY_TENANT.external_id, fx.PRIMARY_STORE.external_id)

    @app.post("/v1/validate")
    def validate(req: ValidateRequest) -> JSONResponse:
        # validate returns exists:false as a normal answer (never 404).
        try:
            tenant = fx.tenant_by_external_id(req.tenant_id)
            store = fx.store_by_external_id(req.store_id)
            known = store.tenant_external_id == tenant.external_id
        except fx.FixtureError:
            known = False
            tenant = store = None  # type: ignore[assignment]

        if not known or tenant is None or store is None:
            result = ValidateResponse(exists=False, is_active=False, source="identity_mirror_fallback")
        else:
            result = ValidateResponse(
                exists=True,
                is_active=tenant.is_active and store.is_active,
                source="identity_mirror_fallback",
            )
        return JSONResponse(status_code=200, content=result.model_dump())

    def _resolve_or_error(tenant_external_id: str | None, store_external_id: str | None) -> JSONResponse:
        try:
            identity = _identity_for(tenant_external_id, store_external_id)
        except _NotResolvedError as exc:
            return _error_response("identity_not_found", str(exc), 404)
        return JSONResponse(status_code=200, content=identity.model_dump())

    return app


# Module-level app for uvicorn (docker-compose).
app = create_app()
