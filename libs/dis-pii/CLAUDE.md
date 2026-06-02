# libs/dis-pii — Claude Code Context

Loaded when Claude Code works in `libs/dis-pii/`. Lib-specific rules; root `CLAUDE.md` applies first.

## What this lib is

PII tokenization. Deterministic HMAC-based tokenization with per-tenant keys. Used by all receivers BEFORE persistence.

For interfaces, types, file structure, see `README.md` in this directory.

## Rules specific to this lib

- PII tokenization is the receiver's first persistence-side step.
- Per-tenant HMAC key from Cloud KMS; key rotation invalidates prior tokens for that tenant (right-to-erasure semantics).
- Deterministic so joins on tokenized fields still work.
- Token vault writes are restricted-SA only; not exposed via RLS.

## References

- `README.md` (this directory) — interface and structure.
- Root `CLAUDE.md` — project-wide invariants.
