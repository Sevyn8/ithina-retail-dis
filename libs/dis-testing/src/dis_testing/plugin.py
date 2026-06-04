"""Pytest plugin exposing DIS test fixtures to every service's test suite.

Registered as a pytest11 entry point (see ``pyproject.toml``), so any test suite
with ``dis-testing`` installed gets these fixtures without importing anything.

Fixtures that need the live stack (Postgres / running fakes) **skip** when the
relevant env var is unset or the resource is unreachable, so a bare ``uv run
pytest`` stays green; ``make run-local`` + ``make test`` exercises them for real.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Iterator
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from sqlalchemy import Engine

    from dis_core.identity import HttpIdentityClient


# ---------------------------------------------------------------------------
# Postgres / seeder
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def dis_postgres_url() -> str:
    url = os.environ.get("POSTGRES_URL")
    if not url:
        pytest.skip("POSTGRES_URL not set — local stack not configured")
    return url


@pytest.fixture(scope="session")
def dis_engine(dis_postgres_url: str) -> Iterator[Engine]:
    from sqlalchemy import create_engine, text

    engine = create_engine(dis_postgres_url)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 — any connect failure means "stack down → skip"
        engine.dispose()
        pytest.skip(f"DIS Postgres unreachable ({exc!r})")
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def seeded_identity(dis_engine: Engine) -> Engine:
    """Ensure the default fixture set is present in the DIS database (idempotent)."""
    from dis_testing.seed import seed_default_fixtures

    seed_default_fixtures(engine=dis_engine)
    return dis_engine


# ---------------------------------------------------------------------------
# Running fakes (HTTP)
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def identity_service_url() -> str:
    url = os.environ.get("IDENTITY_SERVICE_URL")
    if not url:
        pytest.skip("IDENTITY_SERVICE_URL not set — identity-service fake not configured")
    return url


@pytest.fixture(scope="session")
def customer_master_url() -> str:
    url = os.environ.get("CUSTOMER_MASTER_URL")
    if not url:
        pytest.skip("CUSTOMER_MASTER_URL not set — customer-master fake not configured")
    return url


@pytest.fixture
async def identity_client(identity_service_url: str) -> AsyncIterator[HttpIdentityClient]:
    """An ``HttpIdentityClient`` pointed at the running Identity Service fake.

    This is the same client real consumers use; the Slice 13 service is a drop-in
    behind the same ``IDENTITY_SERVICE_URL`` (acceptance criterion 8).
    """

    from dis_core.identity import HttpIdentityClient

    _ensure_reachable(f"{identity_service_url}/healthz")
    client = HttpIdentityClient(identity_service_url)
    try:
        yield client
    finally:
        await client.aclose()


@pytest.fixture
def cm_jwt(customer_master_url: str) -> str:
    """A signed JWT obtained from the running Customer Master fake."""
    import httpx

    _ensure_reachable(f"{customer_master_url}/healthz")
    resp = httpx.post(f"{customer_master_url}/v1/tokens", json={}, timeout=5.0)
    resp.raise_for_status()
    token: str = resp.json()["jwt"]  # JSON boundary -> declared str
    return token


def _ensure_reachable(health_url: str) -> None:
    import httpx

    try:
        httpx.get(health_url, timeout=2.0).raise_for_status()
    except Exception as exc:  # noqa: BLE001 — fake not up → skip the test
        pytest.skip(f"fake not reachable at {health_url} ({exc!r})")
