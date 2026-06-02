# libs/dis-testing — Claude Code Context

Loaded when Claude Code works in `libs/dis-testing/`. Lib-specific rules; root `CLAUDE.md` applies first.

## What this lib is

Test fixtures, helpers, and factories. Pytest plugins for RLS context, identity_mirror seeding, bronze fixture data.

For interfaces, types, file structure, see `README.md` in this directory.

## Rules specific to this lib

- Fixtures here are test-only. Never import `dis-testing` from production code.
- Use the provided `tenant_factory` and `store_factory` for identity_mirror seeding; do not write raw SQL into tests.

## References

- `README.md` (this directory) — interface and structure.
- Root `CLAUDE.md` — project-wide invariants.
