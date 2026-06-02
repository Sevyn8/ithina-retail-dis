# libs/dis-validation — Claude Code Context

Loaded when Claude Code works in `libs/dis-validation/`. Lib-specific rules; root `CLAUDE.md` applies first.

## What this lib is

Pandera-based validation. Two suites per mapping: pre-mapping (source-shape) and post-mapping (canonical-shape).

For interfaces, types, file structure, see `README.md` in this directory.

## Rules specific to this lib

- Pandera schemas only. No hand-rolled validation here (use dis-canonical models for shape checks).
- Failed rows produce a failure context dict with `stage`, `check`, `expected`, `actual`, `row_offset`.
- Pandera version pinned in pyproject; do NOT upgrade without testing all tenant suites.

## References

- `README.md` (this directory) — interface and structure.
- Root `CLAUDE.md` — project-wide invariants.
