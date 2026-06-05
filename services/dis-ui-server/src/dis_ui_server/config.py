"""Environment-resolved configuration for the UI server.

Required env (no silent default for a required value, code-quality rule 4 — a
missing one raises ``DisError``; this service deliberately defines no new
config-error class because the Slice-13a dis-core edit is pinned to exactly the
three auth-seam errors; the streaming-consumer precedent applies):

- ``POSTGRES_URL`` — the DIS connection (``ithina_dis_user``). Reused by
  ``dis-rls`` ``create_rls_engine``, which positively asserts
  ``current_database()=='ithina_dis_db'`` and a NOSUPERUSER/NOBYPASSRLS role
  (DIS on 5433, never Customer Master).

Resolution happens inside the app lifespan, NOT at import time: a missing
required value aborts startup loudly (crashloop is the correct signal for
misconfiguration), while a present-but-unreachable database must NOT block
startup — the engine is lazy and the first connect happens in ``/readyz``,
which degrades to 503. That split is the liveness/readiness foundation this
slice is built on and is test-pinned.

The dev-stub verifier parameters are NOT config: they are contract-pinned
constants in ``auth/verifier.py`` (byte-identical to the UI's ``/dev/login``
stub so dev tokens round-trip; env-overridable values would invite drift).
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from dis_core.errors import DisError

_POSTGRES_URL = "POSTGRES_URL"
_CORS_ALLOWED_ORIGINS = "CORS_ALLOWED_ORIGINS"

SERVICE_NAME = "dis-ui-server"

# The browser-served dis-ui SPA's dev origin (Slice 14c, confirmed live: dis-ui
# runs Vite with NO server.port override and its README pins
# "pnpm dev - dev server on http://localhost:5173"). NEVER a wildcard: a
# permissive dev posture must not be expressible by default; deployed origins
# are set per environment via CORS_ALLOWED_ORIGINS.
_DEFAULT_CORS_ORIGINS: tuple[str, ...] = ("http://localhost:5173",)

# Every UI data endpoint mounts under this prefix (durable invariant, recorded
# in this service's CLAUDE.md); health probes stay at the root. The contract's
# relative /v1/<group>/<resource> paths are unchanged — only the deployed base
# shifts, and dis-ui's client.ts fetch base must agree when real mode wires up
# (13b/19, contract Appendix B).
API_PREFIX = "/api/v1"


@dataclass(frozen=True)
class UiServerConfig:
    """Resolved environment profile for one server process."""

    postgres_url: str

    @classmethod
    def from_env(cls) -> UiServerConfig:
        """Resolve from the environment, raising on any missing required value."""
        postgres_url = os.environ.get(_POSTGRES_URL)
        if not postgres_url:
            raise DisError(
                f"{_POSTGRES_URL} is not set; cannot reach the DIS database for the "
                "tenant-scoped readiness probe or any later data endpoint"
            )
        return cls(postgres_url=postgres_url)


def cors_allowed_origins_from_env() -> tuple[str, ...]:
    """The CORS origin allow-list, comma-separated from ``CORS_ALLOWED_ORIGINS``.

    Resolved at APP-BUILD time in ``create_app`` — not in the lifespan like
    ``UiServerConfig.from_env`` — because Starlette middleware must be
    registered before startup, while the lifespan-resolves-config posture is
    test-pinned for the crashloop-on-missing-POSTGRES_URL split. Same mechanism
    (env read in this module), different resolution point; safe at import
    because the value has a sanctioned default (the slice contract mandates the
    confirmed dis-ui dev origin) and so can never abort an import.

    Unset → the dev default. Set-but-empty is an ambiguous declaration and
    raises (code-quality rule 4): unset it for the default, or list explicit
    origins.
    """
    raw = os.environ.get(_CORS_ALLOWED_ORIGINS)
    if raw is None:
        return _DEFAULT_CORS_ORIGINS
    origins = tuple(origin.strip() for origin in raw.split(",") if origin.strip())
    if not origins:
        raise DisError(
            f"{_CORS_ALLOWED_ORIGINS} is set but contains no origins; unset it for "
            "the dev default or list explicit comma-separated origins"
        )
    return origins
