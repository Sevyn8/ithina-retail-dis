# Pilot observations

Running log of what the slice-driven Claude Code workflow gets right and where
human review still earns its keep. One entry per slice. Purpose: calibrate how
much oversight each slice type needs, and feed fixes back into the slice-doc and
execution-prompt templates.

---

## Slice 1: Bootstrap Alembic migration

Outcome: all 8 acceptance criteria passed; merged in two commits (migration +
db-reset fix). Three plan-mode cycles before execution.

### What worked

The plan-output contract produced what it was designed to: the first plan
surfaced four blockers instead of working around them, resolved all seven open
questions against the actual files, and mapped every acceptance criterion to a
check. The slice-doc vs execution-prompt split held; the slice stayed a durable
contract while plan-shape requirements lived in the prompt.

Scope discipline held under pressure. The model flagged the db-reset bug and the
F1/F2/F3 issues but did not fix them, correctly treating them as out of scope
rather than silently expanding the slice.

### Calibration lessons

1. Safety is not surfaced unprompted. The first plan was strong, but the two
   findings that could have caused real damage only appeared after the operator
   forced an extra cycle: (a) the migration never stated which database or port
   it targets, and downgrade() runs DROP SCHEMA CASCADE, so a mispointed
   POSTGRES_ADMIN_URL could have destroyed Customer Master (5432/
   ithina_platform_db); (b) make db-reset was broken, running CREATE DATABASE as
   the NOCREATEDB service role. Neither was raised on the model's own initiative.
   Fix applied: a mandatory destructive-action and target-safety pass is now the
   first item in the execution-prompt plan contract.

2. Summaries get read as facts. The model twice asserted a specific DDL detail
   from an exploration summary rather than the file. The clearest case: it
   claimed audit.events had no event_date column and built a blocker and a
   recommendation on it; the column existed. It self-corrected before acting,
   by re-reading the file when prompted to re-plan, and flagged that the bad read
   had likely driven an operator decision. The self-correction is the contract
   working; the original slip is the failure mode to guard against.
   Mitigation that worked: the schema-name gate required evidence inline (the
   directory plus a schema-qualified object per schema) before implementation.
   The same show-the-line discipline should apply to any load-bearing claim, not
   just schema names.

### Residuals carried forward

- make db-reset would be more robust with DROP DATABASE ... WITH (FORCE) so idle
  clients (DBeaver) do not block it. Deferred; fix on next occurrence.
- pgcrypto is not installed. uuidv7() does not need it on Postgres 15
  (gen_random_uuid() is core), but libs/dis-pii (Slice 4) likely will. One-line
  CREATE EXTENSION when that slice lands; pgcrypto is on the Cloud SQL allowlist.
- Slice-text typos F1 (canonical file count) and F2 (version_id column name)
  corrected in the slice doc post-merge.

### Takeaway for remaining slices

The leverage is the forced safety pass and the evidence-gate, not heavier
review everywhere. Read-only or non-destructive slices need less; any slice that
writes, drops, or touches Postgres gets the target-safety pass and inline
evidence for load-bearing claims.
