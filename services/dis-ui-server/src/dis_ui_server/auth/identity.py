"""The verified-request identity value (contract §2.1).

DISTINCT from ``dis_core.identity.models.Identity`` (the UUID-typed Customer
Master contract model used by the identity-service client): this dataclass is
the auth seam's wire-opaque view — ``tenant_id`` / ``store_id`` are opaque
strings to handlers (per D37/D52 the real values are internal UUIDs serialized
lowercase, but nothing here parses them), and ``tenant_id is None`` means a
PLATFORM (cross-tenant ops) user. Never import the dis-core model here.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Identity:
    """What the verified token asserts about the caller.

    Every field is read from the verified token ONLY (the foundation rule);
    no request body, query param, or unverified header contributes. The
    ``user_type`` posture is derived, not stored: TENANT when ``tenant_id``
    is set, PLATFORM when it is ``None`` (gated by ``require_ops``).
    """

    user_id: str
    tenant_id: str | None
    store_id: str | None
    roles: tuple[str, ...]
