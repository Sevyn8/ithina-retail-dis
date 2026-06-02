# services/dis-ui-server — Claude Code Context

Loaded when Claude Code works in `services/dis-ui-server/`. Service-specific rules; root `CLAUDE.md` applies first.

## What this service is

The BFF (backend-for-frontend) for the DIS UI. Single backend service hosting all UI-facing sub-modules: sample upload, onboarding review, mapping CRUD, quarantine console, audit lookup, DuckDB query panel, and the upload-session endpoint that starts a CSV upload (Phase 1 per `decisions.md` D36). Hosts the onboarding sub-module in-process.

For the EPE block (purpose, entry, process, exit), file structure, and operational detail, see `README.md` in this directory. For the current build slice, see the slice doc in `docs/slices/`.

**Status:** v1.0.

## Rules specific to this service

- Writes to: `config.source_mappings` (mapping authoring); Pub/Sub `mapping.changed` (notify streaming consumer on active mapping change); Pub/Sub `ingress.resubmit` (resubmit from quarantine console). Do not write to other tables or topics from here.
- Reads from: Cloud SQL read replica (canonical), Cloud SQL `audit.events` (Phase 1; BigQuery `audit_events` from Phase 3 onward per D34), `config.source_mappings`, `quarantine.*`, `identity_mirror` (via identity-service).
- All Postgres access uses `libs/dis-rls`. No raw SQLAlchemy sessions.
- Audit reads from Cloud SQL `audit.events` in Phase 1 via standard repos. BigQuery via `libs/dis-core` BqClient lands in Phase 3 (BqClient is a stub in Phase 1).
- All audit emission uses `libs/dis-audit`.
- Never writes to canonical tables or audit. Never publishes to `ingress.ready` or `quarantine` (those are receiver/worker concerns).
- Authenticates via Customer Master JWT; extracts tenant_id and role claims; FastAPI dependency injection scopes every request.
- Hosts the `upload_session` handler that issues signed PUT URLs for CSV upload (Phase 1; see D36). Generates the `trace_id` here; the `csv-ingest-worker` service reads it from the GCS object path in Phase 2.
- Onboarding sub-module is in-process; not a separate service. See architecture §4.16, §4.17.
- DuckDB query panel is ops-role-restricted. RBAC enforced at the handler level.

## References

- `README.md` (this directory) — EPE block, file structure, behavioural detail.
- Root `CLAUDE.md` — project-wide invariants.
- `docs/architecture.md` §4.17 — dis-ui-server module rationale; §4.16 onboarding sub-module.
- `docs/decisions.md` D17 — single BFF; D26 — BFF rationale; D34 — Phase 1 audit destination; D36 — Phase 1 upload-session endpoint lives here.

## When uncertain

Refer to the current slice doc in `docs/slices/`. If silent there, refer to architecture. If still uncertain, ask before coding.
