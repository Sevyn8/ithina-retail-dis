"""Pydantic models for the Identity Service contract.

These mirror the component schemas in
``contracts/identity-service/identity_service.openapi.yaml`` (the authoritative
contract). Field patterns, required fields, and enum vocabularies are copied from
that file; if the contract changes, these models change with it (additive only,
per the contract's versioning rules).

Note on identifiers: ``tenant_id`` / ``store_id`` here are the *external* string
identifiers (``t_*`` / ``s_*``) the contract exposes. They are NOT the internal
UUID primary keys used by ``identity_mirror`` / canonical tables. The external↔UUID
translation is an unresolved architecture decision (see the Slice 2 plan §2,
deferred to Slice 7); this module only carries the contract's external form.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# Identifier patterns — copied verbatim from the OpenAPI contract.
TENANT_ID_PATTERN = r"^t_[a-z0-9]{12}$"
STORE_ID_PATTERN = r"^s_[a-z0-9]{12}$"
UPLOAD_SESSION_ID_PATTERN = r"^us_[a-z0-9]{12}$"
ENDPOINT_CONFIG_ID_PATTERN = r"^ec_[a-z0-9]{12}$"

TenantId = Annotated[str, Field(pattern=TENANT_ID_PATTERN, examples=["t_acme9k2l1mn4"])]
StoreId = Annotated[str, Field(pattern=STORE_ID_PATTERN, examples=["s_acme0001a4b7"])]

# Where an identity/validation answer was sourced from.
# Identity responses use the first three; validate may also use identity_mirror_fallback.
IdentitySource = Literal["cache_fresh", "cache_stale", "customer_master"]
ValidateSource = Literal[
    "cache_fresh",
    "cache_stale",
    "customer_master",
    "identity_mirror_fallback",
]

ErrorCode = Literal[
    "unauthorized",
    "identity_not_found",
    "circuit_open",
    "internal_error",
    "invalid_request",
]


class Identity(BaseModel):
    """Resolved identity returned by the three ``resolve_*`` methods."""

    model_config = ConfigDict(extra="forbid")

    tenant_id: TenantId
    store_id: StoreId
    is_active: bool
    source: IdentitySource
    metadata: dict[str, Any] | None = None
    resolved_at: str | None = None


class ValidateResponse(BaseModel):
    """Existence + active check returned by ``validate``."""

    model_config = ConfigDict(extra="forbid")

    exists: bool
    is_active: bool
    source: ValidateSource


class ResolveFromTokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jwt: str


class ResolveFromUploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    upload_session_id: Annotated[str, Field(pattern=UPLOAD_SESSION_ID_PATTERN, examples=["us_a1b2c3d4e5f6"])]


class ResolveFromEndpointRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint_config_id: Annotated[
        str, Field(pattern=ENDPOINT_CONFIG_ID_PATTERN, examples=["ec_aabbccddeeff"])
    ]


class ValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_id: TenantId
    store_id: StoreId


class Error(BaseModel):
    """Error envelope returned on every non-2xx response."""

    model_config = ConfigDict(extra="forbid")

    error_code: ErrorCode
    message: str
    trace_id: str | None = None
