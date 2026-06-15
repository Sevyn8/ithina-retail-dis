"""The foundation rule, made executable (slice Task 7, acceptance criterion 3):

``tenant_id`` is sourced ONLY from the verified token. A request may shout a
tenant from every other channel — query string, JSON body, unverified header —
and none of it reaches the identity: a tenant-less token still gets 403, and a
tenant-A token still resolves tenant A. The probe route deliberately declares
no body/query/header parameters, mirroring how real handlers consume the seam.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi.testclient import TestClient

TENANT_A = "019e89f9-dbd5-7703-8221-ae6b811599bb"
TENANT_B = "019e89f9-dbd5-7703-8221-ae707db9b918"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_tenantless_token_is_403_despite_tenant_in_every_other_channel(
    client: TestClient, mint_token: Callable[..., str]
) -> None:
    token = mint_token(tenant_id=None, roles=("dis:read",), user_type="PLATFORM")
    response = client.post(
        f"/api/v1/probe/tenant-echo?tenant_id={TENANT_B}",
        headers={**_bearer(token), "X-Tenant-Id": TENANT_B},
        json={"tenant_id": TENANT_B},
    )
    # None of query / header / body is honored: no verified tenant, no scope.
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant_scope"


def test_token_tenant_wins_over_query_header_and_body(
    client: TestClient, mint_token: Callable[..., str]
) -> None:
    token = mint_token(tenant_id=TENANT_A, roles=("dis:read",))
    response = client.post(
        f"/api/v1/probe/tenant-echo?tenant_id={TENANT_B}",
        headers={**_bearer(token), "X-Tenant-Id": TENANT_B},
        json={"tenant_id": TENANT_B},
    )
    assert response.status_code == 200
    # The resolved scope is the TOKEN's tenant; the shouted tenant B appears nowhere.
    assert response.json() == {"tenant_id": TENANT_A}
