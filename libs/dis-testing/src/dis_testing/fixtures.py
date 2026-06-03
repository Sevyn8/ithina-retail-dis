"""Single source of fixture truth for Slice 2.

This module owns the test identity set used by *all three* pieces of Slice 2:

  * the **seeder** writes these rows (by their internal UUID) into
    ``identity_mirror`` and ``config.source_mappings``;
  * the **Identity Service fake** answers with these external ids (``t_*`` / ``s_*``);
  * the **Customer Master fake** issues JWTs and ``identity.changed`` events carrying
    these external ids;
  * **tests** bridge external id -> internal UUID via :func:`tenant_uuid_for` /
    :func:`store_uuid_for` to read the seeded rows.

INTERIM BRIDGE (Slice 2 plan §2, R1): the contracts expose external string ids
(``t_*`` / ``s_*``); the DB keys rows by UUID. There is no defined translation.
This module pins a deterministic external<->UUID pairing as a **test-only** bridge
so acceptance criterion 6 can be met at the fixture level. It is NOT the
architecture. The real translation is a deferred decision with a hard Slice 7
deadline (Slice 7 writes real Customer Master records into UUID-keyed
``identity_mirror`` and cannot run on this bridge).

The UUIDs below are frozen literal constants (minted once with ``uuid_utils.uuid7()``)
— NOT minted at import. The seeder and the test suite run in separate processes and
must agree on the exact UUIDs, so they cannot be random per-process.

PROVISIONAL JWT/JWKS config (R2): the Customer Master contract is not yet signed
off. The signing algorithm, claim set, issuer, and audience below are built to the
*example* values in ``contracts/identity-service/attribute-needs.md`` and must be
revisited when the CM contract lands.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

from dis_testing.errors import FixtureError

# ---------------------------------------------------------------------------
# Test signing key (RS256) — TEST ONLY. Committed so the CM fake and any verifier
# (in-process or the dockerised fake) share one deterministic key and the JWKS is
# stable. NEVER used outside tests; carries no real authority.
# ---------------------------------------------------------------------------
TEST_JWT_ALG = "RS256"
TEST_JWT_KID = "dis-cm-fake-key-1"

# PROVISIONAL (R2): confirm on Customer Master contract sign-off.
TEST_JWT_ISSUER = "https://customer-master.local"
TEST_JWT_AUDIENCE = "dis"

TEST_RSA_PRIVATE_KEY_PEM = """\
-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDNF83hGGk1CVHV
7FpLZXaIE5bLoPrfX7fUQLJN7/tONZAnbRN3xZwyTDeUUYOa3dOVdQKaWSOoOiuL
dAVH/kfg95nzwAPArxuEtexMa27UYNcubzx4wn0xbEawM/U9MaFAM7/qztjcDXCq
Y0r/yNVx2OehqoYLQU3Bd0EHrq2or3pTE6WZ9wxZbNWNRPlH2vZ5T/9piZ0N10Qk
kD4hznD6IJgcgfE4l8TJMzdzuhTDlcc0xZ277V7ZBzIjNkyNoE2jAZ1iQE9C9Exc
QCtC2UvUtB3apVhmuUuP9vpAcGiJl4TaKDiQOzx36hoCuTzKwhC37nE7eJZkDmV/
h8SWhLThAgMBAAECggEAARtFAx6DkX2Aswm99bQK90wxrok+LxuW5Vf8+fpOG/rn
SiJleR4Zis1GaUx5ewnLrMK+yT5+0S/WAPFKmllh0JHcflglApO6+ScpshFa5Syn
FNztwcb/Y42nH1Pr+Y+1nMAI4VbFwvcFQJo9owfTPEq2RIZI5X207W39LY0sW6or
EqT2EIylJCGhJfh+jtGwtYI5HuVJC8sahr2FVYrvu5ca04jgRzxhPOAvXZlvq1iK
hootFD0uTuKCpZz8WKhRDAoYAaDA1Nnln7aIgbibjy+ElIjT4qq7a7g9gzUCF6Nh
wVHteFPzTQcvThfGCHUfKN3C2dY0oZ2L87zWRmcl2QKBgQD1FwWB3gmX1WXxOoab
r6OPNVLy+Ma0Ep6StYKUB0CibAMAyO9K0X1o7VYSSku+lqLN9x25vuwQaua8UaDn
rg2uwDlEhBZiQw162tov1WaL9+gu6PrDS2VD7CgbaMkXcYO7fo6stdTY84QvyrYn
Hj78oJOcg5045r1CJUCaFdhh2QKBgQDWOP0F04POhj1dtApb5Etgd1oNhF7mVam6
MznNj+CVQzGcSyYg2nQ+3dkdGm0MkyyqzuraHZQNHgoTlYxDBtDbEahhiN6xaLe2
kye2HUkqn1+7MfJ05GnRo3uNempYipuaAwUb+cjvTvFzB5QqFARR4mgE5fxJ+viF
+yWYR+h+SQKBgQCh+28mX8tTUDSp9BZW+wRMd9+0ufsJtGydZd1BXHG5Z02szSBq
AH60RHfoarYY5pH/Ml2xD6ARUbXhrMl9lalxX5X51Jq+orZcBhzCFHZL97K6njxt
qnzpIUF4rA6LsfhwiLpfJ2XfZUJuG7m7rN/QM4ibntjgbI+VEe3aaKm0MQKBgGic
w9MIi6FbJLSRq01cmwKsxik7ryxEQPJQ+bVMwZuiiKOOfzwj8giRRelUclRlurZe
/YkuUJJnTPxrV2eT+IJCiTu4Hyf7v1tFWWsxuf06fwFnTsOOl65sa3WXhj9e0MXR
G7mhrWJP5tEJrm0uAT4LlkhuF1n5WUv0bVOEKiEhAoGBAIgy5MWXe7rJsz+DfdOB
NIwDIq/h8aJmvfFI3elrY8WaqFWw+zwfqhyNwJb7FyQ9vjmg76KUtjN80ejvtf5R
LkMhpIvZ5LQaN+5sFMoPrP2cfJjZRXTsSbFkq14dre1SsJH3jj2Hl19q1fYP/OSp
ZbJpYsWFDHLKYoXaZG6rx7vE
-----END PRIVATE KEY-----
"""

TEST_RSA_PUBLIC_KEY_PEM = """\
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzRfN4RhpNQlR1exaS2V2
iBOWy6D631+31ECyTe/7TjWQJ20Td8WcMkw3lFGDmt3TlXUCmlkjqDori3QFR/5H
4PeZ88ADwK8bhLXsTGtu1GDXLm88eMJ9MWxGsDP1PTGhQDO/6s7Y3A1wqmNK/8jV
cdjnoaqGC0FNwXdBB66tqK96UxOlmfcMWWzVjUT5R9r2eU//aYmdDddEJJA+Ic5w
+iCYHIHxOJfEyTM3c7oUw5XHNMWdu+1e2QcyIzZMjaBNowGdYkBPQvRMXEArQtlL
1LQd2qVYZrlLj/b6QHBoiZeE2ig4kDs8d+oaArk8ysIQt+5xO3iWZA5lf4fEloS0
4QIDAQAB
-----END PUBLIC KEY-----
"""


# ---------------------------------------------------------------------------
# Fixture data types
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class TenantFixture:
    """A test tenant in both representations plus its identity_mirror columns."""

    external_id: str  # t_* — the contract form
    uuid: UUID  # identity_mirror.tenants.tenant_id — the DB key
    name: str
    status: str  # identity_mirror.tenants vocab: ONBOARDING/TRIAL/ACTIVE/SUSPENDED/TERMINATED
    pc_created_at: datetime
    pc_updated_at: datetime
    metadata: dict[str, object] = field(default_factory=dict)

    @property
    def is_active(self) -> bool:
        return self.status == "ACTIVE"


@dataclass(frozen=True)
class StoreFixture:
    """A test store in both representations plus its identity_mirror columns."""

    external_id: str  # s_*
    uuid: UUID  # identity_mirror.stores.store_id
    tenant_external_id: str
    name: str
    status: str  # identity_mirror.stores vocab: OPENING/ACTIVE/INACTIVE/CLOSED
    country: str
    timezone: str
    currency: str
    tax_treatment: str  # INCLUSIVE / EXCLUSIVE
    pc_created_at: datetime
    pc_updated_at: datetime

    @property
    def is_active(self) -> bool:
        return self.status == "ACTIVE"


# Fixed lifecycle timestamps (deterministic; no wall-clock at import).
_CREATED = datetime(2024, 1, 15, 0, 0, 0, tzinfo=UTC)
_UPDATED = datetime(2026, 5, 1, 0, 0, 0, tzinfo=UTC)

# ---------------------------------------------------------------------------
# The default fixture set: 2 tenants, 2 stores each (one ACTIVE, one INACTIVE).
# The primary tenant/store use the OpenAPI example ids so canned answers line up
# with the contract examples.
# ---------------------------------------------------------------------------
TENANTS: tuple[TenantFixture, ...] = (
    TenantFixture(
        external_id="t_acme9k2l1mn4",
        uuid=UUID("019e89f9-dbd5-7703-8221-ae6b811599bb"),
        name="Acme Retail",
        status="ACTIVE",
        pc_created_at=_CREATED,
        pc_updated_at=_UPDATED,
        metadata={"pii_policy_version": "v1", "region": "us-east"},
    ),
    TenantFixture(
        external_id="t_globex8ts5wz",
        uuid=UUID("019e89f9-dbd5-7703-8221-ae707db9b918"),
        name="Globex Stores",
        status="ACTIVE",
        pc_created_at=_CREATED,
        pc_updated_at=_UPDATED,
        metadata={"pii_policy_version": "v1", "region": "eu-west"},
    ),
)

STORES: tuple[StoreFixture, ...] = (
    StoreFixture(
        external_id="s_acme0001a4b7",
        uuid=UUID("019e89f9-dbd5-7703-8221-ae8bfa6528bf"),
        tenant_external_id="t_acme9k2l1mn4",
        name="Acme Downtown #1",
        status="ACTIVE",
        country="US",
        timezone="America/New_York",
        currency="USD",
        tax_treatment="EXCLUSIVE",
        pc_created_at=_CREATED,
        pc_updated_at=_UPDATED,
    ),
    StoreFixture(
        external_id="s_acme0002c5d8",
        uuid=UUID("019e89f9-dbd5-7703-8221-ae9c0f7f63ba"),
        tenant_external_id="t_acme9k2l1mn4",
        name="Acme Suburb #2 (closed)",
        status="INACTIVE",
        country="US",
        timezone="America/Chicago",
        currency="USD",
        tax_treatment="EXCLUSIVE",
        pc_created_at=_CREATED,
        pc_updated_at=_UPDATED,
    ),
    StoreFixture(
        external_id="s_globex0001a1",
        uuid=UUID("019e89f9-dbd5-7703-8221-aea1bb97d53d"),
        tenant_external_id="t_globex8ts5wz",
        name="Globex Central #1",
        status="ACTIVE",
        country="GB",
        timezone="Europe/London",
        currency="GBP",
        tax_treatment="INCLUSIVE",
        pc_created_at=_CREATED,
        pc_updated_at=_UPDATED,
    ),
    StoreFixture(
        external_id="s_globex0002b2",
        uuid=UUID("019e89f9-dbd5-7703-8221-aeb75beccb78"),
        tenant_external_id="t_globex8ts5wz",
        name="Globex North #2 (closed)",
        status="INACTIVE",
        country="GB",
        timezone="Europe/London",
        currency="GBP",
        tax_treatment="INCLUSIVE",
        pc_created_at=_CREATED,
        pc_updated_at=_UPDATED,
    ),
)

# Primary tenant/store — the ones the OpenAPI examples use; the default the fakes
# resolve to when an artifact does not name a specific identity.
PRIMARY_TENANT = TENANTS[0]
PRIMARY_STORE = STORES[0]

# ---------------------------------------------------------------------------
# Default config.source_mappings row (so mapping_version_id FKs resolve in later
# slices' tests). One ACTIVE mapping for the primary tenant.
# ---------------------------------------------------------------------------
DEFAULT_SOURCE_ID = "manual_csv_upload"
DEFAULT_SOURCE_MAPPING: dict[str, object] = {
    "tenant_external_id": PRIMARY_TENANT.external_id,
    "source_id": DEFAULT_SOURCE_ID,
    "status": "ACTIVE",
    "mapping_rules": {
        "version": 1,
        "rename": {},
        "normalize": {},
        "cast": {},
        "derive": {},
    },
}

# ---------------------------------------------------------------------------
# Lookups + the external<->UUID bridge
# ---------------------------------------------------------------------------
_TENANTS_BY_EXTERNAL = {t.external_id: t for t in TENANTS}
_STORES_BY_EXTERNAL = {s.external_id: s for s in STORES}


def tenant_by_external_id(external_id: str) -> TenantFixture:
    try:
        return _TENANTS_BY_EXTERNAL[external_id]
    except KeyError as exc:
        raise FixtureError(f"unknown fixture tenant external_id: {external_id!r}") from exc


def store_by_external_id(external_id: str) -> StoreFixture:
    try:
        return _STORES_BY_EXTERNAL[external_id]
    except KeyError as exc:
        raise FixtureError(f"unknown fixture store external_id: {external_id!r}") from exc


def tenant_uuid_for(external_id: str) -> UUID:
    """Bridge: external tenant id (t_*) -> internal UUID the seeder wrote."""
    return tenant_by_external_id(external_id).uuid


def store_uuid_for(external_id: str) -> UUID:
    """Bridge: external store id (s_*) -> internal UUID the seeder wrote."""
    return store_by_external_id(external_id).uuid


def stores_for_tenant(tenant_external_id: str) -> tuple[StoreFixture, ...]:
    return tuple(s for s in STORES if s.tenant_external_id == tenant_external_id)


# ---------------------------------------------------------------------------
# JWT claim builder (provisional shape, R2). Used by the CM fake to issue tokens
# and by the resolve_from_token canned answer to stay consistent.
# ---------------------------------------------------------------------------
DEFAULT_USER_ID = "u_acmeuser0001"
DEFAULT_ROLES = ("dis:upload",)


def build_claims(
    tenant: TenantFixture,
    store: StoreFixture | None,
    *,
    user_id: str = DEFAULT_USER_ID,
    roles: tuple[str, ...] = DEFAULT_ROLES,
    issued_at: int,
    expires_at: int,
) -> dict[str, object]:
    """Build the (provisional) Customer Master JWT claim set.

    Claims follow attribute-needs.md §2; ``iat``/``exp`` are passed in so the
    caller controls the clock (no wall-clock here). External ids only — the JWT
    never carries internal UUIDs.
    """
    claims: dict[str, object] = {
        "iss": TEST_JWT_ISSUER,
        "aud": TEST_JWT_AUDIENCE,
        "sub": user_id,
        "tenant_id": tenant.external_id,
        "store_id": store.external_id if store else None,
        "roles": list(roles),
        "iat": issued_at,
        "exp": expires_at,
    }
    return claims
