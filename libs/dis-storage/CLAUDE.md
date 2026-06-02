# libs/dis-storage — Claude Code Context

Loaded when Claude Code works in `libs/dis-storage/`. Lib-specific rules; root `CLAUDE.md` applies first.

## What this lib is

GCS path scheme, signed URLs, metadata stamping. The canonical place for all GCS access in DIS.

For interfaces, types, file structure, see `README.md` in this directory.

## Rules specific to this lib

- All GCS access goes through this lib. Direct `google-cloud-storage` import is forbidden by CI lint.
- Canonical path scheme: `tenant/{id}/source/{id}/yyyy=Y/mm=M/dd=D/{trace_id}.{ext}`. Do NOT improvise other path shapes.
- Signed PUT URLs are scoped to exactly the path issued; do not issue wildcard URLs.

## References

- `README.md` (this directory) — interface and structure.
- Root `CLAUDE.md` — project-wide invariants.
