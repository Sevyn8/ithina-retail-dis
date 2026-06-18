"""Pytest plugin exposing DIS test fixtures to every service's test suite.

Registered as a pytest11 entry point (see ``pyproject.toml``), so any test suite
with ``dis-testing`` installed gets these fixtures without importing anything.

Fixtures that need the live stack (Postgres / running fakes) **skip** when the
relevant env var is unset or the resource is unreachable, so a bare ``uv run
pytest`` stays green; ``make run-local`` + ``make test`` exercises them for real.
"""

from __future__ import annotations

import os
import warnings
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


@pytest.fixture(scope="session", autouse=True)
def _dis_identity_synced() -> None:
    """Populate identity_mirror once per session via the REAL mirror-sync path.

    identity_mirror is owned by mirror-sync (Slice 7); the seeder no longer writes
    it. Many tests assume a mirrored tenant/store exists as an FK target (the
    mapping seed, the migration FK tests, the 3 NOBYPASSRLS user-role tests). This
    autouse SESSION fixture runs the sync once, before any module/function fixture
    (so it precedes every ``seed_default_fixtures`` call), uniformly across all test
    groups — so the user-role tests get their FK targets without holding admin
    access themselves. Idempotent (upsert): re-running adds nothing and leaves
    identity_mirror identical. Skip-safe: with no stack env it returns, so a bare
    ``pytest`` stays green. (Replaces a repo-root tests/integration/conftest.py,
    which collided with service conftests on the pytest module name.)
    """
    admin_url = os.environ.get("POSTGRES_ADMIN_URL")
    user_url = os.environ.get("POSTGRES_URL")
    if not (admin_url and user_url):
        # Both absent = no stack: stay silent so a bare `pytest` collection/run is green.
        # Partial env (POSTGRES_URL set, POSTGRES_ADMIN_URL missing) is the dangerous case:
        # the sync is skipped here, but stack-needing tests will still try to seed
        # config.source_mappings and fail with an obscure fk_csm_tenant error. Surface the
        # real reason loudly so the failure is self-explaining, not a confusing FK trace.
        if user_url and not admin_url:
            warnings.warn(
                "identity_mirror sync SKIPPED: POSTGRES_ADMIN_URL is not set but POSTGRES_URL is. "
                "Integration tests that need FK targets (the mapping seed, the user-role tests) "
                "will fail with a config.source_mappings fk_csm_tenant error. Set "
                "POSTGRES_ADMIN_URL (e.g. run via `make test`, which exports .env), or unset "
                "POSTGRES_URL to skip the stack tests cleanly.",
                stacklevel=2,
            )
        return
    from dis_testing.identity_sync import sync_identity_mirror

    sync_identity_mirror(admin_url, user_url)


# NOTE (D100): a suite-level post-suite clean-state assertion was prototyped here and REMOVED —
# it false-positived because resident workers (started by run_dis_on_local) consumed
# test-published Pub/Sub messages on shared subscriptions and wrote bronze/audit/quarantine rows
# under real trace_ids after the publishing test's teardown (rows no test owns).
#
# That PRECONDITION is now satisfied by the structural-isolation change: integration tests run on
# a SEPARATE emulator project (TEST_PUBSUB_PROJECT_ID / pubsub_test_project — see pytest_configure
# below and the _dis_pubsub_provisioned fixture), while residents stay on local-dis, so a resident
# subscription can no longer receive a test-published message by construction. The guard itself is
# DELIBERATELY still removed: re-enabling it is a distinct follow-up with its own baseline-definition
# risk (the idempotent seed + identity_mirror rows are legitimate residue, not contamination). The
# standing rule stands: a test that mutates the shared DB reverts its own writes (the cleanup idiom).


def pytest_configure() -> None:
    """Route the pytest process onto the test-scoped Pub/Sub project (D100 isolation).

    Runs before any test module is imported, so module-level project reads and every
    in-process service config (dis-ui-server's ``create_app``) resolve the test project
    from ``PUBSUB_PROJECT_ID``. Gated on ``PUBSUB_EMULATOR_HOST``: a bare run with no
    stack is untouched (unit tests set their own ``PUBSUB_PROJECT_ID``; integration tests
    skip via their stack-required fixtures). Residents are SEPARATE processes started with
    ``.env``'s local-dis, so this in-process override cannot reach them — the isolation is
    structural, not a convention.
    """
    if os.environ.get("PUBSUB_EMULATOR_HOST"):
        from dis_testing.pubsub import TEST_PUBSUB_PROJECT_ID

        # Record the stack project (residents + docker containers, e.g. the CM fake)
        # BEFORE redirecting in-process test code, so a test that interoperates with a
        # stack process can still target it (pubsub_stack_project). setdefault keeps it
        # stable across re-entry.
        os.environ.setdefault("DIS_STACK_PUBSUB_PROJECT_ID", os.environ.get("PUBSUB_PROJECT_ID", "local-dis"))
        os.environ["PUBSUB_PROJECT_ID"] = TEST_PUBSUB_PROJECT_ID


@pytest.fixture(scope="session", autouse=True)
def _dis_pubsub_provisioned() -> None:
    """Provision the test-scoped project's topics + standing subscriptions (D100).

    The same name set tools/local/create_topics.py provisions on local-dis, but on the
    test project, so the in-process subscribers' startup existence check finds their
    subscription. Idempotent (AlreadyExists-safe) and skip-safe: with no emulator env it
    returns, so a bare ``pytest`` stays green.
    """
    if not os.environ.get("PUBSUB_EMULATOR_HOST"):
        return
    from dis_core.pubsub_names import provision_pubsub
    from dis_testing.pubsub import TEST_PUBSUB_PROJECT_ID

    provision_pubsub(TEST_PUBSUB_PROJECT_ID)


@pytest.fixture(scope="session")
def seeded_identity(dis_engine: Engine, dis_postgres_url: str) -> Engine:
    """Sync identity_mirror (mirror-sync owns it) then seed the default mapping.

    identity_mirror is owned by mirror-sync; the seeder only writes
    config.source_mappings and requires the tenant FK target to already exist.
    Needs POSTGRES_ADMIN_URL to provision/sync the test-CM stand-in; skip if the
    full admin stack is absent (a bare run never reaches here anyway).
    """
    admin_url = os.environ.get("POSTGRES_ADMIN_URL")
    if not admin_url:
        pytest.skip("POSTGRES_ADMIN_URL not set — cannot sync identity_mirror before seeding")

    from dis_testing.identity_sync import sync_identity_mirror
    from dis_testing.seed import seed_default_fixtures

    sync_identity_mirror(admin_url, dis_postgres_url)
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
