# libs/dis-canonical — Claude Code Context

Loaded when Claude Code works in `libs/dis-canonical/`. Lib-specific rules; root `CLAUDE.md` applies first.

## What this lib is

Canonical schema models (Pydantic) and the canonical row builder. The source of truth for what a canonical row looks like.

For interfaces, types, file structure, see `README.md` in this directory.

## Rules specific to this lib

- Models here are the SHAPE. Adding a column means: (1) add to model here, (2) Alembic migration in repo-root `alembic/`, (3) update streaming-consumer mapping engine, (4) update dbt models in BQ.
- Never make a field optional that has a NOT NULL DB column.
- `mapping_version_id` is mandatory on every event-bearing model. See `decisions.md` D22.

## References

- `README.md` (this directory) — interface and structure.
- Root `CLAUDE.md` — project-wide invariants.
