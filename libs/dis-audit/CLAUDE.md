# libs/dis-audit — Claude Code Context

Loaded when Claude Code works in `libs/dis-audit/`. Lib-specific rules; root `CLAUDE.md` applies first.

## What this lib is

Audit event emission. Helpers for INGRESS_EVENT-scoped and ROW-scoped audit emission to BigQuery `audit_events`. Volume model: Option B (see architecture §8).

For interfaces, types, file structure, see `README.md` in this directory.

## Rules specific to this lib

- INGRESS_EVENT-scoped: one row per (chunk × stage) summarising. Mandatory at every pipeline stage.
- ROW-scoped: one row per failed row. NOT emitted for successful rows.
- Fire-and-forget; failures are logged. Audit emission must not block the data path.

## References

- `README.md` (this directory) — interface and structure.
- Root `CLAUDE.md` — project-wide invariants.
