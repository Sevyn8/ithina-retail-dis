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

Outcome: 8/8 criteria. First autonomous run: CC under auto edit approval, no
operator diff-watching, gated by a completion-report account plus an adversarial
self-validation pass.

Lessons:
- Autonomous + adversarial self-check can replace diff-watching, but only if the
  check pulls from a source independent of the implementation. Forced re-derivation
  (re-introspect the live DB, re-run gates the check did not author) plus an honest
  "what a test enforces vs what is review-only" split caught issues diff review did
  not.
- A self-check at the same vantage as the work shares its blind spot. Make it
  re-derive from live sources and force the "what could a passing test still miss"
  question.
- Skip-masking: a load-bearing test that skips when its dependency is absent
  reports green without running. Load-bearing proofs ERROR at setup, never skip, and
  never fall back to a guessed default (a silent fallback is the same disease).
- Dropping diff-watching leaves unenforced invariants as residue: properties that
  hold structurally but fail loud on nothing. The fix is executable invariants
  (lint + per-rule tests), not more watching.

Carried forward:
- Guardrails work owed: executable invariants (import-linter contracts + per-rule
  tests + a negative-space scope check) and CI that errors on an absent mandatory
  proof rather than skipping it.

---

## Slice 5: Pipeline mechanics (dis-mapping, dis-validation)

Outcome: 8/8 criteria; seven scoped commits; two plan cycles. First slice where the
logic itself is the deliverable (mapping engine + validation suites), not plumbing.

Lessons:
- Introspection truncated at display width mis-classifies silently. Reading column
  comments through a tool that truncates produces wrong classifications with the
  right totals, which the count test cannot catch. Pull full untruncated comments;
  "right total, wrong bucket" is a named self-validation hunt item for any
  classification work.
- The completion report is an account to check, not trust. Its stated counts were
  wrong and were corrected only by independent re-derivation in self-validation, not
  by the inventory pass.
- Independent expected values catch silent-wrong-value bugs. A plausible-but-wrong
  parse passes any test whose expected value was copied from the impl; it fails a
  test whose expected value was hand-derived from the rule. Expected-value-from-an-
  independent-source is what catches the silent-wrong class.
- Mechanism-not-policy is the frame for a pure lib. Business rules stay handed-in
  data or model-derived, never literals in lib code. A default is allowed only when
  it can fail louder, never admit wrong data; the test is "can it pass bad data,"
  not "is it a default."
- Pin an invariant a downstream decision rests on, even when it holds by
  construction. A property that is true today by how the code is shaped still needs
  a test, or a future change breaks it silently and the dependent decision inherits
  the break.

Carried forward:
- Pinned-dependency bug pattern: contain the workaround, and make the canary assert
  the upstream bug STILL exists (not a version-string check), so the workaround is
  forced out when its cause changes.

---

## Slice 7: Mirror Sync Consumer (DB-pull mode)

Outcome: 9/9 criteria; five scoped commits; one plan cycle after a research gate.
First service slice; first to read a second Postgres (Customer Master) and write a
replica into DIS.

Lessons:
- Uncollected is the new skipped. A whole service test suite was invisible to the
  runner (testpaths excluded its dir); CI would have gone green running none of it.
  Self-validation caught it, the build pass did not. The runner must fail when a dir
  is uncollected, not pass silently.
- Research before the doc when scope hinges on unknown live facts, so the doc is
  accurate rather than corrected later.
- Docs name mechanisms the schema lacks; found by introspection, not by reading the
  docs. Recurs across slices.
- A frozen contract does not fit every consumer. Log-only plus a registered gap
  beats shoehorning a new case into an existing vocabulary.
- Two-instance safety = positive assertion on each side: each connection asserts the
  DB it IS on, the read runs first, a mix-up exits before any write.

Carried forward:
- Positive-target-assertion is the pattern for any later service reading an external
  Postgres and writing DIS.
- A reusable external-Postgres test harness, once built, is reused by the next
  external-reading slice, not rebuilt.
- CI-fails-on-uncollected folds into the owed guardrails work.
