# libs/dis-mapping — Claude Code Context

Loaded when Claude Code works in `libs/dis-mapping/`. Lib-specific rules; root `CLAUDE.md` applies first.

## What this lib is

Mapping engine: applies a mapping config to raw rows. Four sub-stages: rename, normalize, cast, derive. Side-input refresh from `mapping.changed` Pub/Sub topic.

For interfaces, types, file structure, see `README.md` in this directory.

## Rules specific to this lib

- Mapping config is read-only here. Authoring lives in dis-api onboarding sub-module.
- Pure functions over `(mapping, raw_row) -> canonical_row`. No I/O.
- Custom transforms register at startup via the `escape_hatch/` registry pattern.
- Per-(tenant, source) cache; refreshed via `mapping.changed` Pub/Sub side input.

## References

- `README.md` (this directory) — interface and structure.
- Root `CLAUDE.md` — project-wide invariants.
