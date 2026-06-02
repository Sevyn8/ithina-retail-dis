# services/streaming-consumer — Claude Code Context

Loaded when Claude Code works in `services/streaming-consumer/`. Service-specific rules; root `CLAUDE.md` applies first.

## What this service is

The ELT pipeline. Reads `ingress.ready`, fetches the chunk, applies mapping, validates, atomic dual-writes to canonical or routes failures to quarantine. The largest service in DIS by code volume.

For the EPE block (purpose, entry, process, exit), file structure, and operational detail, see `README.md` in this directory. For the current build slice, see the slice doc in `docs/slices/`.

**Status:** v1.0.

## Rules specific to this service

- Writes to: `canonical.store_sku_current_position` (hot upsert), `canonical.store_sku_sale_events` / `store_sku_change_events` (event insert), `audit_events` (BQ), Pub/Sub `quarantine` and `pipeline.dlq`. Do not write to other tables or topics from here.
- Reads from: Bronze metadata + GCS payload, `config.source_mappings`, `identity_mirror` (fallback).
- All Postgres access uses `libs/dis-rls`. No raw SQLAlchemy sessions.
- All BigQuery access uses `libs/dis-core` BqClient.
- All audit emission uses `libs/dis-core` audit helpers.
- Atomic dual-write: hot upsert + event insert in ONE Cloud SQL transaction. See `decisions.md` D30.
- Stamp `mapping_version_id` on every produced canonical row. See `decisions.md` D22.
- Tenant-scoped batching: open one transaction per tenant batch; `SET LOCAL app.tenant_id` once per transaction.
- Circuit-breaker on Cloud SQL health (`SELECT 1` with 100ms timeout) before each batch.
- Replay: `mapping_version_id` defaults to the version on the row being replayed, not current ACTIVE.
- Manual batching: ~500 rows per transaction.
- Audit emission: INGRESS_EVENT-scoped event per stage + ROW-scoped events for failures only (Option B).

## References

- `README.md` (this directory) — EPE block, file structure, behavioural detail.
- Root `CLAUDE.md` — project-wide invariants.
- `docs/architecture.md` §4 — module rationale.
- `docs/decisions.md` — indexed decision register.

## When uncertain

Refer to the current slice doc in `docs/slices/`. If silent there, refer to architecture. If still uncertain, ask before coding.
