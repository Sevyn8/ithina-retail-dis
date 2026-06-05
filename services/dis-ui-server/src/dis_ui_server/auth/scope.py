"""Request-scoping dependencies — the SOLE source of ``tenant_id`` (contract §2.2).

``get_current_identity`` is the one dependency every protected handler hangs
off; ``require_tenant`` / ``require_ops`` are the §2.1 variants built on it.
The foundation rule, made structural: ``tenant_id`` (and the derived TENANT /
PLATFORM posture) comes from the verified token ONLY — these dependencies never
read a request body, query parameter, or unverified header, so no handler can
be handed a tenant scope that did not survive verification. A test proves the
token is the only path (slice Task 7).

Errors raise the dis-core auth-seam classes; the service's exception handlers
map them to 401/403 + the §2.3 envelope (never ``HTTPException`` here —
code-quality convention).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from dis_core.errors import AuthTokenError, OpsRoleRequiredError, TenantScopeError
from dis_ui_server.auth.identity import Identity
from dis_ui_server.auth.verifier import verify_token

OPS_ROLE = "dis:ops"

_BEARER_PREFIX = "Bearer "


async def get_current_identity(request: Request) -> Identity:
    """Resolve the caller's :class:`Identity` from the Authorization header.

    The UI sends ``Authorization: Bearer <token>`` on every call (no cookies,
    no CSRF surface). Anything else is a 401-mapped ``AuthTokenError``.
    """
    header = request.headers.get("Authorization")
    if header is None:
        raise AuthTokenError("Authorization header missing", reason="missing_bearer")
    if not header.startswith(_BEARER_PREFIX):
        raise AuthTokenError("Authorization header is not a Bearer token", reason="missing_bearer")
    return verify_token(header[len(_BEARER_PREFIX) :])


async def require_tenant(
    identity: Annotated[Identity, Depends(get_current_identity)],
) -> Identity:
    """Guarantee a TENANT-scoped identity (``tenant_id`` set), else 403."""
    if identity.tenant_id is None:
        raise TenantScopeError(
            "token carries no tenant_id for a tenant-scoped endpoint",
            tenant_id=None,
        )
    return identity


async def require_ops(
    identity: Annotated[Identity, Depends(get_current_identity)],
) -> Identity:
    """Guarantee the ``dis:ops`` role (PLATFORM user), else 403."""
    if OPS_ROLE not in identity.roles:
        raise OpsRoleRequiredError(f"{OPS_ROLE} role required for an ops endpoint")
    return identity
