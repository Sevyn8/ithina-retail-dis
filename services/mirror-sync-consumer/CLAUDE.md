# services/mirror-sync-consumer — Claude Code Context

Loaded when Claude Code works in `services/mirror-sync-consumer/`. Service-specific rules; root `CLAUDE.md` applies first.

## What this service is

Subscribes to `identity.changed` Pub/Sub; maintains `identity_mirror` schema in the data-platform Postgres so canonical tables can have real FKs.

For the EPE block (purpose, entry, process, exit), file structure, and operational detail, see `README.md` in this directory. For the current build slice, see the slice doc in `docs/slices/`.

**Status:** v1.0.

## Rules specific to this service

- Writes to: `identity_mirror.tenants`, `identity_mirror.stores`. Do not write to other tables or topics from here.
- Reads from: Pub/Sub `identity.changed`.
- All Postgres access uses `libs/dis-rls`. No raw SQLAlchemy sessions.
- All BigQuery access uses `libs/dis-core` BqClient.
- All audit emission uses `libs/dis-core` audit helpers.
- Soft-delete via `is_active=false`; never hard-delete (canonical rows may still reference).
- Older `source_ts` events don't overwrite newer rows.
- No outbound calls; reads from Pub/Sub, writes to Postgres only.

## References

- `README.md` (this directory) — EPE block, file structure, behavioural detail.
- Root `CLAUDE.md` — project-wide invariants.
- `docs/architecture.md` §4 — module rationale.
- `docs/decisions.md` — indexed decision register.

## When uncertain

Refer to the current slice doc in `docs/slices/`. If silent there, refer to architecture. If still uncertain, ask before coding.
