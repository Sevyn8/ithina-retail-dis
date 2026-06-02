# services/dis-ui-server — Claude Code Context

Loaded when Claude Code works in `services/dis-ui-server/`. Service-specific rules; root `CLAUDE.md` applies first.

## What this service is

The BFF (backend-for-frontend) for the DIS UI. Single backend service hosting all sub-modules (sample upload, onboarding review, mapping CRUD, quarantine console, audit lookup). Includes the onboarding sub-module in-process.

For the EPE block (purpose, entry, process, exit), file structure, and operational detail, see `README.md` in this directory. For the current build slice, see the slice doc in `docs/slices/`.

**Status:** v1.0.

## Rules specific to this service

- Writes to: `config.source_mappings` (mapping authoring), Pub/Sub `mapping.changed` (notify streaming consumer on cache refresh). Do not write to other tables or topics from here.
- Reads from: Cloud SQL read replica (canonical, quarantine, audit), BigQuery `audit_events` via BqClient, `identity_mirror`.
- All Postgres access uses `libs/dis-rls`. No raw SQLAlchemy sessions.
- All BigQuery access uses `libs/dis-core` BqClient.
- All audit emission uses `libs/dis-core` audit helpers.
- Reads from replicas only; writes only to `config.source_mappings` (and Pub/Sub).
- Authenticates via Customer Master JWT; extracts tenant_id and role claims.
- BigQuery queries via `libs/dis-core` BqClient (tenant scoping enforced).
- Onboarding sub-module is in-process; not a separate service. See architecture §4.16, §4.17.

## References

- `README.md` (this directory) — EPE block, file structure, behavioural detail.
- Root `CLAUDE.md` — project-wide invariants.
- `docs/architecture.md` §4 — module rationale.
- `docs/decisions.md` — indexed decision register.

## When uncertain

Refer to the current slice doc in `docs/slices/`. If silent there, refer to architecture. If still uncertain, ask before coding.
