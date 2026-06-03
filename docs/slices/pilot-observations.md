# Pilot observations

One entry per slice. Lessons worth keeping, not incident logs. Keep each entry
crisp; this doc is context for CHAT and must not bloat.

---

## Slice 1: Bootstrap Alembic migration

Outcome: 8/8 criteria; two commits; three plan cycles.

Lessons:
- Safety is not surfaced unprompted. Any slice that writes/drops/touches Postgres gets a forced target-safety pass (which DB/port, what the destructive path does). Now item 1 of the plan contract.
- Summaries get read as facts. Load-bearing claims carry inline evidence (file+line or introspected row), not a summary.

Carried forward:
- Heavier review is not the leverage; the safety pass and evidence-gate are. Read-only slices need less.

---

## Slice 3: shared-library primitives + canonical models

Outcome: criteria passed; scoped commits; register clean. First pure-library slice (no writes).

Lessons:
- Green is not completeness. A passing test proves the artifact agrees with its test; if both came from one source pass, an omission passes silently. Verify "mirrors X" claims against X independently (fresh pull, exact match both directions), not the artifact's own test.
- Force an inventory at completion (files, deps, tests + what each asserts). Assess coverage, not pass/fail. Now a gate.
- Log register gaps before commit, own identifiers, same pass. Decisions in force without an entry are debt the next slice inherits. Now a gate.
- CC pushing back on review feedback (re-verifying rather than complying) is correct, not friction. Feedback is input to check, not a verdict.
- Decision-vs-schema drift recurs; expect it, don't treat as one-off.

Carried forward:
- Pure-library/read-only slices: light safety pass, leverage shifts to completeness verification and register hygiene.

---

## Slice 4: Data plane safety (dis-rls, dis-pii, dis-storage)

Outcome: 8/8 criteria; register clean (D40, D41 opened OPEN). First autonomous
run: CC under auto edit approval, no operator diff-watching, gated by a
completion-report account plus an adversarial self-validation pass.

Lessons:
- Autonomous + adversarial self-check can replace diff-watching, if the check
  pulls from a source independent of the implementation. CC's honest "what a test
  enforces vs what is review-only" split, plus forced re-derivation (re-introspect
  the live DB, re-run the gates), caught a brittle PII test and surfaced
  skip-masking. The report and the self-validation found the issues; diff review
  did not.
- A self-check at the same vantage as the work shares its blind spot. Make it
  re-derive from the live DB and re-run gates it did not author, and force the
  "what could a passing test still miss" question.
- Unenforced invariants are the residue of dropping diff-watching. Several
  watch-list properties hold structurally now but nothing fails loud on future
  regression. The fix is not more watching: turn the CLAUDE.md hard rules into
  executable lint plus per-rule invariant tests. Owed as a guardrails slice.
- Skip-masking: a load-bearing test that skips when its dependency is absent
  reports green without having run, so green did not mean proven. Fix applied:
  load-bearing proofs ERROR at setup, never skip, and never fall back to a guessed
  default (a silent fallback is the same disease).

Carried forward:
- Execute gate is now auto edit, executable gates as the stop, a completion-report
  account, an adversarial self-validation pass, and CHAT reads the report. Diffs
  read only where the report leaves a property uncovered or semantic.
- New invariant: load-bearing proofs error, never skip, on an absent dependency.
- Guardrails slice owed: executable invariants (import-linter contracts + per-rule
  tests + a negative-space scope check) and CI that runs stack-up and errors on an
  absent mandatory proof rather than skipping it.
