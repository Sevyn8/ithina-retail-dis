"""The DIS error hierarchy — single ``DisError`` root.

Every error raised by DIS code descends from :class:`DisError`. Root CLAUDE.md:
"Define error types in ``libs/dis-core/errors.py``. Don't reach for raw
``RuntimeError`` or ``ValueError``."

This module is **leaf-level** within ``dis-core``: it imports nothing first-party
(no ``dis_core.identity``, no other ``dis_core`` module). Submodules that need
these errors import *from* here, never the other way round, so the import graph
stays acyclic and ``dis-testing`` (which depends on ``dis-core``) can reparent its
test-only errors onto :class:`DisError` without inversion.

The Identity Service client errors live here (moved from
``dis_core.identity.client`` in Slice 3) and are re-exported by
``dis_core.identity`` for backward compatibility, so existing imports
(``from dis_core.identity import IdentityNotFoundError``) are unchanged.

Per-domain errors for the data-plane libs (RLS, PII, storage, mapping,
validation, audit) are added by their own slices as they gain a real raiser;
this module deliberately ships only the root plus the consolidated Slice 2
interim errors (build to current need).
"""

from __future__ import annotations


class DisError(Exception):
    """Root of every DIS error. Catch this to catch any DIS-domain failure."""


# -- Identity Service client errors --------------------------------------------
# Moved verbatim from dis_core.identity.client (Slice 3 consolidation). Signatures
# are preserved so the identity client and its tests are unaffected.


class IdentityClientError(DisError):
    """Base error for Identity Service client calls.

    Carries the contract's ``Error`` envelope fields when the server returned one,
    plus the HTTP status code for callers that branch on transport-level outcome.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.trace_id = trace_id


class IdentityNotFoundError(IdentityClientError):
    """The token / upload session / endpoint config did not map to a tenant+store.

    Maps to HTTP 404 / ``error_code == "identity_not_found"``. Hard failure: callers
    should not retry.
    """


class IdentityServiceUnavailableError(IdentityClientError):
    """Customer Master unhealthy and stale window exceeded (HTTP 503 / circuit_open).

    Resolve callers retry with backoff; validate callers fall back to identity_mirror.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
        trace_id: str | None = None,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(
            message,
            status_code=status_code,
            error_code=error_code,
            trace_id=trace_id,
        )
        self.retry_after = retry_after
