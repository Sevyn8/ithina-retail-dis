# services/receiver-csv-upload — Claude Code Context

Loaded when Claude Code works in `services/receiver-csv-upload/`. Service-specific rules; root `CLAUDE.md` applies first.

## What this service is

Manual CSV upload receiver. Accepts uploads from tenant operators via the DIS UI.

For the EPE block (purpose, entry, process, exit), file structure, and operational detail, see `README.md` in this directory. For the current build slice, see the slice doc in `docs/slices/`.

**Status:** v1.0.

## Rules specific to this service

- Writes to: `bronze.data_ingress_events`, GCS, Pub/Sub `ingress.ready`. Do not write to other tables or topics from here.
- Reads from: `identity_mirror` (via identity-service), `config.source_mappings`.
- All Postgres access uses `libs/dis-rls`. No raw SQLAlchemy sessions.
- All BigQuery access uses `libs/dis-core` BqClient.
- All audit emission uses `libs/dis-core` audit helpers.
- This service generates the request's `trace_id` at request entry.
- PII tokenization happens here before any persistence. Use `libs/dis-pii`.
- All GCS access uses `libs/dis-storage`.
- Two-phase upload pattern: signed PUT URL in phase 1; preflight + bronze write in phase 2.
- Idempotency: same SHA-256 + source_payload_id + tenant within 24h returns prior `trace_id`.

## References

- `README.md` (this directory) — EPE block, file structure, behavioural detail.
- Root `CLAUDE.md` — project-wide invariants.
- `docs/architecture.md` §4 — module rationale.
- `docs/decisions.md` — indexed decision register.

## When uncertain

Refer to the current slice doc in `docs/slices/`. If silent there, refer to architecture. If still uncertain, ask before coding.
