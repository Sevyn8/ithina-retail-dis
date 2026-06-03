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

**Schema gap (see D38, OPEN).** The dedup key named above (`source_id`, `source_event_id`) does **not** map to columns that exist in the applied canonical schema. This divergence is registered as D38 and must be resolved before Slice 10 builds the read-time dedup.


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

### D37 External identity IDs (`t_*`/`s_*`) vs internal UUID keys — translation location undefined `OPEN`

**Status.** `OPEN`. This entry records an open decision; it does **not** resolve it. Raised during Slice 2 (see the Slice 2 plan §2 / R1). **Hard deadline: before Slice 7 (Mirror Sync) begins.**

**The gap.** The frozen identity-service OpenAPI and the `identity.changed` Pub/Sub schema expose tenants and stores as external string identifiers — `^t_[a-z0-9]{12}$` / `^s_[a-z0-9]{12}$`. The DIS schema (Slice 1) keys `identity_mirror.tenants`, `identity_mirror.stores`, and all `canonical.*` / `config.source_mappings.tenant_id` by 128-bit `UUID` (UUIDv7, "mirrors `platform_db.core.*.id`"). A 12-char base36 string (~62 bits) cannot encode a 128-bit UUID, so these are two distinct identifier spaces. No column, encoding, or layer maps one to the other anywhere in the schema, the contracts, or this register (D1–D36).

**Interim (Slice 2, not the resolution).** Slice 2's test fixture set (`dis_testing.fixtures`) pins a deterministic external↔UUID pairing as a **test-only bridge**, so tests can resolve identity (external ids) and then read the seeded UUID-keyed rows. This bridge is test infrastructure; it is explicitly **not** the production mechanism and must not become it.

**Candidate resolutions (no choice made here).**
1. Add an `external_id` column (`t_*` / `s_*`) to `identity_mirror.tenants` / `identity_mirror.stores`, indexed, populated by the mirror sync.
2. Define a deterministic, reversible encoding between the internal UUID and the external `t_*` / `s_*` form.
3. A translation layer (identity-service and/or mirror-sync owns the external↔internal map).

**Why it must be settled by Slice 7.** Slice 7 (Mirror Sync, DB-pull) writes *real* Customer Master records into the UUID-keyed `identity_mirror`. Real records carry both representations and there is no fixture bridge in production — Slice 7 needs the actual translation to land rows whose external ids match what receivers and the streaming consumer resolve. The fixture bridge cannot carry Slice 7.

---

### D38 Event-table dedup key names columns absent from the applied schema — `OPEN`

**Status.** `OPEN`. This entry records a schema-vs-decision divergence; it does **not** resolve it. Surfaced during Slice 3 (dis-canonical models, by live-schema introspection of `ithina_dis_db`). **Hard deadline: before Slice 10 (streaming consumer happy path) begins.**

**The gap.** D33 and CLAUDE.md hard rule 7 define the event-table "same source event" dedup key, applied latest-wins at read time, as `(tenant_id, store_id, source_id, source_event_id)`. Introspection of the applied canonical schema shows **neither `source_id` nor `source_event_id` exists** on `canonical.store_sku_sale_events` or `canonical.store_sku_change_events` (nor on any canonical table). The only source-related columns present are `source_sale_timestamp` / `source_event_timestamp` (timestamps, not ids), `transaction_id` and `line_item_seq` (sale events only), and `related_sale_event_id`. The event tables carry no UNIQUE constraint (correctly, per D33's append-only posture), so nothing in the schema pins the key either. As written, the D33 / rule-7 `ROW_NUMBER() OVER (PARTITION BY tenant_id, store_id, source_id, source_event_id ...)` window cannot be computed from existing columns.

**Not a dis-canonical defect.** The Slice 3 models mirror the applied schema exactly (verified by an independent column-set reconciliation, both directions, all four tables). The divergence is between the decision text and the migration that was applied (Slice 1), not in the Python models.

**Candidate resolutions (no choice made here).**
1. Add `source_id` and `source_event_id` columns to both event tables via an Alembic migration, populated by the streaming consumer from the mapping; the dedup key then maps literally.
2. Redefine the dedup key against columns that already exist (e.g. a per-source `transaction_id` plus a source discriminator), and amend D33 / rule 7 to match.
3. Carry the source identifiers inside `ingest_metadata` (jsonb) and compute the key from there (weaker — not indexable, not a first-class column).

**Why it must be settled by Slice 10.** Slice 10 builds the streaming consumer's atomic dual-write and the read-time latest-wins semantics depend on this key. Either the columns must exist (option 1) or the key must be redefined (option 2) before that code is written; otherwise the consumer cannot implement D33 as specified. Do not edit the DDL or the rule wording under Slice 3 — this entry only registers the gap. Cross-referenced from D33.

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

### D41 `identity_mirror` RLS posture: build-guide vs applied schema `OPEN`

**Status.** `OPEN`. Records a doc-vs-schema contradiction surfaced during Slice 4 (`dis-rls`) by live introspection of `ithina_dis_db`; it does **not** resolve it. **Hard deadline: before Slice 7 (Mirror Sync) begins.**

**The gap.** `build-guide.md:108` (Slice 7) states "`identity_mirror` is RLS-protected" and asks plan-mode to choose between setting `app.tenant_id` per-row on upsert vs running Mirror Sync under a distinct role. But live introspection shows `identity_mirror.tenants` and `identity_mirror.stores` have **`relrowsecurity = false` and no policy** — consistent with the Slice 1/2 findings and the seeder's own comment that it writes to RLS-not-enabled schemas. So either the schema must gain RLS (a migration) or the build-guide text must drop the "RLS-protected" claim.

**Evidence (introspected, `ithina_dis_db`).** `pg_class.relrowsecurity = f` and `relforcerowsecurity = f` for `identity_mirror.tenants` and `identity_mirror.stores`; `pg_policies` has no rows for schema `identity_mirror`. (Contrast: `bronze.data_ingress_events` and `canonical.*` are `relrowsecurity = t, relforcerowsecurity = t` with a `tenant_isolation` policy.)

**Why Slice 7.** Mirror Sync writes real tenants/stores into `identity_mirror`; its upsert path and role posture depend on whether RLS is in force there. Resolve before that code is written. Do not edit the DDL or the build-guide under Slice 4 — this entry only registers the contradiction. **Scope.** Docs only. Relates to hard rule 1 / D12.
