# libs/dis-core — Claude Code Context

Loaded when Claude Code works in `libs/dis-core/`. Lib-specific rules; root `CLAUDE.md` applies first.

## What this lib is

Foundational utilities: `errors` (the `DisError` root), `identifiers`, `ids` (UUIDv7), `trace_id`, `timestamps`, structured `logging`, the `bq.BqClient` stub, and the `identity` client. Dependency-light; no business logic.

For interfaces, types, file structure, see `README.md` in this directory.

## Rules specific to this lib

- BqClient is the ONLY way to query BigQuery in DIS. Direct `google-cloud-bigquery` import is forbidden by CI lint. It auto-injects `WHERE tenant_id = :tenant_id`; callers pass tenant_id. Phase 1 it is an inert stub (no BigQuery until Phase 3 / Slice 21; `decisions.md` D34).
- IDs: use `ids.new_uuid7`; do NOT use `uuid4` anywhere in DIS code.
- All errors subclass `errors.DisError`. `errors.py` is leaf-level (imports nothing first-party); `identity` and the other modules import *from* it. `dis-core` never imports `dis-testing`.
- **`TenantId`/`StoreId` name collision (latent D37 split).** `identifiers.py` defines them as **`UUID`** (internal DB/RLS/canonical keys); `identity/models.py` defines them as **`Annotated[str]`** (external `t_*`/`s_*` Customer Master contract ids). Same names, opposite types, different modules. For anything touching the DB/RLS/canonical, import the UUID forms from `dis_core.identifiers`. The external↔internal mapping is unresolved (`decisions.md` D37, OPEN).

## References

- `README.md` (this directory) — interface and structure.
- Root `CLAUDE.md` — project-wide invariants.
