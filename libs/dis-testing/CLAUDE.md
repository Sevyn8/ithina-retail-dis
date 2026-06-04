# libs/dis-testing — Claude Code Context

Loaded when Claude Code works in `libs/dis-testing/`. Lib-specific rules; root `CLAUDE.md` applies first.

## What this lib is

Test fixtures, helpers, and factories. Pytest plugins for RLS context, identity_mirror seeding, bronze fixture data.

For interfaces, types, file structure, see `README.md` in this directory.

## Rules specific to this lib

- Fixtures here are test-only. Never import `dis-testing` from production code.
- Use the provided `tenant_factory` and `store_factory` for identity_mirror seeding; do not write raw SQL into tests.
- **Identity model (Slice 9a, D37/D52/D55):** fixtures pin the internal UUID (load-bearing) plus
  Customer Master's authoritative codes (`display_code`/`store_code`). Codes are unique across the
  set (the by-code index raises on duplicates) and exactly one INACTIVE store carries
  `store_code=None` to exercise the nullable path — keep both properties when editing fixtures.
  The retired `t_*`/`s_*` form must never reappear. JWT claims and CM-fake artifacts carry the
  codes, never internal UUIDs (provisional CM shape — see the divergence entry in `decisions.md`).
- The test-CM harness (`customer_master_db.py`) must never be stricter than live CM
  (e.g. its `display_code`/`store_code` are nullable because live is).

## References

- `README.md` (this directory) — interface and structure.
- Root `CLAUDE.md` — project-wide invariants.
