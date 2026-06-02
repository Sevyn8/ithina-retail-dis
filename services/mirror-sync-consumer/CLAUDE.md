# services/mirror-sync-consumer — Claude Code Context

Loaded when Claude Code works in `services/mirror-sync-consumer/`. Service-specific rules; root `CLAUDE.md` applies first.

## What this service is

Maintains the `identity_mirror` schema in the data-platform Postgres so canonical tables can have real FKs. Two modes: DB-pull from Customer Master DB (v1.0 launch path) and Pub/Sub consumer on `identity.changed` (deferred until Customer Master emits).

For the EPE blocks (one per mode), file structure, and operational detail, see `README.md` in this directory. For the current build slice, see the slice doc in `docs/slices/`.

**Status:** v1.0 — DB-pull mode is the active path; Pub/Sub consumer mode is deferred.

## Rules specific to this service

- Writes to: `identity_mirror.tenants`, `identity_mirror.stores`. Do not write to other tables or topics from here.
- Reads from: Customer Master Postgres directly (DB-pull mode); Pub/Sub `identity.changed` (Pub/Sub mode, deferred). The CM DB read is bounded to `pull/reader.py`.
- DB-pull mode is the v1.0 launch path. Pub/Sub consumer mode is the architectural target; activated in a later slice when Customer Master emits.
- Both modes call the same upsert logic in `sync/`. Do not duplicate sync logic per mode.
- All Postgres access (read and write) uses `libs/dis-rls`. No raw SQLAlchemy sessions.
- All audit emission uses `libs/dis-audit`.
- Soft-delete via `is_active=false`; never hard-delete (canonical rows may still reference).
- Older `source_ts` (or `updated_at` from CM) doesn't overwrite newer rows.

## References

- `README.md` (this directory) — EPE block, file structure, behavioural detail.
- Root `CLAUDE.md` — project-wide invariants.
- `docs/architecture.md` §4 — module rationale.
- `docs/decisions.md` — indexed decision register.

## When uncertain

Refer to the current slice doc in `docs/slices/`. If silent there, refer to architecture. If still uncertain, ask before coding.
