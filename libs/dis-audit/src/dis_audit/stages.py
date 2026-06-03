"""The audit vocabulary ``dis-audit`` owns and its service consumers import.

Three closed string enums. Slices 8-18 import these rather than re-declaring stage /
scope / outcome strings, so the vocabulary stays consistent across services (Slice 5
and Slice 10 import :class:`Stage` / :class:`Outcome` from here).

Why closed enums and not free strings: ``audit.events`` constrains ``event_scope`` and
``outcome`` with CHECK constraints, but ``stage`` has **no** CHECK (it is a free
``varchar(64)`` in the live schema). Closure of :class:`Stage` is therefore a
``dis-audit`` type-level guarantee — the lib is the vocabulary's owner — not a DB
constraint. :class:`EventScope` and :class:`Outcome` mirror the live CHECK vocab
exactly (introspected from ``ck_audit_events_event_scope_vocab`` /
``ck_audit_events_outcome_vocab``); the integration drift guard asserts that match.

Note on duplicate outcomes (``decisions.md`` D42): D33 / architecture §2.3.3 speak of
``DUPLICATE_NOOP`` / ``DUPLICATE_OVERWRITTEN`` outcomes and a ``prior_trace_id``. The
live ``outcome`` CHECK permits only the four values below and there is no
``prior_trace_id`` column, so those are **not** outcome members here; the duplicate
detail lives in the ``event_data`` JSONB and is wired by Slice 10. See D42.
"""

from __future__ import annotations

from enum import StrEnum


class EventScope(StrEnum):
    """Audit-event scope distinguisher. Mirrors ``ck_audit_events_event_scope_vocab``.

    INGRESS_EVENT — per-stage summary for one chunk. ROW — a per-row record (typically
    a failure). Volume scales with failure rate, not row count (architecture glossary).
    """

    INGRESS_EVENT = "INGRESS_EVENT"
    ROW = "ROW"


class Outcome(StrEnum):
    """A stage's result for one scope. Mirrors ``ck_audit_events_outcome_vocab`` exactly."""

    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"
    SKIPPED = "SKIPPED"
    RETRIED = "RETRIED"


class Stage(StrEnum):
    """The pipeline stage an audit event records. Closed, owned vocabulary.

    Membership is the full **Phase-1** pipeline stage set, so importers across slices
    bind to a stable enum instead of extending it per slice. The cutoff is the phase
    boundary, not the slice boundary: Phase-3-only stages (``BQ_EXPORTED``,
    ``PARTITION_DROPPED`` — nightly-batch, Slice 21) are deliberately excluded as dead
    Phase-3 surface, mirroring the seam discipline.

    Sources: ``schemas/postgres/audit/events.sql`` header and the BigQuery
    ``audit_events`` ``stage`` description.
    """

    # Receiver / ingress stages (csv-ingest-worker; deferred receiver services).
    RECEIVED = "RECEIVED"
    PII_TOKENIZED = "PII_TOKENIZED"
    BRONZE_WRITTEN = "BRONZE_WRITTEN"
    INGRESS_PUBLISHED = "INGRESS_PUBLISHED"
    # Streaming-consumer stages.
    MAPPING_LOOKED_UP = "MAPPING_LOOKED_UP"
    IDENTITY_VALIDATED = "IDENTITY_VALIDATED"
    PRE_MAPPING_VALIDATED = "PRE_MAPPING_VALIDATED"
    MAPPING_EXECUTED = "MAPPING_EXECUTED"
    POST_MAPPING_VALIDATED = "POST_MAPPING_VALIDATED"
    CANONICAL_WRITTEN = "CANONICAL_WRITTEN"
    QUARANTINED = "QUARANTINED"
    # Daily-compute (Slice 18).
    SIGNAL_COMPUTED = "SIGNAL_COMPUTED"
