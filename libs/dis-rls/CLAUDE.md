# libs/dis-rls — Claude Code Context

Loaded when Claude Code works in `libs/dis-rls/`. Lib-specific rules; root `CLAUDE.md` applies first.

## What this lib is

RLS-aware database session helpers. Wraps SQLAlchemy with `SET LOCAL app.tenant_id` enforcement.

For interfaces, types, file structure, see `README.md` in this directory.

## Rules specific to this lib

- All canonical reads/writes go through this lib. Direct SQLAlchemy session usage is forbidden by CI lint.
- Context manager pattern: `with rls_session(tenant_id) as s: ...` — `SET LOCAL` runs first, every statement scoped.
- Never set `tenant_id` from request body. Always derive from authenticated upstream context.

## References

- `README.md` (this directory) — interface and structure.
- Root `CLAUDE.md` — project-wide invariants.
