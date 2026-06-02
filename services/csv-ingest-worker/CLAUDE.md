# services/csv-ingest-worker — Claude Code Context

Loaded when Claude Code works in `services/csv-ingest-worker/`. Service-specific rules; root `CLAUDE.md` applies first.

## What this service is

The GCS-event-triggered worker for CSV upload (Phase 2). Subscribed to GCS object-finalized notifications on the bronze bucket; runs DuckDB preflight, PII tokenization, bronze metadata write, `ingress.ready` publish, and audit emission.

Phase 1 (signed-URL issuance) lives in `services/dis-ui-server/` as the `upload_session` handler, not here. See `decisions.md` D36 for the split.

For the EPE block (purpose, entry, process, exit), file structure, and operational detail, see `README.md` in this directory. For the current build slice, see the slice doc in `docs/slices/`.

**Status:** v1.0.

## Rules specific to this service

- Writes to: `bronze.data_ingress_events`, Pub/Sub `ingress.ready`. Do not write to other tables or topics from here.
- Reads from: `identity_mirror` (via identity-service), `config.source_mappings`, GCS bronze bucket.
- All Postgres access uses `libs/dis-rls`. No raw SQLAlchemy sessions.
- All BigQuery access uses `libs/dis-core` BqClient (stub in Phase 1; real in Phase 3).
- All audit emission uses `libs/dis-audit` (writes to Cloud SQL `audit.events` in Phase 1).
- This service does NOT generate `trace_id`. It reads the trace_id from the upload session (looked up via Identity Service `resolve_from_upload`) or from the GCS object path. trace_id origination is dis-ui-server's responsibility (Phase 1).
- PII tokenization happens here before any persistence. Use `libs/dis-pii`.
- All GCS access uses `libs/dis-storage`.
- Idempotency: same SHA-256 + source_payload_id + tenant within 24h returns prior `trace_id` (no re-process).

## References

- `README.md` (this directory) — EPE block, file structure, behavioural detail.
- Root `CLAUDE.md` — project-wide invariants.
- `docs/architecture.md` §4.1 — receiver module rationale; §4.4 bronze.
- `docs/decisions.md` D36 — Phase 1 / Phase 2 split rationale.

## When uncertain

Refer to the current slice doc in `docs/slices/`. If silent there, refer to architecture. If still uncertain, ask before coding.
