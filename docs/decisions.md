# DIS Design Decisions Register

**Status:** companion to `architecture.md`. This doc carries the indexed register of architecture-level decisions. Architecture prose, modules, data flow, and constraints live in `architecture.md`; the visual diagram lives in `architecture.html`.

**Scope:** decisions that shape the system at the architecture level — choice of managed services, transport patterns, persistence semantics, isolation posture. Implementation-level decisions (which Python library, which Pydantic config) do NOT belong here.

**Numbering.** Sequential; each decision keeps its number forever even if revised or superseded. Category labels in the title are advisory and ungated (`[STORAGE]`, `[INGRESS]`, etc.). Cross-references from other docs use the bare `D1`-`DN` form.

**Revision lifecycle.** Decisions can be revised when the system context warrants; the original decision is preserved with strikethrough or marked "superseded by Dxx" rather than rewritten. Decisions that are still pending are labeled `OPEN`.

**Open-question identifiers.** Major open questions raised in earlier revisions (B1, B2, B3, D1, D2, D5, G1, G3, G4) are referenced by their original IDs throughout DIS docs; they map to the decision register as follows: B1 → D22, D1 → D4, D2 → D4a, D5 → D25, G1 → D24, G3 → D27, G4 → D28. B2 and B3 remain open (see end of register).

---


### D1 GCP managed-first, not self-hosted
**Decision.** Build on GCP managed services (Pub/Sub, Dataflow, Cloud SQL, BigQuery, Cloud Scheduler, container runtime) wherever they fit; write custom code only for the irreducible middle (mapping, RLS-aware sink, receivers, identity).
**Alternatives.** Self-hosted Kafka + Flink + Postgres + ClickHouse on GKE; third-party managed (Confluent, Snowflake, Fivetran).
**Why.** The team's stated goal is "accelerate development, low maintenance". Self-hosted stacks demand ongoing ops (HA, upgrades, on-call) that don't show up in initial estimates. Third-party managed brings vendor sprawl and data-residency concerns Ithina can't yet evaluate. GCP-native means one bill, one IAM model, one observability stack.

### D2 Push model for ingress, not pull
**Decision.** Sources push to Ithina-owned receivers (API, webhook, CSV POST endpoint, manual upload UI). The reverse-API case is the only pull, and even there the response body lands at a receiver.
**Alternatives.** Scheduled polling (Cloud Scheduler hitting tenant systems); CDC-based pull (Datastream off tenant DBs).
**Why.** Latency target is few seconds. Polling cadence cannot meet it without near-continuous polls, which is wasteful. CDC requires tenants to expose their internals, which is operationally and contractually expensive. Push is the natural fit for event-driven retail data and keeps Ithina in control of the ingress surface.

### D3 Pub/Sub as the only message bus
**Decision.** All inter-component asynchronous communication goes through Pub/Sub. No Kafka, no in-process queues, no DB-as-queue patterns.
**Alternatives.** Kafka (if already present in the org); Cloud Tasks; direct service-to-service calls.
**Why.** Pub/Sub is GCP-native, scales transparently to thousands of messages per second, provides at-least-once delivery with optional exactly-once subscriptions, and integrates natively with Dataflow and containerized consumers. Kafka would add a second messaging system to operate. Cloud Tasks lacks fan-out semantics needed for audit and quarantine branching.

### D4 Streaming runtime (D1)
**Decision.** A containerised service is the streaming consumer. The transformation logic is factored as pure functions over `(mapping, raw_row) → canonical_row`, so a future migration to a higher-throughput runtime is a runner swap, not a rewrite.
**Migration trigger.** Sustained 500+ rows/sec for 7 days, OR scaling above 20 concurrent service instances, OR p95 end-to-end above 10 seconds. First trigger wins. Apache Beam on Dataflow is the documented destination at scale.
**Alternatives.** Always-on Dataflow from day one; Cloud Data Fusion (visual ETL); Dataform (SQL-based, batch); per-tenant streaming jobs.
**Why a containerised service today.** Dataflow streaming carries a baseline cost (always-on workers, $150-300/month at low volume) that is real overhead at the current scale, when traffic is bursty and modest. A containerised service scales to zero between bursts, costs near nothing at single-digit RPS, and runs the same Python code. Hand-rolled consumers can be cheaper at low volume.
**Why Dataflow at scale.** Beam's native exactly-once dedup, side-input refresh, bundle-level batching, autoscaling, dead-letter routing, and watermarking become real value at thousands of rows/sec. The engineering time to build, tune, and maintain equivalents on a hand-rolled consumer exceeds the Dataflow bill.
**Why this is not lock-in.** The transformation logic is pure functions in shared libraries (`libs/dis-mapping`, `libs/dis-validation`). The current consumer wraps these in a Pub/Sub subscriber loop; a future Beam pipeline wraps the same functions in DoFns. The migration is a runner swap. Pandera works in both runtimes (D4a).
**Tradeoff acknowledged.** The current consumer lacks Beam's native exactly-once and bundling; it implements simpler versions: at-least-once with idempotent canonical writes, manual batching of ~500 rows per tenant transaction. Acceptable at the current scale; suboptimal at growth.

### D4a Validation library: Pandera, not Great Expectations (D2)
**Decision.** Pandera is the validation library. Used for both pre-mapping (source-shape) and post-mapping (canonical-shape) suites.
**Alternatives.** Great Expectations (GE); hand-rolled rule engine.
**Why Pandera over GE.** Lower latency on the hot path (no Data Docs generation on every run; suites are Python objects, not file-backed). Better fit for Beam DoFns when streaming migrates to Dataflow (Pandera schemas are pure-Python and serializable). Lower ceremony per suite (a Pandera schema is ~20 lines; a GE expectation suite is a JSON file with 5x the boilerplate). The DIS UI quarantine console is built in-house, which makes GE's Data Docs (a major GE selling point) less load-bearing.
**Why not hand-rolled.** A library earns its place when the rule set is large enough that declarative configuration and tenant-readable failure reasons matter more than the dependency cost. Across many tenants with diverse sources, the rule set will be large.
**Storage.** Pandera suites are versioned per `(tenant_id, source_id, version)` and referenced from `config.source_mappings`.

### D5 Bronze first, transform second
**Decision.** The receiver writes the enriched payload to bronze (Postgres + GCS) before publishing to Pub/Sub. The pipeline consumes from bronze, not from the live request.
**Alternatives.** Receiver synchronously calls the pipeline; receiver publishes directly to Pub/Sub without bronze write; in-memory passthrough.
**Why.** Bronze is the audit trail and replay source. Without it, a tenant resubmit or an Ithina-side replay has nothing to re-process. The write-then-publish ordering also means Pub/Sub message loss is recoverable: bronze rows can be re-published by a sweeper job.

### D6 Three-class canonical (hot + events + signals)
**Decision.** Canonical splits into three classes of table:
1. **Hot table** (`store_sku_current_position`): one row per SKU instance, upserted, current state.
2. **Event tables** (`store_sku_sale_events`, `store_sku_change_events`): partitioned by `event_date`, daily partitions, 35-day rolling retention in Cloud SQL (configurable).
3. **Signal history** (`store_sku_signal_history`): append-only daily history of computed derived attributes; one row per SKU per as_of_date. Same 35-day retention default.
**Alternatives.** Single table with `is_current` flag; pure event-sourced model with derived views; hot-only with separate audit log; canonical events in BigQuery only (no Cloud SQL buffer).
**Why this split.** Hot table serves ROOS reads with low latency on a manageable row count. Event tables capture detail for downstream analytics and replay; partitioned by date for cheap eviction. Signal history makes daily derived-attribute compute incremental (yesterday's row + 1 day of events) instead of full-window recomputation, and preserves daily values for backtesting. Each class earns its place by serving a different read pattern at the right cost.
**Why Cloud SQL events buffer with 35-day retention.** Atomic dual-write (hot + events) inside one Cloud SQL transaction is structurally simpler than coordinating Cloud SQL + BQ writes. 35-day retention gives ops a long replay window in familiar SQL without forcing them to BigQuery for recent investigations. At beta scale (~150K events/day), 35 days = ~5M rows in Cloud SQL; manageable. See §4.30.

### D7 Event-time wins, not arrival-time
**Decision.** Hot-table upserts are conditional: a row is overwritten only if the incoming event's `source_event_timestamp` is newer than the stored value. Late-arriving older events are appended to event tables but do not touch the hot table.
**Alternatives.** Last-arrival-wins (simpler); field-level conflict resolution per source.
**Why.** Retail data arrives out of order in the real world (network blips, batched ERP exports, replay events). Arrival-time semantics would let stale data clobber fresh state. Event-time semantics give correctness without requiring strict in-order delivery, which Pub/Sub does not guarantee.

### D8 Column-scoped merge upsert
**Decision.** A single canonical row is the union of fields contributed by multiple sources. Each source declares the canonical columns it owns; an upsert touches only those columns.
**Alternatives.** Row-replace on every upsert; one canonical row per (key, source) tuple.
**Why.** A POS event carries sale-related fields; an ERP event carries inventory-related fields; a planogram update carries placement fields. Row-replace would force every source to know every column, or destroy data from other sources on every write. Per-source rows would push the merge logic to read time, hurting query performance.

### D9 Nightly BQ offload, not live fan-out
**Decision.** History rows are written only to Cloud SQL on the hot path. A nightly batch job (during retail off-hours) copies yesterday's slice to BigQuery and evicts rows older than the configured retention window from Cloud SQL. **The original "3 months" retention has been superseded by D29 (35-day configurable buffer); this decision is retained for the architectural pattern (nightly copy + delayed evict), but the window value is D29's.**
**Alternatives.** Live dual-write from Beam to both Cloud SQL and BigQuery; CDC from Cloud SQL to BigQuery (Datastream); BigQuery as the sole history store.
**Why.** Live dual-write adds latency to the canonical write path (BigQuery streaming inserts have variable latency and cost). The team's analytics tolerance is 24 hours, so nightly is sufficient. The no-ingress window during retail off-hours is a natural batch window. CDC is one more managed service to operate when the simple batch job suffices.

### D10 Identity store on a physically separate database
**Decision.** Tenant and store metadata lives in a separate Postgres instance owned by the admin app. The data platform never connects to it directly.
**Alternatives.** Co-locate identity data in the canonical DB; foreign data wrapper across instances.
**Why.** Physical separation is an organizational requirement (different blast radius, different ownership, different backup cadence). FDW makes the separation a lie at the query level and has unpredictable performance.

### D11 Identity Service in front of Customer Master
**Decision.** All identity reads from the data platform go through a Tenant/Store Identity Service (containerized service with a cache). Direct Customer Master access from data-platform services is forbidden.
**Alternatives.** Each data-platform service calls Customer Master directly; embed identity in JWT claims everywhere; replicate Customer Master into the data-platform DB and read locally.
**Why.** Caching belongs in one place; identity is read on every request and would crush Customer Master otherwise. Centralizing also gives one place to enforce auth, audit identity reads, and publish change events. JWT claims handle the API/webhook channels but not internal/reverse-API channels, so a service is still needed.

### D12 Mirror table + real FK as the cross-DB integrity substitute
**Decision.** A small `identity_mirror` schema in the data-platform Postgres holds `tenants` and `stores`, populated by a consumer subscribed to `identity.changed`. Canonical tables have real Postgres FKs pointing to these mirror tables.
**Alternatives.** Application-layer validation only; trigger-based validation function; deferred constraints; no validation at the DB layer.
**Why.** True cross-DB FK is impossible. Application-layer validation is bypassable by bugs and direct DB writes. The mirror gives real FK semantics with real error messages, real cascade rules, and zero per-write network calls. The cost is a small replication lag (seconds), handled by retry-with-backoff at the sink and a fallback to quarantine if the mirror never catches up.

### D13 Receiver permissive, pipeline strict
**Decision.** Receivers accept anything that is structurally valid (auth passes, payload parseable). Semantic validation happens in the pipeline; failures go to quarantine, not back to the tenant.
**Alternatives.** Strict receiver (reject on first semantic issue); strict pipeline that halts on failure.
**Why.** Strict receivers force tenants to debug synchronously, which is hostile to ERP systems that cannot easily handle 4xx responses. Permissive receivers + downstream quarantine gives tenants asynchronous, batched feedback through a UI, which matches how their ops teams actually work. The pipeline is strict because it owns the canonical contract.

### D14 Audit by trace_id, end to end
**Decision.** Every ingress chunk is assigned a `trace_id` at the receiver. Every stage in the pipeline emits a structured audit row to BigQuery keyed by `trace_id`. Debugging is a single SQL query.
**Alternatives.** Log-based audit (Cloud Logging only); per-stage tables; sampled tracing.
**Why.** Logs are unstructured and hard to query by row. Per-stage tables fragment the trail. Sampling loses the row a tenant is asking about. A single audit_events table keyed by trace_id is queryable, joinable, and cheap in BigQuery.

### D15 Mapping config in Postgres, not Firestore
**Decision.** Per-(tenant, source) mapping rules live in a `config.source_mappings` table in the data-platform Postgres, versioned, edited via the admin app.
**Alternatives.** Firestore; YAML files in GCS; hardcoded per-source modules in Beam.
**Why.** The admin app already lives in Postgres; same data shape, same tooling, same auth, same backups. Firestore would be a second datastore for the same kind of data. YAML in GCS loses transactional editing and FK integrity to tenant/source. Hardcoded modules turn new-source onboarding into a deploy.

### D16 DuckDB optional; Pandera committed
**Decision.** DuckDB is recommended but not required. Pandera is the committed validation engine (§4.4a, §4.21).
**Why DuckDB remains optional.** DuckDB pre-flight in receivers and ops query panel in dis-ui-server are both achievable with custom CSV parsing and ad-hoc BQ queries respectively. DuckDB makes them cheaper and faster; not adopting it adds engineering effort, not correctness risk.
**Why Pandera is no longer optional.** See §4.4a. The reasoning that made it the marginal favorite in v0 became load-bearing once latency targets (§2.4) and Cloud Run runtime (§4.4) were pinned. v1.0 ships with Pandera.

### D17 Assisted source onboarding, with staged rollout
**Decision.** Onboarding a new source is hybrid: system proposes the mapping based on sample data, a human operator reviews and approves. New mappings start in a `staged` state and are validated in shadow mode against live traffic before being promoted to `active`.
**Alternatives.** Fully manual onboarding (operator writes every mapping from scratch); fully automated (LLM generates and auto-activates mappings); per-source-type hardcoded mappings.
**Why.** Fully manual is slow and the bottleneck scales with tenant growth. Fully automated is risky: a wrong mapping silently corrupts canonical data, and the cost of catching it later is high. Hardcoded per-source-type mappings break the moment a tenant runs a customized version of a standard POS/ERP, which is the norm. The assisted approach gets ~60-75% of column matches right on first try with rule-based heuristics (more with historical learning), reducing operator effort to reviewing and correcting, not authoring. Staged rollout means a bad mapping cannot harm production canonical data; it writes only to a staging schema until promoted.

### D18 Validation split into pre-mapping and post-mapping
**Decision.** Validation runs in two stages, not one. A pre-mapping stage validates the source-shape (does the incoming chunk look like what we expect from this source?). A post-mapping stage validates the canonical-shape (does the mapped row satisfy canonical invariants?). Both stages use Pandera but operate on different vocabularies and produce different failure types.
**Alternatives.** Single post-mapping validation stage (simpler, but conflates two failure modes); single pre-mapping validation stage only (misses canonical-shape bugs and business invariant violations).
**Why.** Source-shape failures (missing column, wrong type, truncated upload) and canonical-shape failures (negative inventory, event_ts in the future, FK to unknown store) have different root causes, different remedies, and different audiences. Catching source-shape problems before mapping means the failure reason is intelligible to the tenant ("expected column `item_code`, got `itemcd`") rather than a misleading downstream symptom ("`sku_id` is null"). It also avoids spending compute on mapping a chunk that was malformed at the source. Two stages keep each suite small, focused, and tenant-readable. The cost is two suite-author tasks during onboarding instead of one, mitigated by the onboarding service generating both drafts from the sample.

### D19 Neutral compute platform language
**Decision.** The architecture is described in terms of *containerized services* (long-running) and *containerized jobs* (one-shot), not a specific compute platform. Deployment platform (managed serverless, self-managed orchestration, or anything else) is an implementation choice left to the operator.
**Alternatives.** Specify a single compute platform (Cloud Run, GKE, etc.) throughout the design.
**Why.** The architecture's correctness does not depend on the compute platform. Pinning the design to one platform creates noise when the team's actual platform choice differs, and forces re-explanation of every container's runtime when the team migrates platforms. Neutral language keeps the document portable across deployment choices.

### D20 Data normalization as a distinct sub-stage, declarative with escape hatch
**Decision.** Normalization is a distinct sub-stage in the mapping step, sitting between rename and cast: `rename -> normalize -> cast -> derive`. It handles format variance (date formats, decimal separators, timezones, units, enums, boolean encodings, null encodings, casing, whitespace) per source, driven by a declarative `transforms` field in the mapping config. A bounded vocabulary of normalizers (`parse_date`, `parse_decimal`, `parse_boolean`, `lookup_enum`, `normalize_currency`, `trim_and_collapse_whitespace`, etc.) covers the common cases. For source-specific quirks the declarative vocabulary can't express, the mapping can reference a named custom transform function deployed in the Beam pipeline (the escape hatch).
**Alternatives.** Hand-wave normalization inside "apply mapping" (current implicit state, gap in the design); fully declarative DSL with no escape hatch (covers ~80% of cases, breaks on the rest); fully code-based per-source transforms (no declarative path, every new source needs a deploy).
**Why.** Format variance is the norm, not the exception: tenants run software from different regions, vendors, and decades. Without an explicit normalization stage, format failures surface late (cast errors, business-invariant violations) with misleading reasons. A bounded declarative vocabulary handles the bulk of cases through config edits, keeping onboarding throughput high. The escape hatch handles the long tail without forcing every quirk into config syntax. Placement before cast is mandatory: `cast("23,45", float)` fails on European decimals, `cast(normalize("23,45"), float)` succeeds. Normalization failures route to quarantine as a distinct failure type ("normalization failed: column X, value Y, expected format Z"), separate from source-shape and canonical-shape failures, giving tenants a clear, narrow reason to act on.

### D21 Validation engine: Pandera
**Decision.** Pandera is the validation engine. Reasons in D4a. Wherever the architecture document carries "GE/Pandera" wording, treat as Pandera; the historical record is retained for context only.

### D22 Mapping version pinning on canonical rows
**Decision.** Every mapping-produced canonical row carries a `mapping_version_id BIGINT NOT NULL` column: the hot table (`store_sku_current_position`) and both event tables (`store_sku_sale_events`, `store_sku_change_events`). The streaming consumer stamps this column with the mapping version that produced the row.
**Scope: signal_history excluded by design.** `store_sku_signal_history` is daily-compute output derived from already-canonical rows, not produced by the mapping engine (D31, D32); it carries no `mapping_version_id`, its provenance is `trace_id` plus `compute_metadata`. The "hot and history" phrasing referred to the event (history-tier) tables, not signal_history.
**Replay default.** Replay uses the mapping version recorded on the original row, not current active. Ops can override to "current active" with an explicit flag, and the audit trail records both versions.
**Alternatives considered.** No version on canonical rows (which would silently produce audit drift). Mapping version stored only in audit (cheaper to add but reconstruction requires audit join on every dispute, and audit can be incomplete after retention expires).
**Why.** Audit and replay are load-bearing in a multi-tenant ETL platform. Without mapping version on the canonical row, "why does this row look wrong" cannot be answered cleanly (source bug vs mapping bug vs business rule). Replay against current mapping produces different canonical results than the original, undetectable post-hoc. Adding one column now costs one Alembic migration; adding it after history accumulates means rewriting analytics queries, dbt models, replay tooling, and re-explaining historical canonical values per tenant.
**Downstream contract impact.** `quarantine` Pub/Sub schema carries `mapping_version_id` for post-mapping failures. `pipeline.dlq` carries `mapping_version_ids` for batch recovery (recovery pins to original versions). `mapping.changed` carries `mapping_version_id` as primary identifier. Audit events carry `mapping_version_id` on every post-mapping stage.

### D23 Alembic for Postgres schema migrations; dbt for BigQuery analytics
**Decision.** Alembic is the migration tool for every Postgres schema in DIS: canonical, config, bronze, identity_mirror, quarantine, staging. dbt is scoped to BigQuery: `canonical_history.*` models built from the nightly batch slice, and data tests via `dbt-expectations` on freshness, completeness, and referential integrity in BigQuery.
**Why Alembic for Postgres.** Battle-tested for Postgres DDL including the features DIS uses (enum types, CHECK constraints, partial indexes, triggers, RLS policies). Migrations are reversible by design (every migration has `upgrade()` and `downgrade()`). Python aligns with the rest of the DIS stack (FastAPI services, Pandera, codegen). Same tool used by Customer Master; consistent within Sevyn8.
**Why dbt for BigQuery only.** dbt is built for analytics SQL. BigQuery models, derived tables, data tests are dbt's strengths. Alembic does not speak BigQuery natively. Clean separation: each tool in its area of strength.
**Alternatives considered.** dbt for both (rejected: poor fit for Postgres operational features including RLS and triggers, forward-only, no rollback). Alembic for both (rejected: Alembic doesn't speak BigQuery). Flyway / Liquibase (rejected: JVM dependency, off-stack). Raw SQL migrations (rejected: no version tracking, no rollback).
**New canonical column flow.** (1) Alembic migration adds the column with default. (2) Backfill from history in a separate Alembic migration or one-off script. (3) Per-tenant mapping configs updated to populate the new column. (4) `mapping.changed` published; streaming consumer side-input refresh picks up the change. (5) Corresponding dbt model in BigQuery `canonical_history.*` is updated to project the new column.

### D24 PII tokenization at the receiver, not the pipeline (G1)
**Decision.** All PII fields (phone, email, loyalty_id, PAN, Aadhaar, and tenant-policy fields) are tokenized via deterministic HMAC with per-tenant keys at the receiver, before any persistence. Bronze and canonical never carry raw PII.
**Alternatives.** Tokenize in the pipeline (after bronze write); tokenize at query time via column-level encryption; store raw PII with row-level access control.
**Why at the receiver.** Bronze is the audit/replay source; if raw PII lands in bronze, every audit query and replay carries the leak risk. Right-to-erasure (DPDPA, GDPR) becomes a key-vault delete, not a multi-table scrub. Per-tenant key prevents cross-tenant join-inference attacks.
**Why deterministic HMAC.** Deterministic so joins on tokenized fields still work (e.g., "how many times has this customer-token visited?"). HMAC because it is keyed (per-tenant), one-way, and has standard library support.
**Key rotation.** Token vault carries a key version. Rotation produces a new token namespace; old tokens remain joinable within their version. Migration to new tokens is a per-tenant batch operation.

### D25 Customer Master as external dependency (D5)
**Decision.** Customer Master (Sevyn8's Auth0-integrated identity, auth, and RBAC system) is the single source of truth for user identity and authorization. DIS does not maintain user records. DIS UI accepts Customer Master tokens; dis-ui-server validates them.
**Alternatives.** DIS maintains its own user table; DIS uses Auth0 directly.
**Why.** Customer Master is reused across Sevyn8 products. Duplicating user records in DIS creates synchronization burden and policy drift. Auth0-direct would skip the RBAC layer Customer Master provides and force DIS to reimplement role policies.
**What is still open.** Token format and verification semantics (likely JWT with JWKS) and the RBAC claim vocabulary DIS expects from Customer Master are the remaining contracts to pin in Phase 0. Frontend DIS UI integration with Customer Master is delivered.

### D26 dis-ui-server as backend-for-frontend (BFF) for DIS UI
**Decision.** A single containerized service, `dis-ui-server`, is the only backend the DIS UI calls. Per-sub-module handlers inside (auth, sample upload, onboarding review, mapping CRUD, quarantine console, audit lookup, DuckDB query panel). Onboarding work (schema inference, mapping suggestion, validation draft, shadow rollout) lives in-process as a sub-module of dis-ui-server, not as a separate service.
**Alternatives.** Per-domain APIs (one service per UI surface); growing HTTP APIs on existing data-plane services (identity-service, quarantine-drainer, etc.); separate onboarding-service.
**Why one BFF.** One Customer Master integration point. One URL the UI calls. Per-domain APIs multiply auth integrations and deploy units for no v0 benefit. Growing HTTP on data-plane services couples them to UI lifecycle and CM auth.
**Why onboarding in-process.** dis-ui-server is the only caller of onboarding work. CPU profile of sample inference does not warrant process isolation. If onboarding work later blocks BFF latency, the sub-module structure (inference/, suggestion/, validation_draft/, shadow/) is designed for clean extraction.
**What dis-ui-server never does.** Never writes to canonical tables. Never handles Pub/Sub messages on the ingress/quarantine path. Reads from Cloud SQL read replica + config + quarantine + BQ audit. Writes only to `config.source_mappings`.

### D27 Streaming consumer backpressure: circuit breaker + DLQ (G3)
**Decision.** The streaming consumer probes Cloud SQL health (`SELECT 1`, 100ms timeout) before each batch commit. On unhealthy state, batches divert to `pipeline.dlq` topic. Receivers monitor DLQ depth; when threshold crosses, receivers return 503 + `Retry-After` to back off upstream producers.
**Alternatives.** Block-and-retry inside the consumer (risks queue depth blow-up); drop and lose (unacceptable); manual circuit break (slow operator response).
**Why.** Automatic backpressure that propagates upstream without losing data. DLQ is recoverable: when Cloud SQL health restores, a recovery process drains DLQ entries with graduated retry to avoid thundering herd. See §15 (B3) for performance isolation; this is the infrastructure-failure complement.

### D28 Identity Service stale-while-error fallback (G4)
**Decision.** Identity Service serves cache hits up to 5 minutes stale on Customer Master errors. Streaming consumer `validate()` calls fall back to direct `identity_mirror` read when Identity Service circuit is open. Resolve methods (`resolve_from_token`, etc.) cannot fall back (lookup requires Customer Master); they return errors that callers handle as 503.
**Why.** Customer Master is a hard dependency on the hot path. A 5-minute stale window keeps the platform writable during transient Customer Master outages. Acknowledged tradeoff: a tenant deactivated during the stale window may write data for up to 5 minutes after deactivation; downstream RLS still scopes the data, so isolation is not broken.

### D29 BigQuery as long-term archive; Cloud SQL holds 35-day buffer
**Decision.** BigQuery is the permanent archive for canonical history. Cloud SQL holds a 35-day rolling buffer of events and signal history (configurable). Daily Cloud SQL → BigQuery export runs from day 1; partitions are dropped from Cloud SQL only after the retention window elapses.
**Alternatives considered.** Cloud SQL holds 3 months (original position); Cloud SQL holds 24h buffer with same-day BQ export and partition drop (interim posture); direct-to-BQ via Pub/Sub with no Cloud SQL events.
**Why.** At v1.0 beta scale (~150K events/day across 5 tenants × ~25 stores), Cloud SQL handles ~5M event rows comfortably with appropriate partitioning. A 24-hour buffer would be conservative; designed for 100M events/day worst case. 35 days gives ops a useful replay window in SQL without crossing to BQ; ROOS and dis-ui-server can read recent history from Cloud SQL.
**Why the retention is configurable.** Different deployments and scale points warrant different windows. Beta runs at 35 days; production at scale may reduce to 7-14 days; stress test at 24 hours. The eviction job reads the retention parameter; no schema change required.
**Cadence.** Daily eviction job runs every day. From day 1: copies yesterday's partition to BigQuery (idempotent WRITE_TRUNCATE). From day N+retention: drops partitions older than retention.
**Replay window.** 35 days in Cloud SQL. Beyond that, replay reads from BigQuery; the streaming consumer reprocesses BQ-sourced events through the pipeline.
**Schema-side implication.** None. The canonical event tables already partition by event_date. Only the eviction job's behavior changes.

### D30 Atomic dual-write to Cloud SQL (hot + events)
**Decision.** The streaming consumer writes both the hot table upsert AND the matching event-table insert in a single Cloud SQL transaction. RLS context (`SET LOCAL app.tenant_id`) covers both writes. On rollback, neither side lands.
**Alternatives.** Two-phase commit across Cloud SQL + BQ; eventual-consistency dual-write with reconciliation; events-only with current state derived; current-state-only with events derived from change log.
**Why.** One transaction is the structurally simplest correctness model. Either-or-neither semantics avoid the partial-write problem entirely. Pub/Sub at-least-once delivery is handled by event-table dedup semantics, not by transactional idempotency; see D33. The event-table write fits inside the same per-tenant batched canonical commit at no meaningful latency cost.
**Tradeoff acknowledged.** The hot-table write path is now coupled to the event-table's availability. If the event-table partition has lock contention or autovacuum stall, the hot write also stalls. Mitigated by partitioning events by date (no global hot partition) and per-tenant transaction batching.

### D31 Daily compute job: Postgres-local, incremental
**Decision.** Derived attributes (`velocity_7day`, `stock_age_days`, `unit_cost_trend_30day`, etc.) are computed daily by a scheduled job that runs in Cloud SQL Postgres, not in BigQuery. The job reads:
1. **Yesterday's signal row** from `canonical.store_sku_signal_history` (the most recent as_of_date prior to today).
2. **Today's events** from `canonical.store_sku_sale_events` and `canonical.store_sku_change_events` (within the Cloud SQL retention window).

And produces today's signal row, then updates `canonical.store_sku_current_position` with the latest derived values.
**Alternatives.** BigQuery-side full-window recomputation daily; streaming compute on Pub/Sub; pre-aggregate materialized views.
**Why Postgres-local.** Avoids dependency on BQ for the critical path of `store_sku_current_position` updates. Incremental compute makes the per-day workload bounded (1 day of events, not 30). Latency is predictable: per-tenant compute on Cloud SQL completes in minutes; full daily cycle in 1-2 hours within retail off-hours.
**Why incremental.** Full-window recomputation against 30 days of events for 100M SKUs is expensive. With signal history preserved, yesterday's value + 1 day of new events produces today's value. Compute scales with the daily delta, not the window size.
**Bootstrap and recovery.** On day 1, or after a missed compute day, the job runs a slow path: read the full window from BigQuery and compute from scratch. Detection: missing yesterday's signal row for any SKU. Recovery: documented runbook; manual trigger.
**Output.** INSERT into `store_sku_signal_history`; UPDATE `store_sku_current_position`. Both atomic per-tenant. Audit event per SKU updated.

### D32 store_sku_signal_history as append-only canonical artifact
**Decision.** A canonical table `canonical.store_sku_signal_history` preserves daily-computed derived attributes per SKU per `as_of_date`. Append-only; never updated. Partitioned by `as_of_date`; held in Cloud SQL within the configured retention window; archived in full to BigQuery via the daily export.
**Alternatives.** Recompute on demand; store only current values on `store_sku_current_position` (without history); store in BigQuery only.
**Why.** Daily history of derived attributes has analytical value beyond today's snapshot. ROOS can backtest predictions ("velocity_7day from a week ago predicted X; today's reality is Y"). Compute jobs can read yesterday's value cheaply. Storing in Cloud SQL within the retention window keeps the daily compute Postgres-local. BigQuery archive keeps full history for long-term analytics.
**Why typed columns per signal (not JSONB).** Signals are well-defined per row; analytics over time-series read specific columns by name. JSONB would force extract-by-key on every read for no flexibility benefit. New signals are added as new columns via Alembic migration.

### D33 Event-table dedup policy: append-only with read-time latest-wins
**Decision.** Event tables (`canonical.store_sku_sale_events`, `canonical.store_sku_change_events`) are strictly append-only with no UNIQUE constraint. When the same underlying source event arrives multiple times (correction, retry), each arrival is written as a separate row in the event table. Latest-wins is applied at **read time**, not write time.

**The dedup key for "same source event":** `(tenant_id, store_id, source_id, source_event_id)`. Each source-at-a-store is its own numbering namespace. This handles:
- POS systems that number transactions per-store (each store's POS starts from 1).
- ERP systems that issue globally unique IDs (the dedup key is still correct; uniqueness is just broader than necessary).
- Multiple sources per store (POS + ERP both report sales): each source dedupes independently.

**Hot table follows event-time-wins.** The `store_sku_current_position` hot table reflects the latest correction via event-time-wins UPSERT. The hot tier answers "what is true now"; event tables answer "what did we ever hear".

**Audit emission on duplicates.** When an event-table INSERT lands on an existing dedup key, the audit emission records:
- `outcome = DUPLICATE_NOOP` if the new event's canonical payload is byte-identical to the prior latest event (typical retry from Pub/Sub redelivery or streaming-consumer reprocess).
- `outcome = DUPLICATE_OVERWRITTEN` if the new event's canonical payload differs (correction from the source).
- `prior_trace_id` records the trace_id of the prior latest event for traceability.

Ops can answer "what's the duplicate rate per tenant?" by querying audit; no DB scan over event tables needed.

**Alternatives considered.**
- **DB-level dedup with UNIQUE constraint and ON CONFLICT DO UPDATE.** Simpler queries (event table contains one row per source event). Rejected because it loses the correction history: if POS sends $100, then $95, only $95 survives in the event table. Audit alone doesn't preserve enough to reconstruct what was originally claimed.
- **Application-level dedup with explicit superseding link.** Each correction row carries `superseded_by_trace_id` pointing to the latest. Adds a write-time read and a maintenance burden (updating the link when a newer correction arrives). Rejected as over-engineering for v1.0; latest-wins via `event_ts` + `received_ts` is enough.

**Read-time mechanism.** Queries and dbt views over event tables apply:
```sql
ROW_NUMBER() OVER (
  PARTITION BY tenant_id, store_id, source_id, source_event_id
  ORDER BY event_ts DESC, received_ts DESC
) = 1
```
to filter to the current truth. dbt models in BigQuery `canonical_history.*` expose a `latest_event` view over the raw events so downstream consumers don't have to rewrite the window function.

**Tradeoff acknowledged.** Slightly larger event-table storage (every correction is preserved). At v1.0 beta scale (~150K events/day, expected correction rate <1%) this is negligible (~1500 additional rows/day). Reports and dashboards over event tables must filter to latest by default; the "show me all corrections" query is the unusual one.

**Forward note.** Trace-level dedup at streaming-consumer entry (check audit for prior `CANONICAL_WRITTEN` on the same `trace_id` before reprocessing) is a future compute-saving optimisation, not correctness-critical. See `architecture.md` §9.2.

**Schema gap (see D38, RESOLVED).** The dedup key named above (`source_id`, `source_event_id`) did not map to columns in the applied canonical schema when this entry was written. D38 resolved it (Slice 10 plan mode): migration `0003_canonical_dedup_event_time` (M-D38/D64) added both columns to both event tables; the read-time window's live ORDER BY is `source_sale_timestamp`/`source_event_timestamp DESC, last_updated_at DESC, id DESC`.


---

### D34 Audit events to Cloud SQL `audit.events` during Phase 1; BigQuery archive deferred to Phase 3

**Decision.** Audit events are written to a Cloud SQL `audit.events` table during Phase 1. BigQuery `audit_events` remains the long-term archive (per D29's spirit) but its ingestion is deferred to Phase 3 alongside the rest of the nightly batch + BigQuery work.

**Why.**
- BigQuery streaming ingest requires a live cloud project. v1.0 launch infrastructure (Terraform, `ithina-dis-dev`, `ithina-dis-staging`, `ithina-dis-prod`) is deferred to a later trigger. Routing audit through Cloud SQL for Phase 1 lets the audit-lookup feature (dis-ui-server) ship without waiting on cloud setup.
- Cloud SQL is the same datastore everything else writes to in Phase 1, so the audit emitter doesn't need a separate transport during initial development.
- Beta-scale audit volume (10 + F events per ingress event, ~150K events/day) sits comfortably in Cloud SQL with daily partitioning.

**Architectural intent unchanged.** BigQuery `audit_events` is still the long-term home (decisions D7 and D29 hold). Phase 3 adds the Cloud SQL → BigQuery archive job for audit, alongside the canonical_history archive (build-guide.md Slice 21). After that, Cloud SQL `audit.events` becomes a short-term rolling buffer (35-day retention matching event tables).

**Implications.**
- New Postgres `audit` schema; new `audit.events` table; DDL at `schemas/postgres/audit/events.sql`. Mirrors the column shape of `schemas/bigquery/audit_events.sql`.
- `libs/dis-audit` Phase 1 writer targets Cloud SQL. Phase 3 adds the BigQuery archive path; the writer interface stays stable.
- dis-ui-server's audit lookup (build-guide Slice 13) reads from Cloud SQL.
- `libs/dis-core` BqClient is a stub during Phase 1; real implementation lands with Phase 3.

**Alternatives considered.**
- **BigQuery from day one with a real cloud project provisioned in Phase 0.** Rejected: cloud setup is deferred precisely because no slice yet needs it; advancing it just to support audit is the tail wagging the dog.
- **Cloud Logging only.** Rejected: dis-ui-server needs SQL-queryable audit for the tenant-facing audit lookup feature. Cloud Logging without a SQL home blocks Slice 13.

---

### D35 Mirror Sync Consumer ships in two modes; DB-pull is the v1.0 launch mode; Pub/Sub consumer is deferred

**Decision.** The `mirror-sync-consumer` service ships with two operational modes:
1. **DB-pull mode** (v1.0 launch): reads tenant and store records directly from Customer Master's Postgres database (port 5432 locally; Cloud SQL in cloud); upserts into `identity_mirror.tenants` and `identity_mirror.stores`. On-demand and schedulable.
2. **Pub/Sub consumer mode** (deferred): subscribes to `identity.changed` from Customer Master; applies upserts the same way. Activates once Customer Master emits these events.

Both modes call the same upsert logic in `sync/`. Different entry points; same write path.

**Why.**
- Customer Master does not currently emit `identity.changed`. The Pub/Sub design (D2, D11) is the architectural target, but waiting for CM's emit work would block every DIS slice that needs populated `identity_mirror` (receivers, streaming consumer, dis-ui-server).
- DB-pull works against the same Customer Master DB schema the eventual Pub/Sub events would carry. It's not a workaround for local dev only: same code runs against CM's Cloud SQL in production.
- Reconciliation use case persists. Even after Pub/Sub goes live, a periodic DB-pull serves as cheap reconciliation (catch missed events, recover from outages). DB-pull stays in v1.0; doesn't retire when Pub/Sub activates.

**Architectural intent unchanged.** D2 (Identity Service mediates Customer Master) and D11 (mirror via `identity.changed`) remain the canonical architecture. DB-pull is an *additional* mode, not a replacement.

**Implications.**
- `services/mirror-sync-consumer/` carries both modes: `pull/` subdirectory for DB-pull; `consumer/` for Pub/Sub.
- Build-guide.md Slice 7 ships DB-pull mode. Pub/Sub mode is a later slice, triggered when Customer Master emits.
- Operator runs DB-pull on-demand at first; can schedule via Cloud Scheduler or a CronJob later.
- Tests bypass this service entirely via Slice 2's fixture seeder (which writes to `identity_mirror` directly).

**Alternatives considered.**
- **Pre-seed identity_mirror with a hand-written SQL script for local; build a separate Cloud SQL sync for cloud.** Rejected: two mechanisms for the same job. The DB-pull tool serves local and cloud identically.
- **Block all dependent slices until Customer Master emits `identity.changed`.** Rejected: cross-team blocking. CM's emit work is on its own timeline; DIS development cannot pause that long.
- **Direct Postgres FK across instances.** Rejected upfront (D11): physically impossible.

---

### D36 CSV upload — Phase 1 is a dis-ui-server endpoint, not a separate receiver service; Phase 2 ships as `csv-ingest-worker`

**Decision.** The CSV upload flow is split into two operational halves:
1. **Phase 1 (synchronous, UI-driven).** Lives as an endpoint inside `dis-ui-server` (e.g. `POST /v1/upload-sessions`). Validates the Customer Master session, generates `trace_id`, builds the canonical GCS path via `libs/dis-storage`, returns a short-lived signed PUT URL, emits audit.
2. **Phase 2 (asynchronous, GCS-event-driven).** Lives as a standalone worker service `services/csv-ingest-worker/`. Triggered by GCS object-finalized notifications. Runs DuckDB preflight, PII tokenization, bronze metadata write, `ingress.ready` publish, audit emission, idempotency.

**Store-keying refactor recorded separately.** The composite `(tenant_id, store_id)` store-FK refactor that rode in on this decision's commit (`84b67eb`) is an independent decision; it is recorded as D39, not here.

**Why.**
- The DIS UI is the only initiator of CSV upload Phase 1. Having a separate `receiver-csv-upload` service for this means the browser talks to two backends (dis-ui-server for everything else + receiver for upload start). That defeats the purpose of having a BFF (D26).
- Phase 1 is small: auth + trace_id + signed-URL issuance. It doesn't merit a separate deployable; folding it into dis-ui-server as an endpoint is the right size.
- Phase 2 is genuinely different: long-running, large payloads, event-triggered, retries on failure, scales with data volume rather than UI concurrency. It belongs on its own scaling path as a worker, not a request-receiving service. Renaming it `csv-ingest-worker` reflects its actual nature (queue consumer, not HTTP receiver).

**Scope of this decision.**
- Applies only to CSV-upload because the UI itself is the data source.
- Other receivers stay as their own services: API/webhook, ERP CSV POST, reverse-API pull. None of these are UI-initiated; each has its own auth profile, trigger, and scaling shape.

**Implications.**
- `services/receiver-csv-upload/` is renamed to `services/csv-ingest-worker/`; its scope shrinks to Phase 2 only.
- `services/dis-ui-server/` gains an `upload_session` handler (a new sub-module). Build-guide Slice 8 lands the handler in dis-ui-server, not in a receiver service.
- The frontend talks to one backend (dis-ui-server) for all UI flows including starting a CSV upload.
- Identity Service `resolve_from_upload(upload_id)` is still used; called by the `csv-ingest-worker` in Phase 2 when the GCS notification fires (the upload session ID is encoded in the GCS object path).

**Alternatives considered.**
- **Keep `receiver-csv-upload` as a separate service for Phase 1.** Rejected: forces the UI to know two backend URLs and duplicates Customer Master auth integration. The "per-channel receiver" pattern is correct when the channel has its own auth and trigger profile; CSV-upload-from-UI is just dis-ui-server's data-ingest counterpart, not a separate channel.
- **Merge Phase 2 into dis-ui-server as well.** Rejected: Phase 2 is async, event-triggered, and CPU-heavy (DuckDB preflight on multi-MB CSVs). Coupling its scaling and process model to a UI BFF is wrong.

---

### D37 External identity IDs vs internal UUID keys: translation location `RESOLVED`

**Status.** `RESOLVED` (during the Slice 9a identity-correction work). Resolution: **candidate 3**, the Identity Service owns the translation. Every `resolve_*` method returns the **internal UUID** for `tenant_id`/`store_id` (and carries the authoritative external codes alongside, per D55). The single point of external-to-internal translation is the Identity Service, consumed once by dis-ui-server at CSV-upload Phase 1; from there the internal UUID propagates on `csv.received` (D54) and `ingress.ready`, so no downstream DIS consumer resolves identity from an external identifier. The invented `t_*`/`s_*` identity form is removed from the DIS Pub/Sub contracts (D52). Candidate 2 (a reversible encoding) is rejected on sizing: a ~62-bit external string cannot encode a 128-bit UUID. Candidate 1 (an `external_id` column the worker looks up) is not needed for translation, since the Identity Service returns the UUID directly; the mirror still gains the authoritative external codes for readability (D55), not as a translation bridge.

Original `OPEN` text retained below for the record. The deadline noted then (the first receiver or consumer that must resolve identity from an external identifier) was reached at CSV-upload Phase 2 design; it is settled here rather than at the worker, because the translation was lifted to Phase 1 / the Identity Service.

**Status (original, OPEN).** This entry records an open decision; it does **not** resolve it. Raised during Slice 2 (see the Slice 2 plan §2 / R1). **Deadline re-pointed (Slice 7):** the original "before Slice 7" deadline assumed Slice 7 needed the external↔internal translation. It does not — Mirror Sync (DB-pull) replicates Customer Master's own UUID-keyed columns and needs no external-id resolution for FK integrity (the mirror's keys are the UUIDs; CM's external ids, `display_code`/`store_code`, are not replicated and not required). **New hard deadline: the first receiver or consumer that must resolve identity from an external identifier.** D37 stays OPEN; it is not Slice 7's to settle.

**The gap.** The frozen identity-service OpenAPI and the `identity.changed` Pub/Sub schema expose tenants and stores as external string identifiers — `^t_[a-z0-9]{12}$` / `^s_[a-z0-9]{12}$`. The DIS schema (Slice 1) keys `identity_mirror.tenants`, `identity_mirror.stores`, and all `canonical.*` / `config.source_mappings.tenant_id` by 128-bit `UUID` (UUIDv7, "mirrors `platform_db.core.*.id`"). A 12-char base36 string (~62 bits) cannot encode a 128-bit UUID, so these are two distinct identifier spaces. No column, encoding, or layer maps one to the other anywhere in the schema, the contracts, or this register (D1–D36).

**Interim (Slice 2, not the resolution).** Slice 2's test fixture set (`dis_testing.fixtures`) pins a deterministic external↔UUID pairing as a **test-only bridge**, so tests can resolve identity (external ids) and then read the seeded UUID-keyed rows. This bridge is test infrastructure; it is explicitly **not** the production mechanism and must not become it.

**Candidate resolutions (no choice made here).**
1. Add an `external_id` column (`t_*` / `s_*`) to `identity_mirror.tenants` / `identity_mirror.stores`, indexed, populated by the mirror sync.
2. Define a deterministic, reversible encoding between the internal UUID and the external `t_*` / `s_*` form.
3. A translation layer (identity-service and/or mirror-sync owns the external↔internal map).

**Why it must be settled by Slice 7.** Slice 7 (Mirror Sync, DB-pull) writes *real* Customer Master records into the UUID-keyed `identity_mirror`. Real records carry both representations and there is no fixture bridge in production — Slice 7 needs the actual translation to land rows whose external ids match what receivers and the streaming consumer resolve. The fixture bridge cannot carry Slice 7.

---

### D38 Event-table dedup key names columns absent from the applied schema — `RESOLVED` (Slice 10 plan mode; migration 0003)

**Status.** `RESOLVED`. Surfaced during Slice 3 (dis-canonical models, by live-schema introspection of `ithina_dis_db`); resolved in Slice 10 plan mode as candidate resolution 1 (migration), landed by `alembic/versions/0003_canonical_dedup_event_time.py` (the M-D38/D64 prerequisite gate) before any Slice 10 service code. The original gap record is preserved below; the resolution follows it.

**The gap.** D33 and CLAUDE.md hard rule 7 define the event-table "same source event" dedup key, applied latest-wins at read time, as `(tenant_id, store_id, source_id, source_event_id)`. Introspection of the applied canonical schema shows **neither `source_id` nor `source_event_id` exists** on `canonical.store_sku_sale_events` or `canonical.store_sku_change_events` (nor on any canonical table). The only source-related columns present are `source_sale_timestamp` / `source_event_timestamp` (timestamps, not ids), `transaction_id` and `line_item_seq` (sale events only), and `related_sale_event_id`. The event tables carry no UNIQUE constraint (correctly, per D33's append-only posture), so nothing in the schema pins the key either. As written, the D33 / rule-7 `ROW_NUMBER() OVER (PARTITION BY tenant_id, store_id, source_id, source_event_id ...)` window cannot be computed from existing columns.

**Not a dis-canonical defect.** The Slice 3 models mirror the applied schema exactly (verified by an independent column-set reconciliation, both directions, all four tables). The divergence is between the decision text and the migration that was applied (Slice 1), not in the Python models.

**Candidate resolutions (no choice made here).**
1. Add `source_id` and `source_event_id` columns to both event tables via an Alembic migration, populated by the streaming consumer from the mapping; the dedup key then maps literally.
2. Redefine the dedup key against columns that already exist (e.g. a per-source `transaction_id` plus a source discriminator), and amend D33 / rule 7 to match.
3. Carry the source identifiers inside `ingest_metadata` (jsonb) and compute the key from there (weaker — not indexable, not a first-class column).

**Why it must be settled by Slice 10.** Slice 10 builds the streaming consumer's atomic dual-write and the read-time latest-wins semantics depend on this key. Either the columns must exist (option 1) or the key must be redefined (option 2) before that code is written; otherwise the consumer cannot implement D33 as specified. Do not edit the DDL or the rule wording under Slice 3 — this entry only registers the gap. Cross-referenced from D33.

**Resolution (Slice 10 plan mode, M-D38/D64).** Resolution 1, migration required. Option-2 stand-ins fail on the live schema: `transaction_id`/`line_item_seq` exist only on sale events and are nullable; change events carry no source event identifier at all; `dis_channel` is the ingress channel, not the source registration id (multiple sources share a channel, so it cannot partition D33's per-source numbering namespaces). Option 3 (`ingest_metadata` JSONB) rejected: a correctness-bearing key in untyped, unindexable JSONB (the same reasoning as D64). Migration `0003_canonical_dedup_event_time` added to BOTH event tables `source_id VARCHAR(128) COLLATE "C" NOT NULL` (type/length/collation matched to `config.source_mappings.source_id` and `bronze.data_ingress_events.source_id`, introspected) and `source_event_id VARCHAR(256) COLLATE "C" NOT NULL`, plus the window-supporting indexes `ix_ssse_dedup_key`/`ix_ssce_dedup_key` `(tenant_id, store_id, source_id, source_event_id, source_{sale|event}_timestamp DESC)`, and D64's `last_source_event_at` on the hot table. The NOT NULL adds were legal against introspected-empty event tables; the migration re-checks `COUNT(*) = 0` immediately before each add and aborts otherwise. The D33 window's live column mapping: `ROW_NUMBER() OVER (PARTITION BY tenant_id, store_id, source_id, source_event_id ORDER BY source_{sale|event}_timestamp DESC, last_updated_at DESC, id DESC) = 1` (`event_ts`/`received_ts` in D33's prose map to the source timestamp and `last_updated_at`; `id` is uuidv7, the deterministic final tie-break). Population (consumer-side, Slice 10): `source_id` from the `ingress.ready` envelope (cross-checked against the GCS path and bronze row); `source_event_id` = `transaction_id || ':' || line_item_seq` when the source supplies them, else the deterministic fallback `bronze_ref || ':' || chunk_row_index` — redelivery-stable but NOT correction-collapsing for id-less sources (registered as D65, Slice 10). **Cross-refs.** D33, D64, D65, Slice 10.

---

### D39 Canonical store keying: composite `(tenant_id, store_id)` FK with global `store_id` uniqueness

**Status.** Settled; in force in the applied schema. The refactor landed under the D36 commit (`84b67eb`) but is an independent decision (it only shared that commit), so it is recorded here with its own number rather than as a note under D36. Surfaced/registered during Slice 3 while introspecting the live `ithina_dis_db` schema for the dis-canonical models.

**Decision.** Canonical tables key a store by the composite `(tenant_id, store_id)`, not by `store_id` alone. In the applied schema:
- `identity_mirror.stores` has PRIMARY KEY `(tenant_id, store_id)` plus a global `UNIQUE (store_id)` (`uq_ims_store_id`); `identity_mirror.tenants` has PRIMARY KEY `(tenant_id)`.
- Every canonical table (`store_sku_current_position`, `store_sku_sale_events`, `store_sku_change_events`, `store_sku_signal_history`) carries both a tenant FK `(tenant_id) -> identity_mirror.tenants(tenant_id)` and a composite store FK `(tenant_id, store_id) -> identity_mirror.stores(tenant_id, store_id)`.

**Why composite.** Tenant isolation becomes structural: a store FK on `store_id` alone would let a canonical row reference a store without re-asserting its tenant, leaving room at the referential layer for a store to be tied to the wrong tenant. Keying the FK on `(tenant_id, store_id)` makes "this store belongs to this tenant" an engine-enforced invariant on every canonical write, complementing RLS (D12). The global `UNIQUE (store_id)` keeps `store_id` a stable standalone identifier for lookups and the mirror sync, so the composite FK adds tenant-scoping without giving up global uniqueness.

**Evidence (introspected, `ithina_dis_db`).** `pk_ims = PRIMARY KEY (tenant_id, store_id)`; `uq_ims_store_id = UNIQUE (store_id)`; canonical `fk_*_store = FOREIGN KEY (tenant_id, store_id) REFERENCES identity_mirror.stores(tenant_id, store_id)`.

**Scope.** Docs only; records a decision already in force. No schema or DDL change. Relates to D12 (mirror table plus real FK as the cross-DB integrity substitute); cross-referenced from D36.

---

### D40 PII handling posture: deferral, fail-loud gate, and one-way-vs-reversible `OPEN`

**Status.** The Slice 4 fail-loud gate is **settled and in force**; the long-term tokenization posture is **`OPEN`**. Surfaced/registered during Slice 4 (`dis-pii`). **Hard deadline for the posture: the first PII-carrying receiver — a non-CSV receiver, or a CSV source mapping that flags a PII column.**

**The gap (three sources disagree).**
- **D24** specifies one-way deterministic **HMAC** with per-tenant keys; right-to-erasure is a key-vault delete. Reads as irreversible.
- **`build-guide.md:102`** defers a "storage backend for the **token → ciphertext** mapping" — i.e. a *reversible* (recoverable) mapping.
- **CLAUDE.md hard rule 2** names "deterministic HMAC with per-tenant **KMS** keys."
These are not consistent on whether tokenization is one-way (HMAC, no recovery) or reversible (token↔ciphertext), nor on what "configured backend" ultimately means. Not settled here.

**What Slice 4 built (settled, in force).** `dis-pii` provides heuristic PII detection (field-name / pattern) and a fail-loud gate: a mapping flagging any PII column with **no configured backend** raises `PiiBackendNotConfiguredError` *before* any persistence (hard rule 2, code-quality rule 4). No real backend exists in v1.0, so the gate raises on every flagged PII column. The not-raise branch is reachable **only** via an explicitly injected backend (tests); no config default or flag disables the gate. The tokenizer, key vault, and tokenization policy are inert placeholder seams (no crypto, no I/O), mirroring the Slice 3 `BqClient` discipline.

**Known limitations (registered, not fixed).**
1. **Heuristic detection → false negatives.** Detection matches column *names* against a PII set (phone, email, loyalty_id, PAN, Aadhaar; D24) and patterns. A PII column whose name the matcher does not recognise is **not** detected, so the gate does not fire on it. "Fail loud on PII" is bounded by detection coverage; it is not a guarantee that all PII is caught.
2. **No explicit per-column PII flag exists.** Live introspection (Slice 4) shows no PII-flag column on `config.source_mappings`, and the `mapping_rules` shape is `{version, rename, normalize, cast, derive}` — nothing for detection to read as an authoritative flag. An explicit-flag mechanism would require a **new `mapping_rules` field** (and likely a `config.source_mappings` change): a future schema + contract change, not built here.

**Doc-correction note (register, do not fix).** `architecture.md:99` reads "See `decisions.md` D18 for the PII module," but D18 is the validation split; the intended reference is **D24**. (`architecture.md` lines 305 and 432 already cite D24 correctly.) Correct the line 99 citation when the PII posture is next touched.

**Candidate resolutions (no choice made here).**
1. **One-way HMAC only** (no recovery): "configured backend" = the per-tenant key vault; erasure = key delete (D24 as written).
2. **Reversible token↔ciphertext store**: "configured backend" = that store; supports recovery but widens the erasure surface (build-guide framing).

**Why it must be settled then.** The first PII-carrying receiver needs a real backend — until one exists, the gate raises. **Scope.** Docs + the Slice 4 `dis-pii` lib. No DDL change. Cross-referenced from D24.

---

### D41 `identity_mirror` RLS posture: build-guide vs applied schema `RESOLVED`

**Status.** `RESOLVED` (Slice 7, by fresh live introspection of `ithina_dis_db`). Originally surfaced during Slice 4 (`dis-rls`). **Resolution: RLS-off on `identity_mirror` is correct.** The mirror holds identity that every tenant's canonical rows FK against and that ops/streaming read across tenants; RLS there would add no isolation that matters and would complicate the cross-tenant Mirror Sync write. So the Mirror Sync upsert is a plain write as the DIS service role — no per-row tenant scoping, no distinct role (it still flows through `dis-rls` `rls_session` solely to inherit the `current_database()` target guard; the per-row `app.tenant_id` is a harmless no-op under RLS-off). The stale side is `build-guide.md:108` ("`identity_mirror` is RLS-protected", with its per-row-vs-distinct-role plan-mode question); correcting that text is an operator call at the commit gate (register-only here).

**The gap.** `build-guide.md:108` (Slice 7) states "`identity_mirror` is RLS-protected" and asks plan-mode to choose between setting `app.tenant_id` per-row on upsert vs running Mirror Sync under a distinct role. But live introspection shows `identity_mirror.tenants` and `identity_mirror.stores` have **`relrowsecurity = false` and no policy** — consistent with the Slice 1/2 findings and the seeder's own comment that it writes to RLS-not-enabled schemas. So either the schema must gain RLS (a migration) or the build-guide text must drop the "RLS-protected" claim.

**Evidence (introspected, `ithina_dis_db`).** `pg_class.relrowsecurity = f` and `relforcerowsecurity = f` for `identity_mirror.tenants` and `identity_mirror.stores`; `pg_policies` has no rows for schema `identity_mirror`. (Contrast: `bronze.data_ingress_events` and `canonical.*` are `relrowsecurity = t, relforcerowsecurity = t` with a `tenant_isolation` policy.)

**Why Slice 7.** Mirror Sync writes real tenants/stores into `identity_mirror`; its upsert path and role posture depend on whether RLS is in force there. Resolve before that code is written. Do not edit the DDL or the build-guide under Slice 4 — this entry only registers the contradiction. **Scope.** Docs only. Relates to hard rule 1 / D12.

---

### D42 Audit `audit.events` drift: D33/D14/§8 duplicate-audit fields are absent from the live schema `OPEN`

**Status.** `OPEN`. Records a doc-vs-schema drift surfaced during Slice 6 (`dis-audit`) by live introspection of `ithina_dis_db`; it does **not** resolve it (no DDL edited). The D38-analog for the audit table. **Resolution owner: Slice 10** (streaming consumer, which emits duplicate-audit detail per D33).

**The gap.** D33 / `architecture.md` §2.3.3 specify, on a duplicate event-table INSERT, `outcome = DUPLICATE_NOOP` or `DUPLICATE_OVERWRITTEN` and a `prior_trace_id`. `architecture.md:702` lists the per-row audit field set as `{trace_id, tenant_id, store_id, source_id, stage, status, ts, row_hash, error_code, error_detail}`. The **live `audit.events` cannot represent these**:
- `ck_audit_events_outcome_vocab` permits only `SUCCESS, FAILURE, SKIPPED, RETRIED` — `DUPLICATE_NOOP`/`DUPLICATE_OVERWRITTEN` would violate the CHECK.
- There is **no** `prior_trace_id`, `store_id`, `source_id`, `source_event_id`, or `row_hash` column.

**Evidence (introspected, `ithina_dis_db`).** `pg_get_constraintdef(ck_audit_events_outcome_vocab)` = `CHECK ((outcome)::text = ANY (ARRAY['SUCCESS','FAILURE','SKIPPED','RETRIED']))`. `information_schema.columns` for `audit.events` returns 23 columns; a filter for `store_id`/`source_id`/`source_event_id`/`row_hash` returns 0 rows. The only structured-context column is `event_data JSONB` (its `COMMENT` documents stage-specific shapes).

**Intended home (not closed by DDL here).** The duplicate-audit detail (`DUPLICATE_*` distinction, `prior_trace_id`, the dedup key `store_id`/`source_id`/`source_event_id`, `row_hash`) lands in the `event_data` JSONB, not first-class columns — unless Slice 10 elects a DDL change (extend the CHECK / add columns). `dis-audit` therefore does **not** define `DUPLICATE_*` outcomes or those columns; its `Outcome`/`EventScope` enums mirror the live CHECKs exactly. Cross-referenced from D33 and D38. **Scope.** Docs only; no DDL edited under Slice 6.

**Drift-guard limit (Slice 6 AC2).** The `dis-audit` model reconciliation against the live schema is a column-**name set** match only (both directions), not a per-column type / nullability / FK check. So a *type narrowing* on an existing column (e.g. `varchar(64)` → `varchar(32)`, or widening an int) passes the set match and is caught only as a runtime INSERT failure — which fire-and-forget then swallows (a D45 silent-loss-family case). Recorded, not fixed; no test or DDL change here. To be addressed when audit schema-vs-contract drift is next touched (Slice 10), alongside the duplicate-audit detail above.

---

### D43 Every DIS audit event carries a known `tenant_id`; no tenant-less audit path `SETTLED`

**Status.** `SETTLED` (product boundary). Parallels D41 in shape (a schema looser than the rule) but is **settled, not OPEN**: the operator has ruled this a permanent product boundary, not a v1.0 convenience.

**Decision.** Every DIS audit event carries a known `tenant_id`. DIS has no tenant-less audit path. The `dis-audit` writer goes through `dis_rls.rls_session(engine, tenant_id)` (hard rule 12); an event with no `tenant_id` is refused loudly (`AuditWriteError`, logged), never silently dropped.

**Why (product facts).** Uploads are always for a known tenant and one of its stores — the tenant comes from the authenticated Customer Master session; the store is supplied or read from the CSV. Downstream pipeline stages inherit that tenant. Authentication is Customer Master's responsibility (D25), so DIS does not record auth events and a failed sign-in is never a DIS audit event. Scheduled jobs (Slice 18, daily-compute) and ops actions (Slice 12, replay) act per-tenant.

**Schema-vs-product gap (recorded, not closed by DDL).** The live `rls_audit_events_tenant` policy permits `tenant_id IS NULL` and the column is nullable, so the schema is **looser** than the product rule. The product rule wins. The NULL branch is left as intentional headroom, not a supported path. Making `tenant_id NOT NULL` to match the rule is a separate DDL slice, not undertaken here; its absence is a tolerated, recorded mismatch — **not debt the next slice must clear**.

**Evidence (introspected, `ithina_dis_db`).** `audit.events.tenant_id` `is_nullable = YES`; policy `rls_audit_events_tenant` `USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR tenant_id IS NULL)`; `relrowsecurity = t, relforcerowsecurity = t`. `fk_audit_events_tenant → identity_mirror.tenants(tenant_id)`.

**Supporting evidence — non-deferred Phase-1 emitters all emit post-identity.** dis-ui-server `upload_session` (Slice 8, after session validate); csv-ingest-worker (Slice 9, identity inherited from the upload session); streaming-consumer (Slice 10, `tenant_id` carried on `ingress.ready`); quarantine-drainer (Slice 11, rows carry `tenant_id`); daily-compute (Slice 18, `app.tenant_id` per tenant). The `events.sql:83` "pre-auth receiver errors" comment refers to **receiver services, all DEFERRED**; whether a deferred receiver ever emits a tenant-less event is a decision owned by that future receiver slice — not a v1.0 deferral and not this decision's trigger.

**What Slice 6 builds.** The writer requires a non-NULL `tenant_id` (`rls_session` posture); the `AuditEvent` model mirrors the nullable column for the both-directions drift guard, but the writer enforces the product rule, so a `None` raises `AuditWriteError` (logged, never a silent drop). **Scope.** `dis-audit` writer + this register entry; no DDL edited.

---

### D44 Phase-1 audit-write idempotency: tolerate duplicates in Cloud SQL

**Decision.** Phase-1 audit writes to Cloud SQL `audit.events` **tolerate duplicate rows**. The writer adds no dedup key and no `ON CONFLICT`; each emit is a new `uuidv7()`-keyed row.

**Why.** The live `audit.events` has no UNIQUE key beyond `pk_audit_events (id, event_date)` on the synthetic `id` — no natural key on `(trace_id, stage)`. This matches the documented audit posture: `architecture.md` §2.3.3 and the BigQuery `audit_events` caveats (3, 4) state audit accepts retry/replay duplicates and dedups at query time. Pub/Sub redelivery and the `DUPLICATE_NOOP` reprocess path can re-emit the same `(trace_id, stage)`; that is accepted, not prevented.

**Divergence registered.** `architecture.md:657` describes audit as "At-least-once; idempotent in BQ via `insertId`." Cloud SQL has no `insertId` analog, so Phase-1 has weaker (no transport-level) idempotency than the Phase-3 BigQuery target. Acceptable at beta scale; the read-time/query-time dedup stance is unchanged. **Evidence (introspected).** `pg_constraint` for `audit.events` shows one `p` constraint `pk_audit_events (id, event_date)` and no `u` constraint. **Scope.** `dis-audit` writer; no DDL edited.

---

### D45 Audit partition coverage is finite and has no DEFAULT partition — out-of-range writes are silently lost `OPEN`

**Status.** `OPEN` (operational gap). Surfaced during Slice 6 by live introspection; registered, not closed (partition automation is a separate operational concern, not a Slice 6 deliverable).

**The gap.** `audit.events` is `PARTITION BY RANGE (event_date)` with daily partitions **only `2026-06-01` … `2026-06-07`** and **no DEFAULT partition**. No partition-creation job exists yet (the DDL notes subsequent partitions are created by a Cloud Scheduler job or a daily-compute side task — `schemas/postgres/audit/events.sql:177-180`). A write whose `event_date` falls outside the covered range raises *"no partition of relation events found for row"*; under fire-and-forget (hard rule 11) that is then swallowed, so the audit row vanishes. With coverage ending `2026-06-07`, this produces **silent audit loss within days** of the current date (`2026-06-03`). This is grant-independent.

**Not the grant.** `ALTER DEFAULT PRIVILEGES IN SCHEMA audit … TO ithina_dis_user` **is** in force (`pg_default_acl`: `audit | r | granted_by ithina_dis_admin | ithina_dis_user=arwd`, `a` = INSERT), matching `build-guide.md:89`, so admin-created future partitions auto-inherit INSERT. The risk is the **absence of the partitions themselves**, not a missing grant.

**Mitigation in `dis-audit`.** The writer logs a swallowed write failure as an error explicitly flagged as worth alerting (a missing partition / missing grant / schema mismatch is "not absorbed as routine"). It does **not** create partitions. **Resolution owner.** A partition-management operational task (Cloud Scheduler / daily-compute side task) before audit traffic reaches an uncovered date. **Scope.** Docs + a writer log line; no DDL edited.

---

### D46 `identity_mirror` soft-delete is via `status`, not an `is_active` column `RESOLVED`

**Status.** `RESOLVED` (Slice 7). A doc-vs-schema gap: `services/mirror-sync-consumer/CLAUDE.md`, its `README.md`, and `architecture.md` §4.3 describe Mirror Sync soft-deleting via an `is_active` column. **No such column exists** on either mirror table.

**Evidence (introspected, `ithina_dis_db`).** `identity_mirror.tenants` columns: `tenant_id, name, status, pc_created_at, pc_updated_at, pc_suspended_at, pc_terminated_at, mirror_synced_at`. `identity_mirror.stores` columns: `store_id, tenant_id, name, status, country, timezone, currency, tax_treatment, pc_created_at, pc_updated_at, pc_closed_at, mirror_synced_at`. A query for an `is_active` column in schema `identity_mirror` returns no rows. Lifecycle lives in `status` (tenants: `…/SUSPENDED/TERMINATED`; stores: `…/INACTIVE/CLOSED`) with the per-lifecycle `pc_*` timestamps alongside.

**Resolution.** Lifecycle is Customer Master's `status` replicated verbatim; the sync is **upsert-only — never delete, never soft-delete**, which is what Slice 7 implements. The service `CLAUDE.md` is corrected here; correcting the `README.md` / `architecture.md` `is_active` language is an operator call at the commit gate. **Scope.** Docs only; no DDL. Relates to D12, D39, D41.

---

### D47 DIS keeps every mirrored row; Customer-Master-side deletion handling is deferred `OPEN`

**Status.** `OPEN` (deferred, registered by Slice 7). Mirror Sync (DB-pull) is upsert-only and **does not delete or mark-absent** a mirror row when its Customer Master source is hard-deleted or removed. Deleting a mirror row would orphan or cascade against the canonical / audit / config rows that FK to it (D12, D39; the mirror store FK is `ON DELETE RESTRICT`).

**The gap & symmetry.** A CM row removed at source leaves a stale mirror row. Resolving this needs both a CM-side delete/deactivation path **and** a data-governance policy for the referential cleanup. Note the symmetry: the same orphan-vs-cascade risk lands inside Customer Master itself (its own children reference the row), so a policy that solves it on one side without the other reintroduces the risk. **Trigger:** Customer Master implements a delete/deactivation path AND a governance policy defines the cleanup. **Scope.** Docs only.

---

### D48 A Customer-Master-shaped test Postgres harness exists and is reusable `SETTLED`

**Status.** `SETTLED` (Slice 7). DB-pull reads Customer Master's *Postgres*, but the Slice 2 Customer Master fake is **HTTP-only** (JWTs / sessions / events) and the real CM (port 5432) is off-limits to tests. Slice 7 therefore built a faithful stand-in: `dis_testing.customer_master_db` provisions an in-cluster `ithina_platform_db` database on 5433 with `core.tenants` / `core.stores`, **FORCE ROW LEVEL SECURITY** + the platform-access policy, seeded from `dis_testing.fixtures`, with `SELECT` granted to the NOBYPASSRLS service role (so the no-context-→-zero-rows behavior is exercised for real). The reader asserts `current_database()` is the CM database; the writer is `ithina_dis_db` — both on 5433, the real CM never touched.

**Reuse, not rebuild.** A later CM-reading slice (e.g. the Pub/Sub consumer mode, or any service that reads CM) **reuses this harness** rather than rebuilding it. **Correction registered:** the Slice 7 doc's "Slice 2 Customer Master fake" dependency and criterion 8 wording were inaccurate for a DB-pull read (the fake cannot serve a DB read); the slice doc has been edited to name the test-CM Postgres harness so the doc and the build agree. **Scope.** Test infrastructure + docs; no production DDL.

---

### D49 `mapping_rules` drives normalization via a field named `normalize`; the `transforms` wording in D20/architecture.md is stale `RESOLVED`

**Status.** `RESOLVED` (Slice 5, by live introspection of `ithina_dis_db`). Records a confirmed doc-vs-schema naming divergence; the engine follows the live schema.

**The divergence.** D20 and `architecture.md` (§6.1 step 6, the ASCII config box, and the Glossary's "Normalization" entry) describe normalization as driven by a declarative **`transforms`** field in the mapping config. The live `config.source_mappings.mapping_rules` JSONB uses **`normalize`**: the seeded row (`mapping_version_id=1`) carries `{"version":1,"rename":{},"normalize":{},"cast":{},"derive":{}}`, and the live column comment reads "The rename + normalize + cast + derive rules per source field. JSONB; shape is source-type dependent; documented in libs/dis-mapping; validated by Pandera when the streaming consumer loads it." D40's note had already recorded the `normalize` shape; Slice 5 re-introspected and confirmed it.

**Resolution.** The field is **`normalize`**. `libs/dis-mapping`'s `SourceMapping` model reads `{version, rename, normalize, cast, derive}` and is the documented contract for the inner shape (the live row's sub-objects are empty, so live data does not constrain it; the column comment delegates the documentation to libs/dis-mapping). **Inner shape (Slice 5):** `normalize` and `derive` are `dict[canonical_col, ORDERED LIST of {op, args}]`, applied in declared sequence; ops are atomic and single-purpose; `cast` is `dict[canonical_col, {type, precision?, scale?}]`. Separator/locale args (`parse_decimal`, `parse_integer`) are mandatory declarations — never defaulted or inferred (the locale rule has no other doc home; it is pinned in the lib contract). Correcting the `transforms` wording in `architecture.md`/D20 prose is an operator call at the commit gate (register-only here). **Scope.** Docs + the Slice 5 `dis-mapping` model; no DDL.

---

### D50 pandera 0.31.1 polars engine crashes on Decimal-schema vs non-Decimal data; contained pre-check workaround in dis-validation `OPEN`

**Status.** `OPEN` (upstream bug; contained workaround in force). Surfaced during Slice 5 implementation — the plan-mode probes validated Decimal-vs-Decimal but not Decimal-vs-other-dtype. **Owner: Slice 5. Removal trigger: the canary test goes red.**

**The bug.** pandera 0.31.1 (the pinned, newest release — no patched 0.31.x exists) raises a raw `AssertionError` ("The return is expected to be of Decimal class", `pandera/engines/polars_engine.py`) when a schema column declaring `pl.Decimal(p,s)` validates data of ANY non-Decimal dtype (String and Float64 both reproduce). Every other dtype mismatch reports a typed `dtype(...)` failure case; Decimal-vs-Decimal precision/scale mismatches also report natively. Unhandled, a contribution with a wrong-typed Decimal column (e.g. a mapping missing its cast rule) would crash the canonical-shape gate with a non-`DisError` instead of routing a typed failure — a consumer crash-loop path, not a quarantine path.

**The contained workaround** (`dis_validation.runner._decimal_dtype_precheck`). Scoped STRICTLY to Decimal-schema columns: before pandera runs, columns whose schema dtype is `pl.Decimal` and whose data dtype is not Decimal get the SAME failure-case row a native dtype check produces (same `check` string, same column-level grain), formatted by the same formatter — downstream sees one shape for one logical error (asserted by `test_decimal_dtype_mismatch_failure_is_indistinguishable_from_native`). The affected column alone is neutralized for the pandera run; every other column stays entirely pandera's. No `AssertionError` is caught anywhere.

**The canary** (`libs/dis-validation/tests/unit/test_pandera_decimal_canary.py`) feeds pandera the broken case directly (outside the workaround) and asserts the raw `AssertionError` STILL occurs, plus asserts the bug's boundary (Decimal-vs-Decimal reports natively). Any upstream behaviour change — within or beyond the version pin — turns the canary red, forcing the workaround's removal review. Do not loosen the canary; remove the workaround. **Scope.** `dis-validation` runner + tests; no DDL.

---

### D51 Tier-0 structural CSV validation lives in dis-ui-server's upload endpoint, not the frontend and not the pure pipeline libs `OPEN`

**Status.** `OPEN`, forward-looking (registered at the Slice 5 commit gate; operator-directed).

Tier-0 structural CSV validation (file present, non-empty, decodes, parses as CSV, min-rows floor) lives in dis-ui-server as a module within the upload endpoint, not in the frontend and not in the pure pipeline libs (dis-mapping/dis-validation operate on parsed frames, never bytes); it is structural-only, with column/mapping-aware checks remaining tier 1 (the source-shape suite). **Owner:** the slice building dis-ui-server's upload endpoint. **Promotion trigger:** promote to a shared lib only if a second upload entry path needs the same gate. **Naming note:** `dis-ui-server` is the live architecture's name for the BFF (D26, D36; build-guide Slice 8) — no divergence. **Cross-refs:** D4, D18, slice-05.

---

### D52 DIS Pub/Sub contracts: identity is the internal UUID; the invented `t_*`/`s_*` form is removed; external codes ride along, optional but producer-required `RESOLVED`

**Status.** `RESOLVED` (Slice 9a). Corrects a contract-vs-authority defect found while planning CSV ingest: every DIS Pub/Sub envelope keyed `tenant_id`/`store_id` to the pattern `^t_[a-z0-9]{12}$` / `^s_[a-z0-9]{12}$`, a form that matches neither the authoritative internal UUID (Customer Master `core.*.id`, mirrored verbatim) nor the authoritative external code (`display_code`/`store_code`). It was a DIS-invented identifier for entities DIS does not own.

**Decision.** Across all DIS Pub/Sub contracts, the identity fields carry the **internal UUID** (`format: uuid`), load-bearing. The `t_*`/`s_*` form is removed. Where a readable code is wanted on the wire, contracts carry the authoritative Customer Master codes as separate fields, `tenant_display_code` (= `tenants.display_code`) and `store_code` (= `stores.store_code`): **optional in the schema, but producers MUST populate them when publishing** (enforced producer-side and in producer tests, not by the validator). Codes are readability only, never a substitute for the UUID.

**Files corrected (edited in place; `schema_version` stays `const: 1`).** All live in `contracts/pubsub/`: `ingress.ready`, `ingress.resubmit`, `quarantine`, `pipeline.dlq`, `mapping.changed`, `identity.changed`, plus the new `csv.received` (D54). Each schema and its example updated. Because the change is breaking but **nothing consumes these in production** (local dev only, no staging), the version is not bumped; the schemas are treated as never-deployed drafts.

**Per-contract specifics.**
- `ingress.ready` / `ingress.resubmit`: `tenant_id`, `store_id` to UUID; add the two code fields; `gcs_uri` tenant segment to UUID (D53).
- `quarantine`: same, `store_id` stays optional; `gcs_uri` to UUID (D53).
- `pipeline.dlq`: `tenant_id` to UUID; add `tenant_display_code`; `batch.rows_ref` is unpatterned, example path updated to the UUID segment.
- `mapping.changed`: `tenant_id` to UUID; add `tenant_display_code`. `changed_by` is a user-id vocabulary (`u_*`), out of scope.
- `identity.changed`: `entity_id` and `tenant_id` to UUID; `payload.is_active` (boolean) replaced by `payload.status` (string) to match D46; `payload` gains `display_code`/`store_code` so Mirror Sync's Pub/Sub mode can populate the new mirror columns (D55).

**Cross-refs.** D37 (translation resolved; this removes the invented form it described), D53 (GCS path UUID), D54 (`csv.received`), D55 (mirror external-code columns), D46 (`status` not `is_active`). **Scope.** Contracts + examples only; the Identity Service and producer code that must populate UUID + codes are D37 / D55 and the relevant slices.

---

### D53 GCS object-path tenant segment is the internal tenant UUID, not an external code `RESOLVED`

**Status.** `RESOLVED` (Slice 9a). Settles the path-form half of the identity correction (D52): the canonical GCS object path embedded a `t_*` tenant segment (`tenant/t_[a-z0-9]{12}/...`), the same invented external form, pinned both in hard rule 9 and in the `gcs_uri` regex of the frozen Pub/Sub contracts.

**Decision.** The tenant segment of the canonical GCS object path is the **internal tenant UUID**. Path scheme: `tenant/{tenant_uuid}/source/{source_id}/yyyy=Y/mm=M/dd=D/{trace_id}.{ext}`. Chosen over the external `display_code` because the UUID is immutable and authoritative, whereas `display_code` is user-editable in Customer Master: keying object paths (and the dedup and lineage that read them) on a mutable code would break path stability on a tenant rename. The `gcs_uri` regex in every contract that carries it (`ingress.ready`, `ingress.resubmit`, `quarantine`) changes its tenant segment from `t_[a-z0-9]{12}` to the UUID form; `pipeline.dlq.batch.rows_ref` is unpatterned but its example path is updated likewise.

**Implications.**
- `libs/dis-storage`: `build_object_path` produces the UUID segment; the inverse `parse_object_path` (added by the consumer slice) parses it. Hard rule 9's path text in CLAUDE.md is corrected to the UUID form.
- This resolves the §3.6 finding from the Slice 9 (now 9b) first plan: with identity carried as UUID and the path keyed by UUID, the worker writes the UUID to bronze and to the envelope with no external-form reconciliation. The external codes ride the envelope (D52) but are not in the path.
- The exact UUID character-class in each regex is finalized in plan mode against what `dis-storage` actually emits; the contracts carry the standard 8-4-4-4-12 hex form as drafted.

**Cross-refs.** D52 (identity-field correction), hard rule 9, D36 (the path that D36's "upload session id encoded in the path" wording referenced; that wording is corrected under D54). **Scope.** Contracts + `dis-storage` path scheme + hard rule 9 text; the path-producing code lands in the relevant slices (Phase 1 builds paths, the worker parses them).

---

### D54 CSV ingest is triggered by a `csv.received` event from dis-ui-server, not a raw GCS object-finalize; the worker trusts the event and resolves no identity `RESOLVED`

**Status.** `RESOLVED` (Slice 9a). Replaces the trigger model D36 implied for CSV-upload Phase 2. D36 left Phase 2 "event-triggered by GCS object-finalized notifications," which made the worker resolve identity itself (it received only a path) and assumed "the upload session id is encoded in the GCS object path", a carrier that does not exist in the live path scheme (D53 keys the path by UUID + trace_id, no session segment).

**Decision.** dis-ui-server publishes a `csv.received` event once the tenant's signed-PUT upload is confirmed saved in GCS. The `csv-ingest-worker` is triggered by `csv.received` and **trusts it**: identity (`tenant_id`/`store_id` UUIDs, plus codes) is already on the message because dis-ui-server resolved it at Phase 1 against the Identity Service (D37). The worker therefore **does not call `resolve_from_upload` and holds no Identity Service dependency**. `trace_id` is carried on `csv.received` (minted at Phase 1), so the worker reads it rather than parsing it from the object path. `upload_session_id` rides the event as the `source_payload_id` idempotency component and lineage, not as a resolve key.

**Why event-from-dis-ui-server, not GCS-finalize.** A raw GCS finalize carries no identity, forcing a re-resolve and a fragile path-parse; it also fires on every object in the bucket. A `csv.received` from dis-ui-server is a clean DIS envelope carrying resolved identity and the GCS pointer, and matches the trust model already used downstream (the streaming consumer trusts `ingress.ready` rather than re-resolving). The new event is a DIS Pub/Sub contract (`csv.received`, D52 field rules apply); it is distinct from `ingress.ready`, which the worker publishes only after bronze lands.

**Trust-boundary tradeoff (named).** The worker trusting dis-ui-server's identity means a dis-ui-server identity bug would propagate; re-resolving is rejected because it would only re-derive what dis-ui-server already knew. Downstream freshness (tenant/store deactivated between upload and processing) is the streaming consumer's `validate()`, not the worker's, so nothing is lost by dropping the worker's resolve.

**Open mechanic for the owning slices (not settled here).** How dis-ui-server learns the PUT completed (it issues the signed URL and is otherwise out of the loop): a client completion-callback to dis-ui-server, or dis-ui-server subscribing to GCS finalize itself and re-publishing `csv.received`. That is a Slice 9a / Slice 8 design point. Also confirm the upload-session-to-`trace_id` cardinality (whether one session can span more than one file/`trace_id`).

**Cross-refs.** D36 (the Phase-1/Phase-2 split this refines; its "encoded in the object path" wording is corrected here), D37 (translation at Phase 1), D52/D53 (contract + path), D5 (bronze-first still holds: the worker writes bronze then publishes `ingress.ready`). **Scope.** Contract (`csv.received`) + the trigger model; the publish point in dis-ui-server and the worker's subscription land in Slice 8 / Slice 9b.

---

### D55 `identity_mirror` gains `display_code`/`store_code`, copied as-is from Customer Master; the invented `t_*`/`s_*` external form is retired `RESOLVED`

**Status.** `RESOLVED` (Slice 9a). Closes the external-code question that surfaced alongside D37. Confirmed by live introspection of Customer Master: `core.tenants` carries `display_code` (text, **nullable**; e.g. `buc-ees`, `zabka-group`) and `core.stores` carries `store_code` (text, nullable; e.g. `TX-102`). These are the **only** authoritative external codes in the Ithina system; the contract's `t_*`/`s_*` matched neither and was a DIS invention.

**Correction (Slice 9a execution).** This entry originally recorded `display_code` as `NOT NULL` at source. Re-introspection of the live Customer Master (`information_schema.columns`, via the documented read-only access) shows **both** source columns are nullable (`is_nullable = YES`, no default). The mirror columns are nullable simply because the source columns are; the original "left nullable to avoid a copy-time constraint the source does not itself guarantee across history" justification is dropped as moot. The D48 test-CM harness models both columns nullable accordingly (a harness stricter than live would mask a real null path).

**Decision.** Add `display_code` to `identity_mirror.tenants` and `store_code` to `identity_mirror.stores`, copied **as-is** by Mirror Sync, consistent with the mirror's "faithful copy" posture (the mirror copies Customer Master columns verbatim, D12). Both mirror columns are **nullable**, matching the source. These codes are the authoritative readable form used for the optional `tenant_display_code`/`store_code` fields on the Pub/Sub envelopes (D52). They are **not** a translation bridge: external-to-internal resolution is the Identity Service returning the UUID (D37), not a mirror lookup.

**Why only these two columns.** Of everything in Customer Master's tenants/stores, only the external codes were both authoritative and missing from the mirror (the mirror already carries `name`, `status`, lifecycle timestamps). The codes are not load-bearing (the UUID is); they are added mainly to give the readable form an authoritative home and retire the invented `t_*`/`s_*` form for good. Other Customer Master columns are added later only if a consumer needs them (the evolve-in-step rule: the mirror grows when Customer Master grows and the column is relevant).

**Implications.**
- DDL: an Alembic migration adds the two columns (nullable). This reopens **Slice 7** (Mirror Sync, DB-pull) to select and upsert the new columns, with its tests; the change is additive.
- `identity.changed` payload carries `display_code`/`store_code` (D52) so the deferred Pub/Sub sync mode can populate them too.
- Identity Service returns the codes alongside the UUID (D37), so dis-ui-server can put them on `csv.received`.
- Backfill of existing mirror rows is the normal Mirror Sync run (idempotent via the conditional `IS DISTINCT FROM` upsert); the migration itself adds the nullable columns and does no backfill.

**Known gap (registered, out of 9a scope).** No `identity_mirror` drift guard exists — the both-directions live-introspection pattern covers `audit.events` and the canonical suites but not the mirror — so a future mirror column drift trips nothing; the de-facto reconciliation points are the Mirror Sync row models and upsert column lists.

**Cross-refs.** D37 (UUID translation; codes are readability, not the bridge), D52 (envelope code fields), D54 (`csv.received` carries codes), D12 (mirror as faithful copy + real FK), D46 (`status`). **Scope.** `identity_mirror` DDL + Mirror Sync (Slice 7) + this entry; lands in Slice 9a.


### D56 Two Customer Master contract shapes are DIS approximations pending CM sign-off: the JWT claim identifier values and the upload-session response `OPEN`

**Status.** `OPEN` (registered by Slice 9a). **Deadline: the Customer Master contract sign-off** (a Phase 0 TODO). This entry is a tracked loose end, not a settled contract: nothing here reads as DIS having settled the CM contract.

**Context.** Slice 9a retired the invented `t_*`/`s_*` identity form (D52) from the fixtures and the Slice 2 fakes. Two CM-owned artifact shapes had carried that form and needed a replacement now, before the real CM contract is signed. In both cases 9a uses the best available approximation — Customer Master's authoritative external codes (`display_code`/`store_code`, D55) — because the codes are real CM data while `t_*`/`s_*` never was, and because external-facing CM artifacts must not carry DIS-internal UUIDs.

**The two registered divergences.**
1. **JWT claim identifier values.** The test JWT claims (`tenant_id`/`store_id`, built by `dis_testing.fixtures.build_claims`) now carry `display_code`/`store_code` values. `contracts/identity-service/attribute-needs.md` §2 still pins the retired `^t_[a-z0-9]{12}$`/`^s_[a-z0-9]{12}$` patterns — that document is DIS's requirements input to the **unsigned** CM contract, so its patterns are CM vocabulary and are NOT rewritten by 9a; the file carries a one-line staleness flag pointing here. The real claim shape is CM's to define at sign-off.
2. **Upload-session response identifier values.** The CM fake's `UploadSessionResponse.tenant_id`/`store_id` now carry the codes (`store_id` null for a code-less store). The real CM upload-session API shape has never been seen; this is an approximation of an unseen contract, flagged for the same sign-off.

**Resolution path.** At CM contract sign-off: confirm (or replace) the claim identifier vocabulary and the upload-session response shape; update `attribute-needs.md`, `dis_testing.fixtures.build_claims`, and the CM fake to the signed shapes; close this entry. The Identity Service contract itself (UUID + codes out, D37) is NOT in question here — only the CM-artifact input shapes the fakes approximate.

**Cross-refs.** D37 (Identity Service returns the UUID), D52 (invented form retired), D55 (the authoritative codes), D48 (the test-CM harness these fakes pair with). **Scope.** Register entry + the one-line flag in `attribute-needs.md`; fixture/fake approximations land in Slice 9a.


### D57 mypy --strict gate: the predicted pandera per-module relaxation proved unnecessary `SETTLED`

**Status.** `SETTLED` (Slice 9d). The 9d scoping report predicted dis-validation might need a narrow per-module mypy override where pandera's typing blocked strict mode; in execution every dis-validation error was our own annotation gap, so dis-validation is fully strict-enforced with **no override** — this entry documents that outcome and registers no relaxation.


### D58 Bronze idempotency is query-based and single-worker; `store_id` stays nullable with a registered channel-scoped tightening gap `OPEN`

**Status.** `OPEN` (registered by Slice 9b; forward-looking, no DDL now). Two related bronze-schema facts the worker build surfaced, both verified by live introspection of `bronze.data_ingress_events` on 5433.

**1. The dedup key has no constraint or supporting index — correct for a SINGLE worker instance only.** The Slice 9b idempotency key is `(tenant_id [RLS], source_payload_id = upload_session_id, payload_sha256)` within a 24h window measured against the prior row's `received_at` (the only NOT NULL persisted timestamp; the producer's `csv.received.received_ts` is producer-controlled and skews under redelivery/late delivery, so it is NOT the dedup clock). The live schema carries **no UNIQUE constraint over this key** — correctly, since a rolling *window* cannot be expressed as a plain unique index — so the check is a query (`SELECT ... WHERE source_payload_id = :spid AND payload_sha256 = :sha AND received_at >= :cutoff`). **The explicit operating assumption: the worker runs as ONE instance.** Two *concurrent* identical deliveries processed by concurrent instances could both pass the SELECT and double-write; redelivery to a single instance cannot (the lookup precedes the insert in the same process). **Any future "scale the worker horizontally" change MUST first revisit this entry** and add a real concurrency guard (e.g. a partial unique index over `(tenant_id, source_payload_id, payload_sha256)` + `ON CONFLICT` semantics with window logic applied at read, or an advisory-lock scheme); silently scaling instances breaks dedup. Secondary gap, same trigger: no index supports the dedup lookup (`ix_bdie_tenant_source_received_at` covers `source_id`, the channel — not `source_payload_id`); at beta volume the scan is irrelevant, at scale the same future change should add one.

**2. `store_id` nullability vs the single-store upload session.** `csv.received.store_id` is contract-REQUIRED ("an upload session is bound to exactly one store at session creation"), so every worker-written `csv_upload` bronze row carries a `store_id`. The live column stays NULL-able because bronze is shared across all four ingress channels and a chunk-level `store_id` is legitimately NULL where store is per-row inside the chunk (e.g. ERP batches; per-row store binding happens at the canonical write via the composite FK, D39). The registered tightening for a future migration slice: a **channel-scoped CHECK** (`dis_channel <> 'csv_upload' OR store_id IS NOT NULL`), not a blanket NOT NULL. The pre-9b smoke rows (NULL `store_id`, NULL `source_payload_id`/`payload_sha256`, `source_id='manual_csv_upload'`) predate the worker, can never match the non-NULL dedup equality, and do not define the contract.

**Cross-refs.** D54 (upload_session_id as the source_payload_id component), D5 (bronze-first), D59 (what a dedup hit does), D39 (the canonical no-orphan guarantee this does NOT replace), D38 (the canonical-side dedup-column gap this is the bronze analog of — distinct: here the columns EXIST, only the constraint posture is registered). **Owner of the resolution:** the first slice that scales the worker beyond one instance, or a dedicated bronze-hardening migration slice.


### D59 csv-ingest-worker redelivery semantics: resume-and-mark — no second publish if the prior ingest published; complete the publish if it did not `RESOLVED`

**Status.** `RESOLVED` (Slice 9b, operator-decided). Refines Slice 9b acceptance criterion 7, whose original wording ("no second publish", unconditional) is updated to match; recorded here so the refinement is explicit, not drift.

**Decision.** The worker stamps `published_at` + `processing_status='PUBLISHED'` AFTER the `ingress.ready` publish (the columns exist in the live bronze schema for exactly this lifecycle). On a dedup hit (same content hash + upload session + tenant within the 24h window):
- prior `PUBLISHED` → **full no-op**: return the prior `trace_id`, no second bronze row, no second publish (audit `RECEIVED`/`SKIPPED` with `prior_trace_id` in `event_data`, the D42 pattern).
- prior `FAILED` (a preflight-failed ingest) → full no-op likewise: redelivery of the same bad bytes never re-runs preflight and never publishes.
- prior `RECEIVED` with `published_at` NULL (a crash/outage between the bronze write and the publish) → **resume and mark**: publish `ingress.ready` under the PRIOR ingest's `trace_id` with the prior `bronze_ref`, then stamp the publish. No second bronze row.

**Why.** Write-then-publish (D5) under at-least-once delivery means crash-between-write-and-publish is a real state; a strict unconditional no-op would stall that chunk until the (future, unbuilt) D5 sweeper. Resume-and-mark converges on redelivery with no stall. The cost — a rare duplicate `ingress.ready` when the mark itself fails after a successful publish — is tolerated by design: Pub/Sub is at-least-once anyway and the streaming consumer dedups (D33/Slice 10).

**Related note (the two `received_ts`).** `csv.received.received_ts` is the producer's timestamp (dis-ui-server confirming the GCS save); `ingress.ready.received_ts` is when DIS durably accepted the chunk — the bronze row's `received_at`, stamped by the worker. They are distinct instants on one flow; downstream readers of both must not conflate them, and the dedup window is measured against bronze `received_at` only.

**Cross-refs.** D5 (bronze-first; the sweeper remains the recovery for messages lost outside the redelivery path), D54 (trace_id is read, never minted — the resume publishes under the prior's), D44 (duplicate audit tolerated), D58 (the single-worker assumption the dedup query rests on). **Scope.** csv-ingest-worker semantics + the slice-doc criterion-7 wording update; lands in Slice 9b.


### D60 Pub/Sub ordering key described in contracts but not implemented `OPEN`

**Status.** `OPEN` (registered at the Slice 9b commit gate, from the slice's adversarial self-validation). Both `csv.received` and `ingress.ready` describe `tenant_id` as the Pub/Sub ordering key, but no producer sets one (worker publisher, dis-testing publishers, test publishes). Ordering keys need a publisher attribute + ordering-enabled subscriptions, absent from the repo. Left in 9b because no consumer depends on ordering (Slice 10 unbuilt) and canonical correctness is event-time-based (D7, D33). **Resolution:** when the first ordering-sensitive consumer lands (Slice 10), implement the ordering-key convention end to end OR strike the description from both contracts. **Cross-refs.** D7, D33, D54.


### D61 Named-custom-transform escape hatch deferred (declarative-only mapping stance) `DEFERRED`.

The mapping engine stays declarative-only (the Slice 5 bounded vocabulary). A gap the vocabulary cannot express is an onboarding problem (fix the mapping or extend the shared vocabulary) or schema drift (detect and fail), not a per-source code path. No named-transform registry is built. Trigger: a concrete source that defeats both the declarative vocabulary and a vocabulary extension. Cross-ref: Slice 5, Slice 10.


### D62 Proactive schema-drift monitoring deferred (reactive detection stands) — DEFERRED.

Drift is caught reactively: structural drift by the pre-mapping source-shape suite, format drift by normalization, both routed to the failure disposition (Slice 10) and quarantine (Slice 11). No standalone watcher or pre-processing schema comparison is built. Trigger: reactive detection proves insufficient in pilot (a drift class slips past both suites), or a tenant SLA requires proactive drift alerting. Cross-ref: Slice 5, Slice 10.


### D64 Event-time-wins comparison uses a typed hot-table column, not JSONB `SETTLED` (landed by migration 0003)

**Decision.** Event-time-wins on `store_sku_current_position` (architecture 2.3.1: a
late-arriving older event must not overwrite newer state) needs a stored reference
event-time to compare against. The live hot table had only `last_updated_at` (write-time,
DB-generated), no source event-time column. The comparison timestamp is stored as a
first-class typed column `last_source_event_at TIMESTAMPTZ` on
`store_sku_current_position`; the upsert is conditional
(`DO UPDATE ... WHERE incoming source event ts >= stored ts`). This column landed on the
same prerequisite migration that resolves D38's event-table dedup columns
(`source_id`/`source_event_id`); it was a prerequisite for the Slice 10 build, not
authored under Slice 10 service code.

**Alternatives.** (1) Store the source event timestamp in the consumer-injected
`ingest_metadata` JSONB (no DDL). Rejected: a load-bearing correctness value belongs in a
typed column, not untyped JSONB; the no-DDL-in-slice rule means surface-and-register the
schema gap (as with D38), not route around it through JSONB. (2) Last-write-wins for v1.0:
unconditional update. Rejected: violates architecture 2.3.1.

**Why.** Event-time-wins is a hard architectural invariant; typing the comparison value
keeps it indexable and explicit and matches the project's typed-schema posture. The perf
delta versus JSONB is negligible at beta scale, so correctness-typing decides, not
performance.

**Prerequisite (discharged).** The migration adding `last_source_event_at` (with the D38
columns) — `alembic/versions/0003_canonical_dedup_event_time.py` (M-D38/D64) — landed and
was verified before the Slice 10 dual-write and event-time-wins proofs. NULL means never
event-written (e.g. pre-seeded catalogue rows); the column is nullable by design.

**Cross-ref.** D38 (shared prerequisite migration), D30, D33, architecture 2.3.1, Slice 10.


### D63 Sales for a first-seen SKU fail loud; catalogue/position onboards before sales `SETTLED`

**Decision.** When the streaming consumer processes a sale-event chunk for a SKU with no
existing `store_sku_current_position` hot row, the hot-table INSERT arm of the dual-write
cannot satisfy the hot-only NOT NULL catalogue columns (`product_name`,
`product_category`, `currency`, etc.). The v1.0 posture is fail loud: the NOT NULL
violation rolls back the whole batch (D30 either-or-neither), the chunk goes to the
minimal failure disposition (Slice 10), on to quarantine (Slice 11), and is replayed
(Slice 12) once catalogue/position has onboarded. No hot-side no-op or skip path is
introduced. This makes catalogue/position-before-sales a v1.0 onboarding-order invariant:
sales for an unseen SKU quarantine until that SKU's position data lands.

**Post-mapping validation projection.** The post-mapping canonical-shape suite validates
each event chunk against its per-event-model projection (sale: `current_retail_price`,
`unit_cost`, `currency`, `promo_identifier`, plus the natural-key triple), not one
monolithic all-columns canonical model, so a sale chunk is never failed merely for lacking
hot-only catalogue columns. The fail-loud is the genuine first-seen-SKU case, not a
validation artifact.

**Alternatives.** (1) Update-only for event chunks: ON CONFLICT update projected columns
when the hot row exists; when absent, insert the event row and record a hot-side no-op.
Rejected: invents a skip path the architecture does not describe and weakens the "both
land" reading of D30. (2) Defer to operator review. Resolved here instead.

**Why.** Faithful to the project-wide no-silent-fallback posture (code-quality rule 4) and
to architecture 2.3.2 (UPSERT unconditionally). The recovery path is already built (failure
disposition, quarantine, replay); first-seen-SKU sales are not lost, they wait.

**Tradeoff acknowledged.** A tenant that sends sales before onboarding catalogue/position
sees those sales quarantine until catalogue lands. A deliberate ordering constraint
surfaced to onboarding, not a silent drop.

**REVISED (service-amendment gate, operator-ratified): hot-row creation is
COMPLETENESS-gated, not event-type-gated.** PostgreSQL validates NOT NULL on the INSERT
candidate tuple BEFORE conflict arbitration (verified live, role-independent), so the
"INSERT arm fails NOT NULL" mechanism above cannot exist for event projections at all —
they can never ride an `INSERT … ON CONFLICT` statement, even for a seen SKU. The
ratified posture:

- The discriminator is derived from the live hot schema (NOT NULL + CHECK partition):
  the consumer injects `id`/`tenant_id`/`store_id`/`trace_id`/`tax_treatment`/
  `mapping_version_id`/`dis_channel` regardless of event; the projection must supply
  `sku_id` (the natural key, universal) plus `product_name`, `product_category`,
  `current_retail_price`, `unit_cost`, `currency`, honouring the presence-pairing CHECKs
  (`promo_identifier ⇒ promo_price`; expiry triple all-or-none). **Complete** = the
  assembled candidate satisfies every NOT NULL and CHECK, resolved PER MAPPING at load
  (`LoadedMapping.hot_complete`); value-level violations remain loud at write.
- **COMPLETE mapping** (none exists in production today; the future catalogue slice):
  the proven atomic `INSERT … ON CONFLICT (COALESCE key) DO UPDATE … WHERE
  event-time-wins` — creates or updates; the only path that inserts.
- **INCOMPLETE mapping** (every current path): one conditional UPDATE with the
  event-time-wins predicate; rowcount 0 → one READ-ONLY existence check → present =
  older-event no-op (audited); absent = a D63 miss. **The miss does not abort the batch
  transaction: the appended event rows COMMIT (history retained), then the sink raises
  loudly so the chunk nacks toward quarantine (Slice 11).** No INSERT exists on this
  path under any concurrency. Redelivery re-appends events (read-time dedup absorbs)
  until catalogue/position onboards, then the merge succeeds.

The original "rolls back the whole batch" wording above is superseded for the
first-seen case: a D63 miss is a defined disposition (history retained, hot pending),
not a write failure; genuine in-transaction failures (CHECKs, partitions, infra) still
roll back both sides (D30 unchanged).

**Cross-ref.** D30, D33, D58 split, D64, M-HOTKEY/0004, Slice 10 (the completeness
classification + two-path merge), Slice 11 (quarantine), Slice 12 (replay).


### D65 Id-less-source `source_event_id` fallback is redelivery-stable, NOT correction-collapsing `SETTLED` (limitation registered)

**Decision.** When a source supplies no native event identifier — all change events (the
live schema carries no source event-id column for them) and any sale row missing
`transaction_id`/`line_item_seq` — the consumer derives
`source_event_id = bronze_ref || ':' || chunk_row_index`. Properties, stated plainly:

- **Redelivery dedups:** the same `ingress.ready` redelivered re-reads the same bronze
  object, so each row reproduces its `source_event_id` and the D33 window collapses the
  replay at read.
- **A re-uploaded correction does NOT collapse:** a corrected file is a new bronze object,
  so its rows carry different keys; two distinct events survive the read-time window for
  these sources. The hot table still converges (event-time-wins, D64), so current truth is
  correct; the event-history read shows both rows.
- This is the honest semantics when a source asserts no event identity — DIS does not
  invent correlation the source never claimed.

**Trigger to revisit.** A concrete source that supplies no native event id but requires
correction-collapse at the event-history read.

**Evidence.** `services/streaming-consumer/tests/integration/test_read_time_dedup.py::test_idless_correction_documented`
proves the accepted behavior (a distinct-bronze correction yields two non-collapsing
events; hot converges).

**Cross-ref.** D33, D38, D64, Slice 10.

### D66 csv-ingest-worker bronze dedup is single-instance-safe only — PARKED, resume after dis-ui-server

**Status.** OPEN, parked. This is D58 split-(b), promoted to its own entry so it is not
lost inside the D58 retraction note. Surfaced during Slice 10 when D58's single-instance
assumption was retracted for the streaming consumer (autoscaling posture).

**The gap.** The csv-ingest-worker (Slice 9b) enforces bronze idempotency with a 24h
query-based check-then-act (SELECT for a prior bronze row within the window; if none, write
the bronze row and publish ingress.ready; resume-and-mark on an unpublished prior). This was
explicitly safe only under the single-worker assumption (D58). With single-instance
retracted, if the WORKER autoscales, two instances can both run the SELECT, both see no
prior, and both write a bronze row and both publish ingress.ready.

**Severity (as currently understood, not yet verified).** Likely waste, not corruption: the
streaming consumer's read-time dedup (D33) plus redelivery-stable keys (D65) should absorb a
duplicate ingress.ready downstream, so canonical truth converges. The cost is duplicate
bronze rows, duplicate publishes, double-processing, and a messy audit trail under
concurrency. Confirm this severity when resuming; do not assume the downstream absorption is
complete without checking the duplicate's path.

**This is NOT the canonical hot-key problem.** The Slice 10 fix (M-HOTKEY: COALESCE-sentinel
arbiter index for a nullable composite natural key defeating PG15 ON CONFLICT) does NOT
transfer here. The worker's issue is query-based idempotency (a check-then-act race), not
NULLS-NOT-DISTINCT arbitration. Different mechanism, different fix.

**First task when resuming (all derive-from-live, plan mode).** Introspect
bronze.data_ingress_events: what the dedup key actually is, whether any UNIQUE constraint
exists on it, and exactly how the worker's 24h-window query + resume-and-mark is coded. Only
then choose the fix.

**Candidate fixes (no choice made here).**
1. Add a UNIQUE constraint on the bronze dedup key so a second concurrent write fails loud —
   the database backstop the canonical path got via uq_sscp_natural_key. Likely needs its
   own migration.
2. Advisory lock on the dedup key around the check-then-act, so concurrent workers serialize
   on the same key.
3. Accept the duplicate at the worker and lean entirely on the consumer's D33 read-time
   dedup to absorb it — cheapest, but duplicate bronze rows and duplicate publishes become
   normal under autoscale (audit/cost consequence).

**Scope when taken up.** A worker-hardening slice of its own (touches the shipped, pushed
csv-ingest-worker — plan→approve→execute→gate, and a migration gate of its own if fix 1).
Trigger: before the worker is deployed with >1 instance OR autoscaling is enabled for it.
Sequencing: parked behind the dis-ui-server service work.

**Cross-ref.** D58 (retraction + split), D5 (bronze recoverable source), D33/D65 (downstream
absorption), M-HOTKEY/Slice 10 (the DIFFERENT problem this is not), Slice 9b (the worker).

### Slice 10 register notes: D42 and D60 closed; carried limits named `RESOLVED/CARRIED`

**D42 → RESOLVED (the `event_data` JSONB path; no DDL).** A dedup-key hit emits a
ROW-scoped `CANONICAL_WRITTEN` audit event with `outcome = SUCCESS` (the append-only
insert genuinely landed; the live CHECK vocabulary is honoured) and the duplicate detail
in `event_data`: `{"duplicate": "DUPLICATE_NOOP"|"DUPLICATE_OVERWRITTEN",
"prior_trace_id", "row_hash", "dedup_key": {store_id, source_id, source_event_id}}`.
`row_hash` is sha256 over the orjson-serialized, key-sorted mapping-produced payload.
NOOP-versus-OVERWRITTEN is decided by comparing the new row's hash against the prior
latest row's payload re-hashed the same way. **Carried, not addressed:** the drift-guard
type-narrowing limit (a narrowed column type passes dis-audit's name-set match and is
caught only at INSERT, then swallowed by fire-and-forget) — fixing it means per-column
type reconciliation in `libs/dis-audit`, outside Slice 10's blast radius; trigger: the
next slice touching the dis-audit reconciliation. **Also registered:** dis-audit's closed
`Stage` enum has no consumer-fetch member; intake+fetch audit under `RECEIVED`
(`service_name` disambiguates); `IDENTITY_VALIDATED` is never emitted (no identity call
exists, D28).

**D60 → RESOLVED (STRIKE).** The "Used as the Pub/Sub ordering key." sentence is struck
from `tenant_id` in BOTH `contracts/pubsub/csv.received.schema.json` and
`ingress.ready.schema.json` (description-only; `schema_version` stays 1, the
never-deployed-draft posture per D52; the 9b drift guards compare field sets, not
descriptions — verified, no producer/consumer/test code change). Why strike, not
implement: no correctness property needs ordering (canonical truth is event-time-based —
D33 read-time dedup, D64 event-time-wins; the redelivery and out-of-order proofs in the
Slice 10 suite pass without it); implementing would amend a shipped service (9b's
publisher), require ordering-enabled subscriptions, and accept per-key serialized publish
throughput for a guarantee the worker hop (nack/redelivery, D59 resume) already breaks.
A regression test asserts neither contract mentions an ordering key.

**PG15 ON CONFLICT limitation (Slice 10 implementation note on D64; D30 NOT reopened).**
Verified empirically on the live 15.17: an ON CONFLICT arbiter over the NULLS NOT DISTINCT
hot natural key does NOT detect a conflict when key values are NULL (both the column-list
and ON CONSTRAINT forms take the INSERT arm); the NND unique index still enforces
uniqueness on write. The D64 conditional upsert is therefore implemented as a conditional
UPDATE (`IS NOT DISTINCT FROM` key predicate + the event-time-wins condition), an
existence check, then a plain INSERT — all three statements INSIDE the same per-batch
`rls_session` transaction as the event-table insert, so D30's either-or-neither holds
unchanged at the batch grain (this note changes the upsert MECHANISM only, never the
transaction boundary or D30 itself). Concurrency rests on the v1.0
single-consumer-instance assumption (the D58 posture family); a racing duplicate still
hits the unique index (`uq_sscp_natural` enforcement with NULL segments is proven on the
live engine by `test_nnd_unique_index_enforces_on_null_segments`; the CONCURRENT
two-transaction variant was demonstrated live in the Slice 10 adversarial pass — the
second writer blocks on the speculative index entry, raises on the first's commit, and
rolls back whole, one row surviving), fails the batch loudly, rolls back whole, and
redelivery converges — never a silent double-write. **The single-instance assumption is
UNENFORCED at runtime:** no deploy config, lock, or subscription setting limits the
consumer to one instance (a Pub/Sub subscription actively permits many pullers), and
Slice 10 deliberately adds no deploy config. It is a DEPLOY-TIME OBLIGATION owned by the
slice that first deploys or horizontally scales the consumer (the reserved `deploy/`
tree): max-one-instance, or revisit this note and D58 together with a real concurrency
guard. Until then a second instance degrades safely (loud batch failures + redelivery),
never silently.

**SUPERSEDED (M-HOTKEY/0004 + the completeness-gated two-path merge — see the D58 split
entry and REVISED D63).** The deployment posture is autoscaling, so the read-modify-write
mechanism this note describes is RETIRED. Migration 0004 replaced `uq_sscp_natural` with
the COALESCE-sentinel arbiter index `uq_sscp_natural_key` (+ sentinel CHECKs), restoring
`INSERT … ON CONFLICT DO UPDATE` arbitration for all key shapes including NULL segments.
A second live finding then shaped the service side: **PostgreSQL validates NOT NULL on
the INSERT candidate BEFORE arbitration**, so only a COMPLETE candidate may ride the
ON CONFLICT statement. The Slice 10 service amendment therefore implements the
completeness-gated two-path merge (REVISED D63): complete mappings (future catalogue
path) use the proven atomic ON CONFLICT statement; incomplete mappings (all current
paths) use a conditional UPDATE whose rowcount-0 case is a READ-ONLY check → older-event
no-op or a D63 miss (event history committed, loud raise after) — NO INSERT exists on
the incomplete path, so the create-race that doomed the read-modify-write cannot occur.
Both paths: per-batch sorted-key order, one rls_session transaction (D30 unchanged),
EvalPlanQual re-evaluation of the event-time-wins predicate against the locked current
row (D64 unchanged, concurrency-proven per path). The deploy-time single-instance
obligation above is RESCINDED for streaming-consumer ONLY; a
single-instance-or-fixed-dedup obligation attaches to csv-ingest-worker instead (the
D58 split entry, item (b)). `test_nnd_unique_index_enforces_on_null_segments` retires
with the mechanism it proved.

**Carried scope limits (Slice 10).** (1) Non-NULL `pre/post_validation_suite_ref`
(`module:ClassName`) is unsupported — raises `SuiteDefinitionError`; NULL=default is the
only live state; trigger: the first mapping needing an authored suite. (2) `mapping.changed`
event-driven refresh deferred (D6): the mapping read is per-lookup, zero-staleness;
trigger: measured per-chunk SELECT cost or an operator latency requirement. (3) Within-batch
dedup-key repeats are not flagged as duplicates in audit — the duplicate-detect SELECT
reads only PRIOR COMMITTED rows, so two same-key rows inside ONE batch both insert
(append-only, correct) with no DUPLICATE_* ROW event between them; the audit duplicate
rate therefore undercounts within-file repeats that land in the same ≤500-row batch.
Bounded: cross-BATCH repeats within one chunk ARE flagged (each batch commits before the
next opens), and the read-time window still collapses within-batch peers (identical
transaction-stable `last_updated_at`; the uuidv7 `id DESC` tie-break makes the LAST-built
row the survivor, deterministically). Hot-side within-batch natural-key repeats carry no
such gap at all: `_group_hot` merges them in memory before any SQL, exactly one
UPDATE-or-INSERT per key per batch — no NND collision, no silent overwrite (column-scoped
event-time-wins applied in the merge). (4) The rolling event-partition creator remains a registered gap
(M-D38/D64 gate); out-of-window writes error loudly (no DEFAULT partition) into the
failure disposition. (5) A `StreamingConsumerError` family in dis-core is a registered
want (the service reuses `DisError`/`EventContractError`/`EventPathMismatchError`;
dis-core was outside the slice blast radius); trigger: the next dis-core-touching slice.
(6) `CHANGE_HOT_PROJECTION` has NO register anchor: the change-event
`(event_category, attribute_name) → hot column` pairs (PRICE/current_retail_price,
COST/unit_cost, INVENTORY/stock_qty, CATALOGUE/product_name, STATUS/sku_status) are a
consumer convention authored in `pipeline/mapping.py` — unlike the sale projection,
which D63 pins. End-to-end exercised only for `(INVENTORY, stock_qty)`; the other four
are registry-image-asserted only, and a unit test enforces that every pair is an
IDENTITY mapping (attribute X → hot column X), so a typo'd pair fails loudly rather
than mis-routing an UPDATE. Owner of the anchor: the first slice with an independent
reader of the registry (the quarantine console, Slice 11, or mapping authoring,
Slice 14) registers or amends the pairs. (7) **Production enablement of the complete
create-path:** no current production mapping carries the catalogue NOT NULL columns
(`product_name`, `product_category`, …), so every live source classifies INCOMPLETE
and hot-row creation is unreachable in production today — the mechanism is built
(REVISED D63), the enablement is not. Enablement = a source authored to carry the
discriminating columns (with registry/routing support for catalogue targets) or a
revisit of the hot NOT NULL set; owner: onboarding / Slice 14.

**Cross-ref.** D30, D33, D38, D42, D44, D58, D60, D63, D64, D65, Slice 10/11.


### D58 single-instance posture under autoscaling: SPLIT (M-HOTKEY) — consumer SOLVED; worker bronze dedup a NOW-LIVE OPEN gap

**Posture change.** The deployment posture is AUTOSCALING (multiple instances per
service). The single-instance operating assumption D58 recorded is therefore no longer a
tolerable footing anywhere it is load-bearing. This entry SPLITS the assumption's two
dependents — it is deliberately NOT a clean "D58 retracted":

**(a) streaming-consumer hot path — SOLVED.** Migration `0004_hot_natural_key_arbitration`
(M-HOTKEY) replaces the NULLS NOT DISTINCT natural-key constraint (which PG15 cannot
arbitrate for NULL key segments — the limitation that had forced a single-instance-only
read-modify-write upsert) with the unique COALESCE-sentinel expression index
`uq_sscp_natural_key` plus two sentinel CHECKs (`sku_variant <> ''`,
`sku_lot_batch <> ''`; the empty string is operator-confirmed never legitimate and is now
engine-impossible). Atomic `INSERT … ON CONFLICT (COALESCE target) DO UPDATE … WHERE
event-time-wins` is thereby restored and is concurrency-safe under N instances — proven
on live 15.17 with two real concurrent writers: the insert-race loser takes the UPDATE
branch (no error surfaces); the `DO UPDATE … WHERE` predicate re-evaluates against the
LOCKED current row, so an older event can never overwrite a newer one in either arrival
order; deadlocks from overlapping batches are eliminated by the deterministic per-batch
natural-key sort (demonstrated: opposite-order interleave deadlocks, total-order commits).
The Slice 10 service amendment swaps the upsert mechanism accordingly.

**(b) csv-ingest-worker bronze dedup — NOW-LIVE OPEN gap.** D58's original subject: the
worker's idempotency check is a query (no UNIQUE over the dedup key, no concurrency
guard) and is single-instance-safe ONLY. Under the autoscaling posture this is no longer
a forward-looking note — it is a live exposure the moment the worker runs with more than
one instance: two concurrent identical deliveries can both pass the SELECT and
double-write bronze. **Status: OPEN. Owner: a worker-hardening slice. Trigger: the
csv-ingest-worker is deployed with >1 instance, or autoscaling is enabled for it.** Until
then the worker carries a single-instance-or-fixed-dedup deploy obligation (below). The
consumer fix in (a) does NOT cover this; system-wide autoscaling is not handled by this
entry.

**Deploy obligations restated.** The single-instance deploy-time obligation previously
recorded against the streaming consumer (the Slice 10 adversarial pass) is **RESCINDED
for streaming-consumer ONLY** — its hot path is concurrency-safe by (a). A
single-instance-or-fixed-dedup obligation now attaches to **csv-ingest-worker** per (b).
"Rescinded" does not mean "no instance constraint anywhere."

**Cross-refs.** D58 (the original assumption; its bronze posture is the (b) gap), D30
(transaction boundary unchanged), D63/D64 (semantics unchanged, now concurrency-proven),
the PG15 implementation note (superseded — see its addendum), M-HOTKEY/0004, Slice 10
Part 3.

### D67 dis-ui-server uses the SQLAlchemy ORM/declarative layer; other services use Core/text `RESOLVED`

**Status.** `RESOLVED` (Slice 13a, registered in plan mode, number assigned at the commit
gate).

**Decision.** dis-ui-server uses SQLAlchemy's ORM/declarative layer, justified by its CRUD
and system-of-record nature (`config.source_mappings` and later mapping/onboarding writes),
where the stream/transform/worker services use Core/text. Load-bearing constraint: every
ORM model executes only through the dis-rls `rls_session` (hard rule 1), never a raw
`AsyncSession` or a second engine. The layer choice is the deviation; the through-dis-rls
constraint is what preserves the foundation rule.

**Cross-refs.** D26 (BFF), hard rule 1 (RLS via dis-rls). **Scope.** dis-ui-server + this
entry; no DDL.

### D68 config.source_mappings mapping grain is (tenant_id, source_id, template_id) `RESOLVED`

**Status.** `RESOLVED` (Slice 14a, registered in plan mode, number assigned at the commit
gate).

**Decision.** A `(tenant_id, source_id)` source carries multiple named mapping templates
(e.g. `manual_csv_upload` carrying sales, inventory, pricing); the mapping grain becomes
`(tenant_id, source_id, template_id)`. `template_id` (UUIDv7, minted server-side at DRAFT
creation, immutable once set) is a grain dimension, NOT a primary key: `mapping_version_id`
stays the global BIGSERIAL surrogate, the canonical-row pin, and the audit reference (D22
unchanged). `template_name` is the operator-set human label, unique per
`(tenant_id, source_id)` among non-DEPRECATED rows; active-uniqueness and the version
sequence (`version_seq_per_source`, name kept to avoid contract churn) are rekeyed to the
template grain, each template's lineage starting at 1. Pre-14a rows were backfilled with
one minted template per `(tenant, source)` group, named `default` (lineage preserved,
never per-row minting).

**Cross-refs.** D15 (mapping config in Postgres, versioned), D17 (staged-rollout lifecycle
the grain keys respect), D22 (pin unchanged), D49 (`mapping_rules` shape untouched), D69
(RLS ON on the same table). **Scope.** Alembic 0005 + the `schemas/postgres` manifest; no
service code. Owed downstream: the Slice 10 template-keyed consumer lookup
(`load_active_mapping` takes `.first()` and must key on template before any second
template goes ACTIVE under one source), the Slice 8 upload-session template carry, the
Slice 14b per-template `version`/`active_version` contract surfacing and the label's
template component.

### D69 config.source_mappings RLS ON (ENABLE + FORCE, single-GUC tenant policy) `RESOLVED`

**Status.** `RESOLVED` (Slice 14a, registered in plan mode, number assigned at the commit
gate).

**Decision.** `config.source_mappings` carries `tenant_id` and its rows are per-tenant
data, so it follows the DIS principle (RLS ON wherever `tenant_id` exists): ENABLE + FORCE
with the same single-GUC `app.tenant_id` `tenant_isolation` policy as the other DIS tenant
tables. The prior DDL comment ("holds configuration, not tenant data", with a claimed
cross-tenant startup read) is corrected — the live consumer reads the mapping per-lookup
inside a tenant-scoped `rls_session` (D6 side input), so no cross-tenant read exists. The
two-GUC `app.user_type` pattern remains Customer-Master-replica-only. Riders, decided with
this entry: (1) the `btree_gist` extension is added for the EXCLUDE name-uniqueness
constraint (`ex_csm_template_name_per_source`; a plain unique index cannot express
name-to-template uniqueness because version rows of one template share a name); (2)
`config.source_mappings_v` is set `security_invoker = true`, closing the owner-rights RLS
bypass (verified live: the only view in the database, zero SECURITY DEFINER functions);
(3) the test-infra updates (seeder GUC scoping, pinned fixture template, consumer conftest,
seed tests) were a necessary consequence of RLS-ON — a scope clarification of
"schema-only", not row-write scope creep.

**Cross-refs.** D68 (the grain on the same table), D24/hard rule 1 (isolation posture),
D6 (consumer side-input read). **Scope.** Alembic 0005 + the `schemas/postgres` manifest +
the dis-testing/consumer test infra; no service code, no policy change on any other table.
