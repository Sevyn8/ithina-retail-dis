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
this module ships the root, the consolidated Slice 2 interim identity errors, and
(Slice 4) the data-plane errors for ``dis-rls``, ``dis-pii``, and ``dis-storage``
(build to current need).
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


# -- Data-plane safety errors (Slice 4) ----------------------------------------
# Raised by dis-rls / dis-pii / dis-storage. Each carries the load-bearing context
# (root CLAUDE.md code-quality rule 5: errors carry tenant_id, trace_id, and the
# load-bearing identifier). NONE of these ever carry a raw PII value (hard rule 2).


class RlsContextError(DisError):
    """The RLS session could not be opened safely.

    Raised by ``dis-rls`` when the connection reached the wrong target (e.g. not
    ``ithina_dis_db``) or the connected role can bypass RLS (SUPERUSER or BYPASSRLS),
    either of which would make tenant isolation silently void. Carries what was
    actually observed on the server so the failure is diagnosable.
    """

    def __init__(
        self,
        message: str,
        *,
        database: str | None = None,
        role: str | None = None,
        tenant_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.database = database
        self.role = role
        self.tenant_id = tenant_id


class PiiBackendNotConfiguredError(DisError):
    """A source mapping flags PII column(s) but no backend is configured to handle them.

    The ``dis-pii`` fail-loud gate raises this *before* any persistence path so PII
    cannot land silently (hard rule 2). ``columns`` are the flagged column *names*
    only — never the values. In v1.0 no real backend exists, so the gate raises on
    every detected PII column.
    """

    def __init__(
        self,
        message: str,
        *,
        columns: tuple[str, ...] = (),
        tenant_id: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.columns = columns
        self.tenant_id = tenant_id
        self.trace_id = trace_id


class StorageError(DisError):
    """A ``dis-storage`` operation failed (path construction, signing, or object access).

    Carries the object path and tenant/trace context when known; never a payload.
    """

    def __init__(
        self,
        message: str,
        *,
        object_path: str | None = None,
        tenant_id: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.object_path = object_path
        self.tenant_id = tenant_id
        self.trace_id = trace_id
