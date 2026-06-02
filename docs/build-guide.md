# DIS Build Guide

**Purpose.** Top-level operator dashboard. Ordered work items grouped by phase. Sequence reflects real dependencies, not a schedule. Each item carries a status and a one-line description of what is implemented when DONE.

**Status values.** `TODO` (not started), `WIP` (in progress), `DONE` (merged), `DEFERRED` (intentionally not in v1.0; trigger named).

**How to update.** Edit by hand. Change the status word in-place when an item moves.

**Companion docs.**
- `architecture.md` — system rationale.
- `decisions.md` — indexed decision register.
- `engineering-reference.md` — top-level repo index.
- `repo-structure.md` — detailed directory trees.
- `cost-estimate.md` — beta-scale projection.
- `local-setup.md` — devbox setup.

---

## Phase 0: Foundation

Interface-freezing. Until done, no service implementation can be truly parallel.

### Workspace and tooling

- `DONE` Workspace dependencies declared and installed; any developer running `uv sync` gets the same 151 packages.
- `DONE` Python 3.12 pinned project-wide via uv.
- `DONE` `make` targets cover the daily commands: stack up/down/reset, db migrate, tests, lint, format, topic creation, dbt run.
- `DONE` Local env vars centralized in `.env` (gitignored) and `.env.example` (committed).
- `DONE` `pre-commit` hooks block bad commits at commit-time: lint, format, whitespace, EOF, YAML/JSON syntax, large files.
- `DONE` `scripts/check_setup.sh` runs six tiers of preflight checks and reports PASS / FAIL / SKIP with hints.

### Local stack

- `DONE` Four containers run from one `docker-compose.yml`: Postgres on 5433, Pub/Sub emulator, fake-gcs-server, Redis.
- `DONE` Postgres bootstraps with two roles: `ithina_dis_admin` (for migrations) and `ithina_dis_user` (NOSUPERUSER NOBYPASSRLS for service code). RLS posture matches production from day one.
- `DONE` All six DIS Pub/Sub topics are created automatically on `make run-local`.
- `DONE` Smoke tests against the running stack pass: Postgres accepts queries, topics list, GCS responds, Redis pings.

### Schemas

- `DONE` Postgres DDL for every DIS schema (canonical, bronze, config, identity_mirror, quarantine, staging, plus UUIDv7 extension) lives at `schemas/postgres/<schema>/`.
- `DONE` BigQuery DDL for `canonical_history.*` and `audit_events` lives at `schemas/bigquery/`.

### Migrations and analytics tooling

- `DONE` Alembic is wired to the admin Postgres role and ready to run migrations.
- `DONE` dbt is wired to BigQuery via OAuth and ready to run models.

### Contracts

- `DONE` Six Pub/Sub message schemas (`ingress.ready`, `ingress.resubmit`, `identity.changed`, `quarantine`, `mapping.changed`, `pipeline.dlq`) frozen with examples.
- `DONE` Identity Service contract frozen: OpenAPI (authoritative), proto (reference), attribute-needs and decisions docs.
- `TODO` Customer Master contract written down and signed off by the Customer Master team, capturing what DIS depends on (JWT shape, upload session lifecycle, identity change events).

### Service and lib scaffolding

- `DONE` All 11 service directories exist with their own `CLAUDE.md` (rules) and `README.md` (EPE block).
- `DONE` All 9 lib directories exist with their own `CLAUDE.md` and `README.md`.
- `DONE` Placeholder stub modules for the test fakes exist so `.env` references aren't dangling.

### Documentation

- `DONE` Root `CLAUDE.md` and `README.md` published; Claude Code auto-loads `CLAUDE.md` at session start.
- `DONE` All design docs in `docs/`: architecture (md + html), decisions, engineering-reference, repo-structure, build-guide, cost-estimate, local-setup, worked-example.

### Git and CI

- `DONE` Local git initialized on `main`; root commit captures verified Phase 0 state.
- `TODO` GitHub repo created, code pushed; team can clone and `make run-local`.
- `TODO` Every push and PR triggers ruff lint, ruff format check, and pytest collection on GitHub Actions.

### Infrastructure (deferred until needed)

- `DEFERRED` Terraform applies cleanly to `ithina-dis-dev` GCP project. *Trigger: first slice that needs a real cloud resource.*
- `DEFERRED` `ithina-dis-dev` GCP project created and billed. *Trigger: same as Terraform.*
- `DEFERRED` `ithina-dis-staging` GCP project created. *Trigger: v1.0 launch readiness review begins.*
- `DEFERRED` `ithina-dis-prod` GCP project created. *Trigger: tenant onboarding date confirmed.*

**Phase 0 exit criterion.** Every non-DEFERRED item above is DONE. `check_setup.sh` is green. `ithina_dis_user` can query empty DIS tables; the system is ready for Slice 1.

---

## Phase 1: Slice-driven service implementation

Each slice is one end-to-end vertical cut. Slice docs live in `docs/slices/slice-NN-<short-name>.md`. The slice doc is the source of truth Claude Code reads.

### Bootstrap

- `DONE` Slice 1: Bootstrap Alembic migration (`alembic/versions/0001_bootstrap.py`). Applying migrations creates every DIS schema (canonical, bronze, config, identity_mirror, quarantine, staging, audit, plus the `public.uuidv7()` function) in local Postgres; `\dn` lists them. The migration is a manifest that applies the `schemas/postgres/` DDL files verbatim in dependency order, then authors the 7 `CREATE SCHEMA`s, a centralized grants block, and 7 daily partitions for each of the 7 partitioned parents (canonical/staging event + signal_history tables, and `audit.events`). `ithina_dis_user` gets USAGE on schemas + table SELECT/INSERT/UPDATE/DELETE + sequence USAGE (incl. `ALTER DEFAULT PRIVILEGES` so later partitions inherit) so service code can read/write but cannot bypass RLS. `env.py` resolves the connection from `POSTGRES_ADMIN_URL` (no hardcoded host/port/role) and a `current_database()` guard refuses to run against the wrong DB (protects Customer Master on 5432).

  **Cloud bootstrap run-order** (Cloud SQL; run once per fresh instance, the role step is NOT part of the migration): (1) run `schemas/postgres/00_bootstrap/roles.sql` as the Cloud SQL admin against the DIS database, passing `-v dis_admin_password=... -v dis_user_password=...`; (2) export `POSTGRES_ADMIN_URL` pointing at the DIS database as `ithina_dis_admin`; (3) `alembic upgrade head`. Locally these roles come from docker-compose + `infra/local/postgres-init.sql` instead.

### Test infrastructure

- `TODO` Slice 2: Identity Service and Customer Master fakes, plus a test fixture seeder. Customer Master fake issues signed test JWTs and publishes a JWKS endpoint for verification; serves upload sessions; emits `identity.changed` Pub/Sub events when tenants/stores are seeded or changed. Identity Service fake answers all four methods (`resolve_from_token`, `resolve_from_upload`, `resolve_from_endpoint`, `validate`) with canned data. Fixture seeder is **for tests only**: writes test tenants/stores into `identity_mirror`, plus a default test `config.source_mappings` row, bypassing the CM-DB sync of Slice 7 so tests don't need a running Customer Master. Devbox runtime uses Slice 7 (DB-pull from real CM) for `identity_mirror`; runtime source mappings get created via Slice 14 onboarding flow or hand-crafted before Slice 19. Both fakes run as FastAPI apps in docker-compose; every later slice tests against them.

### Shared libraries

Phase 1 services depend on a set of shared libraries. Each lib slice builds the lib to the surface area current and upcoming services need; later slices may extend.

- `TODO` Slice 3: Core primitives. `libs/dis-core` (UUIDv7 helper, trace_id helper, structured logging, error type hierarchy, BqClient stub for Phase 1 — real BqClient in Phase 3) and `libs/dis-canonical` (Pydantic models for canonical schemas, generated/aligned with the SQL DDL).
- `TODO` Slice 4: Data plane safety. `libs/dis-rls` (async RLS-aware Postgres session context manager that sets `app.tenant_id`; tests prove queries from one tenant cannot see another), `libs/dis-pii` (deterministic per-tenant HMAC tokenization function and per-tenant key handling; storage backend for the token → ciphertext mapping is deferred until a non-CSV receiver flags PII columns — see `decisions.md` D24; until then, `dis-pii` raises at startup if a source mapping flags a column as PII without a configured backend, so accidental PII landing in canonical fails loudly), `libs/dis-storage` (GCS path scheme, signed URL issuance, GCS object access).
- `TODO` Slice 5: Pipeline mechanics. `libs/dis-mapping` (four-stage mapping engine: rename, normalize, cast, derive; pure functions over `(mapping, raw_row) → canonical_row`) and `libs/dis-validation` (Pandera suite runner, pre-mapping and post-mapping shapes).
- `TODO` Slice 6: Audit. `libs/dis-audit` writes audit events to the Cloud SQL `audit.events` table (fire-and-forget; failures logged, not raised). Audit emission is service-layer, not lib-layer — libs do not emit audit events, services do (Slice 7 onward). BigQuery archival of audit events deferred to Phase 3.

### Identity mirror (so receivers and streaming consumer can FK against it)

- `TODO` Slice 7: Mirror Sync Consumer — DB-pull mode. `services/mirror-sync-consumer/` reads tenant and store records directly from Customer Master's Postgres database (port 5432 locally; Cloud SQL in cloud); upserts into `identity_mirror.tenants` and `identity_mirror.stores`. Runs on-demand for first load and is schedulable for periodic reconciliation. Same code serves local and cloud — no separate local seeder vs cloud sync. The Pub/Sub-driven incremental consumer mode is deferred to a later slice (triggered when Customer Master emits real `identity.changed` events); this slice is the v1.0 production path for both initial bulk load and ongoing reconciliation. Tests bypass this service entirely via Slice 2's fixture seeder. **Open in plan mode:** Mirror Sync writes all tenants/stores to `identity_mirror`, but `identity_mirror` is RLS-protected. Resolve in plan-mode: either set `app.tenant_id` per-row during upsert (works under standard RLS posture) or run Mirror Sync under a distinct role with different RLS posture.

### CSV upload (v1.0)

- `TODO` Slice 8: CSV upload — Phase 1 handler (dis-ui-server endpoint). The DIS UI calls `dis-ui-server` for an upload URL; the `upload_session` handler validates the session via Identity Service, generates a `trace_id`, builds the canonical GCS path via `libs/dis-storage`, returns a 15-minute signed PUT URL, and emits audit. No bronze write, no Pub/Sub publish — Phase 1 ends when the URL is handed back to the caller. Lives in `services/dis-ui-server/` as the `upload_session` handler, not in a separate receiver service (see `decisions.md` D36).
- `TODO` Slice 9: CSV upload — Phase 2 worker (`csv-ingest-worker`). GCS object-finalized notification triggers `services/csv-ingest-worker/`: DuckDB preflight (structure, row count, type sniff), PII tokenization for any flagged columns, bronze metadata write via `libs/dis-rls`, `ingress.ready` publish, audit emission. Idempotency: same SHA-256 + source_payload_id + tenant within 24h returns prior `trace_id`. See `decisions.md` D36 for the receiver-vs-worker split.

### Receivers — API / webhook

- `DEFERRED` `services/receiver-api/`. Bearer-token or API-key authenticated; accepts pushed JSON payloads from tenant systems; same downstream contract as CSV upload (bronze + `ingress.ready`). *Trigger: first tenant requests API/webhook ingestion.*

### Receivers — ERP CSV POST

- `DEFERRED` `services/receiver-csv-erp/`. Per-tenant POST endpoint for ERP-driven CSV batches; per-tenant API key or mTLS auth; identity bound to endpoint config. *Trigger: first tenant requests ERP POST endpoint.*

### Receivers — Reverse-API pull

- `DEFERRED` `services/receiver-reverse-api/`. Cursor-based puller from external APIs; identity bound to endpoint config registered for that pull target. *Trigger: first tenant requests reverse-API pull.*

### Streaming pipeline

- `TODO` Slice 10: Streaming consumer happy path. Reads `ingress.ready`, fetches bronze chunk from GCS, applies a stub mapping, validates with Pandera, writes the canonical hot table plus the event table in a single transaction, emits audit events. FK to `identity_mirror` enforced; RLS enforcement verified.
- `TODO` Slice 11: Quarantine path. Failing rows from the streaming consumer flow to the `quarantine` topic; the drainer service writes them to Cloud SQL `quarantine.*` tables; rows are visible for replay/inspection.
- `TODO` Slice 12: Replay tooling. `tools/replay/` CLI lets an ops operator replay a bronze chunk; the replay gets a new `trace_id` linked to the original as `parent_trace_id`; audit records the chain. The dis-ui-server replay endpoint (UI-driven resubmit) is built in Slice 13 as a thin wrapper over this tooling.

### dis-ui-server + Identity Service real

- `TODO` Slice 13: dis-ui-server foundation + Identity Service real implementation. dis-ui-server FastAPI BFF authenticates users via Customer Master and exposes endpoints the UI calls for upload, mapping CRUD, and audit lookup (reads from `audit.events`). Identity Service real implementation lands alongside: the four methods work against an in-process cache backed by Customer Master with stale-while-error fallback to `identity_mirror`; dis-ui-server consumes it via the same client interface tests use against the Slice 2 fake.
- `TODO` Slice 14: Onboarding. dis-ui-server's onboarding sub-module takes a sample upload and produces a draft mapping (rule-based schema inference + suggestions); operator can review and promote to active; new tenant CSV onboards end-to-end without manual SQL.
- `TODO` Slice 15: dis-ui-server endpoints — group 1. *Placeholder; scope drafted from UI engineer's demand list. Endpoints land here as a coherent feature group (e.g., dashboards, history views, ops surfaces).*
- `TODO` Slice 16: dis-ui-server endpoints — group 2. *Placeholder; scope drafted from UI engineer's demand list.*
- `TODO` Slice 17: dis-ui-server endpoints — group 3. *Placeholder; scope drafted from UI engineer's demand list.*

### Daily compute

- `TODO` Slice 18: Daily compute. Produces `store_sku_signal_history` rows per (store, SKU, as_of_date); updates derived columns on `store_sku_current_position`; ROOS has fresh signals every day.

**Phase 1 exit criterion.** All non-DEFERRED slices DONE. A tenant can upload a CSV via the UI, have it land in canonical, see failures in the quarantine console, and audit events for every pipeline step are queryable from Cloud SQL via dis-ui-server. BigQuery archive is deferred to Phase 3.

---

### DIS UI

- `TODO` Slice 19: DIS UI foundation. `ui/` initialized; auth scaffolding against Customer Master tokens; a hello-world page calls a dis-ui-server endpoint and renders the response. Stack and tool choices made during this slice.
- `TODO` Slice 20: DIS UI core. Operator/tenant can upload a CSV, review the onboarding result, edit the mapping config, inspect the quarantine console, look up audit events, and resubmit failed chunks.

## Phase 2: Integration

Phase 1 slices test against fakes individually. Phase 2 verifies the full system wires together.

- `TODO` Identity flow end-to-end: a tenant added to Customer Master DB appears in `identity_mirror` after the next Mirror Sync DB-pull run; downstream services pick up the new tenant on their next request. Pub/Sub-driven incremental sync is a later test, triggered when Customer Master emits `identity.changed`.
- `TODO` Receiver → streaming consumer end-to-end: CSV uploaded by tenant A cannot be read by tenant B; RLS holds across the pipeline.
- `TODO` Quarantine flow end-to-end: a malformed CSV row reaches the tenant quarantine console; the resubmit button rebuilds the chunk and processes successfully.
- `TODO` Onboarding flow end-to-end: a new tenant uploads a sample, reviews the suggested mapping, promotes to active, and uploads a real CSV that lands in canonical without operator intervention beyond mapping approval.
- `TODO` Audit and quarantine end-to-end: every Phase 1 pipeline step emits audit events to Cloud SQL `audit.events`; quarantined chunks are queryable by tenant via dis-ui-server; trace_id chains a single ingress event from receiver through canonical.
- `TODO` Daily compute end-to-end: synthetic day-window events produce the expected `signal_history` row and `current_position` updates.
- `TODO` Replay end-to-end: an ops engineer replays a bronze chunk and sees the chain (parent_trace_id, new trace_id, audit events) in the dis-ui-server.
- `TODO` Full e2e: every flow above runs simultaneously against a multi-tenant test environment without cross-contamination.

**Phase 2 exit criterion.** Every e2e test in `tests/e2e/` passes. The system handles ingress, processes, surfaces failures, and replays end-to-end.

---

## Phase 3: Production hardening and analytics offload

### Resilience

- `TODO` `pipeline.dlq` auto-drainer. A service or sidecar consumes the `pipeline.dlq` topic and replays messages every 60s when the Cloud SQL health probe reports recovery. Architecture circuit-breaker pattern (decisions.md D27). v1.0 launch operates with manual recovery; auto-drainer activates here.

### Analytics offload to BigQuery

- `TODO` Slice 21: Nightly batch and BigQuery archive. Daily Cloud SQL → BigQuery export populates `canonical_history.*`; `audit_events` from Cloud SQL is archived to BigQuery; Cloud SQL partitions older than the retention window are dropped; dbt freshness/completeness tests pass. *Trigger: ROOS or another consumer needs long-term canonical history, OR Cloud SQL retention pressure justifies offload.*

### Production hardening

- `TODO` Observability dashboards show latency p50/p95/p99, DLQ depth, quarantine rate per tenant, audit emission rate.
- `TODO` Performance tuning: Cloud SQL indexes verified against real query patterns; BigQuery query patterns optimised; no silent N+1 or table scans.
- `TODO` Cost optimisation: committed-use discounts applied where stable; logging retention tuned; actual monthly bill matches projection within 20%.
- `TODO` Cloud SQL HA enabled. *Trigger: first paying tenant SLA mandating 99.99%.*
- `TODO` Cloud SQL read replica live. *Trigger: read CPU sustained above 60%, OR p95 read latency above 200ms.*
- `TODO` Memorystore Redis identity cache. *Trigger: identity resolves above 10k/sec, OR in-process cache hit rate drops below 80%.*

**Phase 3 exit criterion.** Production is observable, performant within SLO, cost is understood. Each migration trigger has either fired and been actioned, or remains explicitly accepted.

---

## Migration triggers (consolidated reference)

Deferred items live in the phases above; this section gathers the triggers for quick scanning. First trigger met wins.

- Higher-throughput streaming runtime (Beam on Dataflow) — *sustained 500+ rows/sec for 7 days, OR consumer scaling above 20 concurrent instances, OR p95 above 10s. See decisions.md D4.*
- Cloud SQL HA — *first paying tenant SLA, OR single-zone outage incident.*
- Cloud SQL read replica — *read CPU sustained above 60%, OR p95 read latency above 200ms.*
- Redis identity cache — *identity resolves above 10k/sec, OR in-process cache hit rate drops below 80%.*
- Historical-learning onboarding — *20+ approved mappings in `config.source_mappings`.*
- LLM-assisted onboarding — *tenant onboarding time-to-active exceeds 1 week consistently.*
- Machine auth migration to Customer Master — *Customer Master scope expands to cover machine credentials.*
- Trace-level dedup at streaming-consumer entry — *`DUPLICATE_NOOP` audit volume sustained above 10% of total. See architecture.md §9.2.*
- BigQuery audit dataset isolation — *audit query load impacts BQ slot budget for canonical_history dbt runs.*

---

## Build target portability

The same code runs against three environments via env-var-driven routing. Operator picks the target; code does not change.

| Target | Used for | Dependencies route to |
|---|---|---|
| `local` | Developer machines, `make run-local`, local tests | docker-compose emulators and fakes |
| `dev` | Shared dev GCP project | Real GCP services in `ithina-dis-dev` |
| `staging` | Pre-production verification | Real GCP services in `ithina-dis-staging` |
| `prod` | Production | Real GCP services in `ithina-dis-prod` |

Switch via `DIS_TARGET=local|dev|staging|prod`. Service code uses standard client libraries; env vars (e.g., `PUBSUB_EMULATOR_HOST`, `STORAGE_EMULATOR_HOST`, `POSTGRES_URL`) route to the right backend. Detail in `local-setup.md` §B.

---

## Slice workflow

Slices are how Claude Code builds DIS. The shape:

1. **Draft the slice in this Claude AI chat** with the operator. Capture: goal, task description, scope boundary, acceptance criteria. Save to `docs/slices/slice-NN-<short-name>.md`. Slice doc stays at goal/task level; implementation specifics emerge in plan mode.
2. **Hand slice doc + execution prompt to Claude Code.** Claude Code reads, enters plan mode (Shift+Tab twice), returns a plan.
3. **Review the plan in this chat.** Operator decides: execute, or revise.
4. **Revise loop.** If plan needs changes: feed corrections back to Claude Code; re-plan; re-review. Repeat until the plan looks right.
5. **Execute.** Operator tells Claude Code to proceed; Claude Code writes code; operator reviews diffs.
6. **Slice exit.** Acceptance criteria met → merge → mark the slice DONE in this doc. Anything learned that affects future slices goes into root or per-service `CLAUDE.md`.

### When to intervene
- Plan looks wrong → correct in the chat, revise the slice doc if needed, re-plan.
- Tests fail in a way that suggests a slice constraint is violated → push back.
- Claude Code proposes scope outside the slice → hold the line. New scope = new slice.
- A CLAUDE.md invariant gets broken → fix the invariant statement first, then re-execute.

### CLAUDE.md hygiene
- Root `CLAUDE.md` under 200 lines.
- Per-service `CLAUDE.md` under 100 lines.
- Per-lib `CLAUDE.md` under 50 lines.
- New invariants discovered during a slice go into the relevant CLAUDE.md before the next slice starts.

### Common pitfalls
- **Over-specifying the slice.** Slice docs name goal and scope. They don't name HTTP status codes, library versions, response field shapes. Those come from plan mode.
- **Letting Claude Code propose architecture.** Plan mode is implementation. If the plan changes architecture, stop and raise in this chat.
- **Skipping plan mode.** Fast short term, expensive over weeks. Plan mode is the leverage point.
- **Not updating CLAUDE.md.** Every slice teaches the system something. Capture it.

---

## Document lifecycle

This doc mutates. When:
- A slice or item completes: change status to DONE.
- A new slice is identified: add it under the right phase.
- A migration trigger fires: change the relevant DEFERRED item to TODO and start it.
- A whole section becomes obsolete: delete it.

When this doc grows past ~300 lines, consider splitting.
