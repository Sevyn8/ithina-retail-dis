"""Environment-resolved configuration for the UI server.

Required env (no silent default for a required value, code-quality rule 4 — a
missing one raises ``DisError``; this service deliberately defines no new
config-error class because the Slice-13a dis-core edit is pinned to exactly the
three auth-seam errors; the streaming-consumer precedent applies):

- ``POSTGRES_URL`` — the DIS connection (``ithina_dis_user``). Reused by
  ``dis-rls`` ``create_rls_engine``, which positively asserts
  ``current_database()=='ithina_dis_db'`` and a NOSUPERUSER/NOBYPASSRLS role
  (DIS on 5433, never Customer Master).
- ``GCS_BUCKET_BRONZE`` — the bronze bucket the CSV upload writes to (Slice 8;
  the same env name the csv-ingest-worker cross-checks the published
  ``gcs_uri`` against, so producer and consumer cannot drift).
- ``PUBSUB_PROJECT_ID`` — the Pub/Sub project for the ``csv.received`` publish.

OPTIONAL env (NOT in the required-or-crashloop set):

- ``GEMINI_API_KEY``: the Gemini Developer API key for the mapping-suggestion
  endpoint, sourced in deployment from the ``dis-gemini-api-key`` secret. UNSET
  is a normal state: the suggester falls back to the mechanical matcher, so a
  missing key must NEVER abort startup (it is read with no raise).

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
_GCS_BUCKET_BRONZE = "GCS_BUCKET_BRONZE"
_PUBSUB_PROJECT_ID = "PUBSUB_PROJECT_ID"
_GEMINI_API_KEY = "GEMINI_API_KEY"  # OPTIONAL: unset -> mechanical fallback, never crashloop

SERVICE_NAME = "dis-ui-server"

# Frozen contract name (hard rule 10): the CSV-upload Phase 1 publish target.
# The topic is provisioned by tools/local/create_topics.py, never by runtime code.
CSV_RECEIVED_TOPIC = "csv.received"

# The Slice 8 upload ceiling (a decision value, not deployment config): the
# synchronous-streaming-upload register entry's rationale is that 10 MB removes
# the large-file case for direct-to-GCS. Enforced MID-STREAM in upload_stream.py
# (the spoofable Content-Length early-reject is only the cheap first check).
CSV_UPLOAD_MAX_FILE_BYTES = 10 * 1024 * 1024

# The raw-body ceiling = the file limit + an allowance for multipart framing
# (boundaries, part headers, the small template_id/store_code fields). Anything
# past this is rejected mid-stream regardless of how the parts are arranged.
CSV_UPLOAD_BODY_CEILING_BYTES = CSV_UPLOAD_MAX_FILE_BYTES + 64 * 1024

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
    gcs_bucket_bronze: str
    pubsub_project_id: str
    gemini_api_key: str | None = None  # OPTIONAL (see module docstring); never required

    @classmethod
    def from_env(cls) -> UiServerConfig:
        """Resolve from the environment, raising on any missing required value."""
        postgres_url = os.environ.get(_POSTGRES_URL)
        if not postgres_url:
            raise DisError(
                f"{_POSTGRES_URL} is not set; cannot reach the DIS database for the "
                "tenant-scoped readiness probe or any later data endpoint"
            )
        gcs_bucket_bronze = os.environ.get(_GCS_BUCKET_BRONZE)
        if not gcs_bucket_bronze:
            raise DisError(
                f"{_GCS_BUCKET_BRONZE} is not set; the CSV upload cannot build or "
                "write the canonical bronze object path"
            )
        pubsub_project_id = os.environ.get(_PUBSUB_PROJECT_ID)
        if not pubsub_project_id:
            raise DisError(
                f"{_PUBSUB_PROJECT_ID} is not set; the CSV upload cannot publish {CSV_RECEIVED_TOPIC!r}"
            )
        # OPTIONAL: read with no raise. Unset -> None -> the suggester uses the
        # mechanical fallback; a missing key must never abort startup (FM1).
        gemini_api_key = os.environ.get(_GEMINI_API_KEY) or None
        return cls(
            postgres_url=postgres_url,
            gcs_bucket_bronze=gcs_bucket_bronze,
            pubsub_project_id=pubsub_project_id,
            gemini_api_key=gemini_api_key,
        )


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
