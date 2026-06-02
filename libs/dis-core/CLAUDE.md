# libs/dis-core — Claude Code Context

Loaded when Claude Code works in `libs/dis-core/`. Lib-specific rules; root `CLAUDE.md` applies first.

## What this lib is

Foundational utilities: structured logging, IDs (UUIDv7), tracing context, BqClient wrapper for BigQuery, audit-event helpers, error types.

For interfaces, types, file structure, see `README.md` in this directory.

## Rules specific to this lib

- BqClient is the ONLY way to query BigQuery in DIS. Direct `google-cloud-bigquery` import is forbidden by CI lint.
- BqClient auto-injects `WHERE tenant_id = :tenant_id` on every query. Callers must pass tenant_id.
- IDs: use the provided UUIDv7 helper; do NOT use uuid4 anywhere in DIS code.
- Audit emission is fire-and-forget; failures are logged but do not raise to caller.

## References

- `README.md` (this directory) — interface and structure.
- Root `CLAUDE.md` — project-wide invariants.
