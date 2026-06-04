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


# -- Audit error (Slice 6) -----------------------------------------------------
# Raised by dis-audit. Audit emission is fire-and-forget (hard rule 11): the writer
# logs this with context and reports failure rather than propagating it, so the data
# path is never blocked. Carries the load-bearing identifiers (code-quality rule 5);
# never a raw PII value or payload.


class AuditWriteError(DisError):
    """An ``audit.events`` write could not be performed.

    Raised by ``dis-audit`` backend selection (``select_writer``) when a required value is
    missing — e.g. the Postgres backend without an engine (no silent fallback, code-quality
    rule 4). Note the *fire-and-forget* write path does NOT raise: a write failure or a
    tenant-less event (the D43 contract violation) is logged and reported as ``False`` so the
    data path is never blocked (hard rule 11). Carries ``tenant_id`` / ``trace_id`` / ``stage``
    / ``failure_code`` for diagnosis.
    """

    def __init__(
        self,
        message: str,
        *,
        tenant_id: str | None = None,
        trace_id: str | None = None,
        stage: str | None = None,
        failure_code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.tenant_id = tenant_id
        self.trace_id = trace_id
        self.stage = stage
        self.failure_code = failure_code


# -- Pipeline-mechanics errors (Slice 5) ----------------------------------------
# Raised by dis-mapping and dis-validation. Both libs are pure (no I/O); these are
# *config / contract* errors raised loudly at construction or materialization time
# (code-quality rule 4) — they are NOT the per-cell / per-row data failures, which
# are returned as typed result objects, never raised (slice-05, D18/D20). Each
# carries the load-bearing identifiers (code-quality rule 5); NEVER a cell value.


class MappingError(DisError):
    """Base for dis-mapping failures.

    Carries optional ``tenant_id`` / ``trace_id`` (when the caller supplied a log
    context) and the load-bearing ``column`` where one applies. Never a cell value
    (root CLAUDE.md: never log PII or raw payloads).
    """

    def __init__(
        self,
        message: str,
        *,
        column: str | None = None,
        tenant_id: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.column = column
        self.tenant_id = tenant_id
        self.trace_id = trace_id


class MappingConfigError(MappingError):
    """The mapping config (``mapping_rules``) is invalid — fail loud at construction.

    Raised by ``SourceMapping`` validation: unknown op, missing/invalid op args
    (including the mandatory ``parse_decimal``/``parse_integer`` separator
    declarations — locale is asserted, never inferred), colliding rename targets,
    normalize/cast keys that no rename produces, derive targets that collide with
    renames, or a transform list whose composition is type-invalid. Never deferred
    to runtime (code-quality rule 4).
    """


class MappingInputError(MappingError):
    """The chunk handed to the engine violates the caller contract.

    Raised when a column the mapping's rename declares is absent from the input
    frame, or a column with declared normalize rules is not string-typed. This is
    a caller-contract violation (the source-shape suite gates chunk shape before
    mapping in the pipeline, D18), not a per-cell data failure — so it raises
    rather than returning failures.
    """


class ValidationSuiteError(DisError):
    """Base for dis-validation failures (suite definition / materialization layer).

    NOT the per-row validation outcomes — those are returned as typed result
    objects (``SourceShapeFailure`` / ``CanonicalShapeFailure``), never raised.
    """

    def __init__(
        self,
        message: str,
        *,
        model: str | None = None,
        column: str | None = None,
        tenant_id: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.model = model
        self.column = column
        self.tenant_id = tenant_id
        self.trace_id = trace_id


class SuiteDefinitionError(ValidationSuiteError):
    """A suite definition is invalid or cannot be materialized into a Pandera schema.

    E.g. an owned column the target model does not carry, an unsupported dtype in
    the model-to-Pandera deriver, or a malformed expectation. Fail loud at
    materialization, never at validation runtime.
    """


class SuiteDriftError(ValidationSuiteError):
    """The canonical-shape suite and the canonical model have drifted apart.

    Raised by the drift guard (``dis_validation.provenance``) when the provenance
    classification does not partition the model's field set exactly (both
    directions), when a suite's column set differs from its declared source-owned
    set, or when a mapping-time suite is requested for a model that is not
    mapping-produced (``store_sku_signal_history``, D22/D31/D32). This error is the
    *proof mechanism* of slice-05 criterion 6: it errors rather than skips.
    """


# -- Mirror Sync errors (Slice 7) ----------------------------------------------
# Raised by the mirror-sync-consumer service (DB-pull mode), which reads Customer
# Master's Postgres under a platform read context and upserts into identity_mirror.
# Each carries trace_id and the load-bearing identifier (code-quality rule 5); never
# a raw payload. The DIS-side write reuses dis-rls' RlsContextError (wrong DB / role).


class MirrorSyncError(DisError):
    """Base for mirror-sync-consumer (DB-pull) failures.

    Carries the per-run ``trace_id`` and, where a per-tenant context applies, the
    ``tenant_id``, so a failed sync is diagnosable (code-quality rule 5).
    """

    def __init__(
        self,
        message: str,
        *,
        trace_id: str | None = None,
        tenant_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.trace_id = trace_id
        self.tenant_id = tenant_id


class CustomerMasterReadError(MirrorSyncError):
    """The Customer Master read could not be performed safely.

    Raised when the CM connection reached the wrong target (not the expected
    Customer Master database, or — worse — the DIS database), or the platform read
    context did not take effect in the read transaction (``app.user_type`` is not
    ``'PLATFORM'``). Under CM's FORCE RLS a mis-set context silently returns zero
    rows (``docs/ithina_master_db_read_access.md`` §2), so this is raised **before**
    any mirror write rather than letting an empty read masquerade as an empty source.
    Carries what was observed on the server (``database`` / ``role`` / ``user_type``).
    """

    def __init__(
        self,
        message: str,
        *,
        database: str | None = None,
        role: str | None = None,
        user_type: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message, trace_id=trace_id)
        self.database = database
        self.role = role
        self.user_type = user_type


# -- CSV ingest worker errors (Slice 9b) -----------------------------------------
# Raised by services/csv-ingest-worker (the Phase-2 CSV worker, D36/D54). Each carries
# tenant_id / trace_id where known and the load-bearing detail (code-quality rule 5);
# never a payload, a cell value, or a PII value. The worker reads identity and
# trace_id off the csv.received event (D54) — none of these errors is ever raised
# with a worker-minted trace_id.


class CsvIngestError(DisError):
    """Base for csv-ingest-worker failures.

    Carries the event's ``tenant_id`` / ``trace_id`` (both read from the
    ``csv.received`` envelope, never minted by the worker, hard rule 4) so every
    ingest failure is diagnosable end-to-end.
    """

    def __init__(
        self,
        message: str,
        *,
        tenant_id: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.tenant_id = tenant_id
        self.trace_id = trace_id


class EventContractError(CsvIngestError):
    """An inbound event envelope violates its frozen contract (hard rule 10).

    Raised when a required field is missing, empty, or malformed (e.g. a non-UUID
    identity field, a bad ``upload_session_id``). Required values never fall back
    silently (code-quality rule 4) — this includes the idempotency-key components.
    ``field`` names the violating contract field. Terminal: a redelivery of the same
    malformed envelope fails identically, so the consumer acks after raising.
    """

    def __init__(
        self,
        message: str,
        *,
        field: str | None = None,
        tenant_id: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message, tenant_id=tenant_id, trace_id=trace_id)
        self.field = field


class EventPathMismatchError(CsvIngestError):
    """The event's identity and its GCS path's parsed components disagree.

    The event is the trust boundary (D54) — the worker never re-resolves identity —
    but the canonical object path embeds tenant/source/trace (D53), so a mismatch
    means a malformed producer, not a resolution question. Raised loudly before any
    read of the object. Carries which ``field`` diverged and both observed values
    (identifiers only, never payload).
    """

    def __init__(
        self,
        message: str,
        *,
        field: str | None = None,
        event_value: str | None = None,
        path_value: str | None = None,
        tenant_id: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message, tenant_id=tenant_id, trace_id=trace_id)
        self.field = field
        self.event_value = event_value
        self.path_value = path_value


class PreflightFailedError(CsvIngestError):
    """The DuckDB structural preflight rejected the object (D13/D16).

    Structural only: does-not-parse-as-CSV, no header, implausible structure.
    Column- and mapping-aware failures are the source-shape suite's (Slice 10) and
    are never raised here. ``reason`` is a short machine-stable code; ``detail`` is
    human context (column counts, row counts — never cell values or payload).
    """

    def __init__(
        self,
        message: str,
        *,
        reason: str | None = None,
        detail: str | None = None,
        tenant_id: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message, tenant_id=tenant_id, trace_id=trace_id)
        self.reason = reason
        self.detail = detail
