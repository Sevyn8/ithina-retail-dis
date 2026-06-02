# DIS Build Guide

**Audience:** human operator (Sanjeev, Amit) planning the build, sequencing work, and deciding when to promote deferred components. Not consumed by Claude Code.

**Scope:** build sequencing (phases and suggested cadence), build target portability, migration triggers, operator workflow (the 10-step build loop, plan-mode usage, slice exit). Mutates as the build progresses.

**Out of scope:**
- System rationale, modules, data flow → `architecture.md`.
- Indexed decisions → `decisions.md`.
- Repo layout, per-service file reference → `engineering-reference.md`, `repo-structure.md`.
- What Claude Code should build right now → the current slice doc in `docs/slices/`. Slice docs are the source of truth for what Claude Code builds; this guide tells the operator how to choose, scope, and sequence those slices.
- Cost projection → `cost-estimate.md`.

**Companion docs.**
- `architecture.md` — system rationale.
- `decisions.md` — indexed decision register.
- `engineering-reference.md` — repo and component reference.
- `cost-estimate.md` — beta-scale cost projection.
- `worked-example-streaming-consumer.md` — reference layout of the largest service.

---

## 1. Build model: slices through phases

The build is decomposed into **slices**. A slice is one vertical cut through the ingest pipeline that delivers an end-to-end working capability: ingress on one channel for one source format reaching canonical for one event type. Each slice lives in `docs/slices/slice-NN-<short-name>.md` and is the document Claude Code reads to know what to build.

Slices sit inside **phases**. Phases describe ordering, not duration. Move from one phase to the next when the prerequisites for the next phase are met, not on a schedule.

The phases are deliberately interface-first: Phase 0 freezes contracts and shared libs so that Phase 1 can be done in parallel without coordination overhead. Phase 2 integrates; Phase 3 hardens for production. Slices accumulate inside each phase.

---

## 2. Build phases

### 2.1 Phase 0: foundation (one owner, before any service work)

Phase 0 is **interface-freezing**. Until it's done, parallel work in Phase 1 cannot be truly independent. The whole point of Phase 0 is that nobody waits in Phase 1.

**Deliverables:**

- `contracts/pubsub/*.schema.json` frozen: every Pub/Sub message schema written, reviewed, merged. Includes `ingress.ready`, `ingress.resubmit`, `identity.changed`, `quarantine`, `pipeline.dlq`, `mapping.changed`.
- `contracts/identity-service/` gRPC service definition frozen.
- `contracts/customer-master/` contract document written (what DIS depends on; pending Customer Master sign-off if needed).
- `schemas/canonical/` initialized as a dbt project with `current_store_positions` and the event tables defined.
- `schemas/config/`, `schemas/bronze/`, `schemas/identity_mirror/`, `schemas/quarantine/`, `schemas/staging/` initial DDL written.
- `libs/dis-core/`, `libs/dis-canonical/`, `libs/dis-mapping/`, `libs/dis-validation/`, `libs/dis-rls/`, `libs/dis-audit/`, `libs/dis-pii/`, `libs/dis-storage/`, `libs/dis-testing/` exist as stub packages with intended interfaces and minimal implementations.
- Root `CLAUDE.md` written with project-wide invariants (canonical schema location, PII tokenization at receiver, GCS path conventions via `libs/dis-storage`, Pandera not GE, RLS-aware writes always, build target portability via env vars, etc.).
- Per-service `CLAUDE.md` stubs in place for the eleven services.
- Docker-compose dev stack runnable: Postgres with all schemas applied, Pub/Sub emulator with all topics created, fake Identity Service responding to all four methods, fake Customer Master issuing test tokens.
- `infra/terraform/` exists and can apply to a dev GCP project, provisioning the real resources every service expects.

**Exit criterion:** any Phase 1 owner can clone the repo, run `make run-local` from their service directory, and have a working service that talks to real fakes against frozen contracts.

### 2.2 Phase 1: parallel service implementation (one owner per service)

With Phase 0 complete, services can be built in parallel without coordination on contracts or shared libs.

**Suggested assignment** (one person per service, larger services may pair):

| Owner | Service(s) |
|---|---|
| Owner A | one or more receivers (`receiver-api`, `receiver-csv-upload`, `receiver-csv-erp`, `receiver-reverse-api`) |
| Owner B | `identity-service` + `mirror-sync-consumer` |
| Owner C | `streaming-consumer` |
| Owner D | `quarantine-drainer` + `nightly-batch` + `daily-compute` |
| Owner E | `dis-api` (includes the onboarding sub-module: inference, suggestion, validation_draft, shadow) |
| UI track | `ui/` (separate cadence) |

**Phase 1 rules:**

- Each service must pass its own service-local integration tests (against fakes) before merging to main.
- Each service must run via `make run-local` against the docker-compose stack. If it doesn't, the integration milestone will reveal it; better to catch in Phase 1.

**Exit criterion:** every service has its happy-path scenario working in isolation against fakes.

### 2.3 Phase 2: integration

Phase 2 verifies that services correctly produce and consume the agreed-on messages and that the full pipeline runs end-to-end.

**Integration milestones, in order:**

1. **Identity flow:** Identity Service + Mirror Sync Consumer working together. `identity.changed` events flow; mirror tables populate. Foundation for FK enforcement in canonical writes.
2. **Receiver → Streaming Consumer:** any one receiver publishes to `ingress.ready`; the streaming consumer reads it, applies a stub mapping, and writes to canonical. RLS verified by writing from two tenants and confirming cross-tenant reads are blocked.
3. **Quarantine flow:** streaming consumer routes a failing row to the `quarantine` topic; drainer writes to the quarantine table; dis-api reads it; the UI can display it.
4. **Onboarding flow:** sample uploaded via dis-api; dis-api's onboarding sub-module generates a draft mapping (inference + suggestion + validation_draft layers); operator approves to staged; streaming consumer runs the staged mapping into the staging schema; operator promotes to active.
5. **Nightly batch:** synthetic event slice from Cloud SQL lands in BigQuery; eviction works; no data loss.
6. **Daily compute:** synthetic day-window events produce a new `signal_history` row; `store_sku_current_position` derived columns updated.
7. **Replay:** chunk replayed via `tools/replay/`; new `trace_id`; `parent_trace_id` correctly linked; canonical reflects the replay; audit shows the chain.
8. **Full e2e:** all of the above running simultaneously against a multi-tenant dev environment.

**Phase 2 rules:**

- An integration milestone failing is the signal to stop and fix the contract or the service producing/consuming the failing message. It is not the signal to keep building further away.
- Integration milestones are reviewable artifacts: each one passes a documented test in `tests/e2e/` or `tests/integration/`.
- Phase 2 owners are the same as Phase 1, but they now work in pairs on the integration boundaries.

**Exit criterion:** the full e2e test suite passes. The system can accept ingress, process it, land it in canonical, surface failures in the UI, and replay from bronze.

### 2.4 Phase 3 and beyond: production hardening

Not detailed here. Once Phase 2 passes, the system is functional. What follows (observability deepening, performance tuning, cost optimization, multi-region readiness) is shaped by what production usage reveals.

### 2.5 What must be true throughout all phases

- Contracts are immutable once merged unless a coordinated change is made. The temptation to "just tweak the schema" in Phase 1 destroys parallelism.
- Shared libraries are owned. PRs to them follow normal review. Phase 1 owners do not merge their own lib changes.
- Each `CLAUDE.md` is kept current. When a Phase 1 owner discovers a new invariant or convention, it goes in the service `CLAUDE.md` and, if cross-cutting, in the root `CLAUDE.md`. This is the difference between Claude Code being effective across sessions and not.
- The docker-compose dev stack works for everyone, on every machine, every day. If it breaks for one owner, it's a Phase-0 regression and gets fixed immediately, before Phase 1 work continues.

---

## 3. Suggested cadence (week-by-week)

The phases above are the structural order. Within Phase 1, the following cadence groups parallel work into roughly two-week batches. Real durations vary by team and discoveries; use this as a default plan and adjust as Phase 0 actually completes and signals appear.

### Wk 1-2 (foundations of Phase 1)
**Build:** Receiver service (containerised). DuckDB pre-flight + GCS bronze write. PII redaction (KMS, deterministic tokenisation, vault bucket). Pub/Sub topics provisioned (`ingress.ready`, `quarantine`, `pipeline.dlq`, etc.).
**Defer:** auth method beyond API keys (revisit when 2nd tenant onboards); per-tenant rate limiting (revisit at first abuse).

### Wk 3-4
**Build:** Identity Service + admin DB (physically separate). Mirror Sync Consumer. Cloud SQL Postgres single-zone with PITR. `identity_mirror` + canonical hot schemas + RLS. Stale-while-error + receiver-local fallback wired in.
**Defer:** Cloud SQL HA (revisit at first paying-tenant SLA); read replica (revisit at 60% read CPU sustained); Redis identity cache (revisit at 10k+ resolves/sec).

### Wk 5-6
**Build:** Streaming consumer (Pub/Sub pull, containerised). Pandera source-shape + canonical-shape suites (per-tenant, versioned). Mapping engine (rename, normalize, cast, derive). Quarantine drainer. DLQ topic + circuit-breaker on Cloud SQL health.
**Defer:** higher-throughput runtime migration (revisit on `decisions.md` D4 trigger).

### Wk 7-8
**Build:** Onboarding sub-module inside dis-api (rule-based schema inference + mapping suggestion only). DIS UI core: sample upload, onboarding review, mapping config CRUD. DIS backend services integrate with Customer Master for auth context. Shadow rollout: staging schema, promote-to-active flow.
**Defer:** historical-learning suggestions (revisit at 20 approved mappings); LLM-assisted suggestions (revisit when onboarding throughput becomes a bottleneck); machine auth migration to Customer Master (revisit when Customer Master scope firms up).

### Wk 9-10
**Build:** BigQuery `audit_events` streaming. DIS UI: quarantine console (tenant + ops views), audit lookup, resubmit loop. DuckDB query panel for ops. Cloud Logging + Monitoring dashboards (latency SLOs, DLQ depth, quarantine rate).
**Defer:** tenant-facing DQ scorecards (revisit when first tenant requests).

### Wk 11-12
**Build:** Nightly batch job (Cloud Scheduler + containerised job). dbt project: `canonical_history` models + dbt-expectations tests. BigQuery `canonical_history` populated nightly. GCS lifecycle policies live. v1.0 cutover and first paying-tenant onboarding.
**Defer:** Dataform migration (revisit if dbt operational overhead grows past 0.5 FTE).

---

## 4. Migration triggers (consolidated)

Every deferred component has an explicit promote-when trigger. Capturing them in one table avoids "we'll get to it eventually" drift. First trigger met wins.

| Deferred component | Promote when |
|---|---|
| Higher-throughput runtime (e.g. Dataflow) replaces streaming consumer | Sustained 500+ rows/sec for 7 days, OR consumer scaling above 20 concurrent instances, OR p95 latency above 10s. See `decisions.md` D4. |
| Cloud SQL HA | First paying-tenant SLA mandating 99.99%, OR after first single-zone outage incident |
| Cloud SQL read replica | Read CPU sustained above 60%, OR p95 read latency above 200ms |
| Redis identity cache | Identity resolves above 10k/sec, OR in-process LRU hit rate drops below 80% |
| Historical-learning onboarding | 20+ approved mappings in `config.source_mappings` |
| LLM-assisted onboarding | Onboarding throughput becomes a bottleneck (signal: tenant onboarding time-to-active exceeds 1 week consistently) |
| GE Data Docs (alongside or replacing Pandera reports) | First tenant contractually requires HTML audit reports |
| Machine auth to Customer Master | Customer Master scope expands to cover machine credentials, OR operational cost of running two auth domains becomes high enough to consolidate |
| Trace-level dedup at streaming-consumer entry (skip retry if prior `CANONICAL_WRITTEN` audit exists) | Retry rate accounts for material compute cost; signal: `DUPLICATE_NOOP` audit volume sustained above 10% of total. See `architecture.md` §9.2. |
| Read replica for `audit_events` BigQuery dataset | Audit query load impacts BQ slot budget for canonical_history dbt runs |

---

## 5. Build target portability

The repo is built to run identically on a developer's machine and in cloud (dev/staging/prod GCP). The operator picks a build target; the code does not change. There are no `if env == "local"` branches in service code, no per-target forks, no manual config edits to switch between targets. The build target is the only switch.

### 5.1 How it works

Every external dependency the platform uses has either an emulator or a fake substitute that speaks the same protocol as the real cloud service. Service code uses the standard client libraries, which honour environment variables to route to the right backend. The environment variables are set differently per build target by the surrounding tooling (`docker-compose` for local, Terraform/k8s for cloud); operators do not set them by hand.

### 5.2 The build targets

| Target | Used for | Dependencies routed to |
|---|---|---|
| `local` | Developer machines, `make run-local`, local tests | docker-compose stack: emulators and fakes |
| `dev` | Shared dev environment in GCP | Real GCP services in a `dev` project |
| `staging` | Pre-production verification | Real GCP services in a `staging` project |
| `prod` | Production | Real GCP services in a `prod` project |

### 5.3 What changes between targets: only environment variables

| Dependency | Local target | Cloud targets |
|---|---|---|
| Pub/Sub | `PUBSUB_EMULATOR_HOST=pubsub:8085` set; client routes to emulator | `PUBSUB_EMULATOR_HOST` unset; client routes to real Pub/Sub |
| GCS | `STORAGE_EMULATOR_HOST=http://fake-gcs:4443` set | `STORAGE_EMULATOR_HOST` unset |
| Cloud SQL | `POSTGRES_URL=postgresql://...@postgres:5432/dis` (local Postgres container) | `POSTGRES_URL=postgresql://...@<cloud-sql-host>:5432/dis` |
| Redis (identity cache) | `REDIS_URL=redis://redis:6379` | `REDIS_URL=redis://<memorystore-host>:6379` |
| BigQuery | Mocked in unit tests; shared dev BQ project for integration | Real BigQuery per environment |
| Identity Service | `IDENTITY_SERVICE_URL=http://fake-identity:8080` (fake from `libs/dis-testing`) | `IDENTITY_SERVICE_URL=http://identity-service:8080` (real service in cluster) |
| Customer Master | `CUSTOMER_MASTER_URL=http://fake-cm:8080` (fake from `libs/dis-testing`) | `CUSTOMER_MASTER_URL=https://<customer-master-prod>` |
| Secrets | `.env` file (gitignored) read by config loader | Secret Manager via Workload Identity |
| Logging | stdout + local files | Cloud Logging |

### 5.4 What the operator does

- **Run locally:** `make run-local` from the service directory. Docker-compose handles the env vars.
- **Deploy to dev/staging/prod:** Terraform pipeline runs; service is deployed with the right env vars injected by the deployment manifest. No code change needed.
- **Switch targets:** stop the local stack; deploy to cloud, or vice versa. Same code.

### 5.5 What this enables for Claude Code

Slice docs say "build feature X." Claude Code writes code that uses standard client libraries; the code runs both locally and in cloud without modification. Claude Code does not need to know which target is active. The operator picks the target by choosing the tool to run.

---

## 6. Operator workflow: building one slice with Claude Code

This is the **10-step build loop** for taking one slice from draft to merged.

### 6.1 The loop

1. **Draft the slice in Claude AI (this conversation surface).** Capture: goal, hard constraints, acceptance criteria, failure-mode categories, plan-mode prompts per checkpoint. Save to `docs/slices/slice-NN-<short-name>.md`. The slice doc is goal-oriented and bounded; HTTP codes, response shapes, idempotency window come from Claude Code in plan mode, not from the slice doc.
2. **Update root `CLAUDE.md` if the slice introduces a new project-wide invariant.** Same for service `CLAUDE.md` if it introduces a service-specific rule.
3. **Git checkpoint.** Commit the slice doc and any CLAUDE.md updates before opening Claude Code. Tag if helpful.
4. **Open Claude Code in plan mode** (Shift+Tab twice). Plan mode is research/analysis-only; no file writes.
5. **Feed the plan-mode prompt from the slice doc.** Tell Claude Code which checkpoint to plan for. Claude Code returns its plan: file list, libraries used, HTTP shapes, idempotency mechanism, test layout.
6. **Review the plan.** If wrong: correct via conversation, or revise the slice doc and re-prompt. If right: approve.
7. **Execute the checkpoint.** Claude Code writes the files; you watch.
8. **Checkpoint review.** Run tests; review diffs; identify gaps. If gaps: feed them back; Claude Code revises.
9. **Next checkpoint or session boundary.** If the slice has more checkpoints, repeat from step 4 for the next one. If the slice is done: merge and move to next slice. If the session is long: `/resume` later.
10. **Slice exit.** Acceptance criteria all met → merge. Update build-guide.md (this doc) with anything learned that affects future slices.

### 6.2 When to intervene

- **Plan looks wrong.** Stop, correct, replan. Cheaper than reviewing wrong code.
- **Tests fail unexpectedly.** Read Claude Code's analysis; if it's heading toward a fix that violates a slice constraint, push back.
- **Claude Code proposes a change outside the slice scope.** Hold the line. New scope = new slice.
- **A CLAUDE.md invariant gets broken.** That's a failure of the loop. Fix the invariant statement first, then re-execute.

### 6.3 Design vs build

This guide is for the build phase: an architect has decided what the system should do, and Claude Code implements one slice at a time. Architecture decisions belong in `architecture.md` and `decisions.md`; the operator does not negotiate them mid-build. If a slice surfaces a real architectural gap, stop the slice, raise the question, resolve in `decisions.md`, update the slice doc, then resume.

### 6.4 CLAUDE.md hygiene

- Root `CLAUDE.md` < 200 lines. Past that, instruction-following degrades.
- Per-service `CLAUDE.md` < 100 lines. Auto-loaded when Claude Code works in that directory.
- Per-lib `CLAUDE.md` < 50 lines.
- New invariants discovered during a slice go into the relevant CLAUDE.md before the next slice starts. This is the single biggest lever on cross-session quality.

### 6.5 Common pitfalls

- **Over-specifying the slice.** Slice docs name the goal, the hard constraints, and the failure-mode categories. They do not name HTTP status codes, response field shapes, or library versions. That's plan-mode territory.
- **Letting Claude Code propose architecture.** Plan-mode plans are about implementation, not design. If Claude Code's plan changes the architecture, stop.
- **Skipping plan mode.** Going straight to execution is fast in the short term and expensive over weeks. Plan mode is the leverage point.
- **Forgetting to checkpoint git.** When Claude Code goes wrong, you want a clean rollback.
- **Not updating CLAUDE.md.** Every slice teaches the system something. If you don't capture it, the next slice re-learns it.

---

## 7. Document lifecycle

This doc mutates as the build progresses. Treat it as a living plan, not a frozen spec.

- **Phases and slices completed:** mark in §2 and §3.
- **Migration triggers fired:** mark in §4; record the promotion decision in `decisions.md`.
- **New triggers discovered:** add to §4.
- **Operator workflow refinements:** update §6.
- **Whole sections obsoleted:** delete; don't leave stale guidance in place.

When a section grows past ~150 lines, consider splitting it into its own doc.

---
