# `services/dis-ui-server/` — *v1.0*

The single backend-for-frontend (BFF) for the DIS UI. Per-sub-module handlers; one Customer Master auth integration; never writes to canonical.

**Purpose.** Serve every read and write that the DIS UI needs, on behalf of authenticated users, with one auth integration and one URL the UI calls. Also host the in-process onboarding sub-module (inference, suggestion, validation_draft, shadow) that was previously a separate service.

**Entry (service-wide).**
- Trigger: HTTP request from DIS UI.
- Inputs: bearer token (Customer Master-issued), path-based handler routing, body or query params per handler.
- Preconditions: token signature valid; claims include `tenant_id` for tenant-scoped handlers; ops role required for ops-only handlers (DuckDB query panel).

**Process (per handler).** dis-ui-server has seven distinct surfaces; each handler has its own EPE. Common-process steps (Customer Master JWT verification, `tenant_id` scoping, FastAPI dependency injection of repos and clients) are applied uniformly.

- **`sample_upload`.** Entry: POST sample from §5 ui for source onboarding. Process: store sample in GCS onboarding-staging path via `dis-storage`; invoke in-process `onboarding/inference` (DuckDB schema inference) and `onboarding/suggestion` (mapping + normalization proposal) and `onboarding/validation_draft` (suite proposals); return draft mapping. Exit: 2xx with `{draft_mapping_id, inferred_schema, proposed_validation_suites}`. Failures: 400 (sample malformed), 422 (inference cannot proceed), 500 (DuckDB error).
- **`onboarding_review`.** Entry: GET/PUT from §5 ui for the operator review surface. Process: read/write `config.source_mappings` rows with `status='staged'`; coordinate dry-run renders against the sample; on approval transition `staged → active` (with shadow-rollout coordination via `onboarding/shadow`). On active transition, publishes `mapping.changed` Pub/Sub for §3.7 streaming-consumer side-input refresh. Exit: 2xx with mapping state. Failures: 403 (not authorized for tenant), 404 (mapping not found), 409 (concurrent edit).
- **`mapping_crud`.** Entry: GET/POST/PUT/DELETE from §5 ui for `config.source_mappings`. Process: read or write via repo; new versions on edit (does not modify prior versions); deprecate sets status. Active-status writes publish `mapping.changed` for §3.7 streaming-consumer cache refresh. Exit: 2xx; mapping rows reflect change. Failures: 403, 404, 409.
- **`quarantine`.** Entry: GET from §5 ui for quarantine views (tenant slice and ops slice). Process: query `quarantine.*` tables (populated by §3.8 quarantine-drainer) via repo, scoped by tenant for tenant slice or cross-tenant for ops role; format failure context including suite-failure links; offer resubmit via Pub/Sub `ingress.resubmit` on demand (consumed by §3.7 streaming-consumer). Exit: 2xx with quarantine rows. Failures: 403, 500 (DB unavailable).
- **`audit`.** Entry: GET from §5 ui for audit lookup by trace_id, tenant, store, or time range. Process: query BigQuery `audit_events` table (populated by every service that emits audit events) via the audit repo; scope by tenant; return results. Exit: 2xx. Failures: 403, 500 (BQ unavailable).
- **`duckdb_query`.** Entry: POST ad-hoc SQL + GCS bronze URI (ops role only) from §5 ui. Process: validate the role; run the query via in-process DuckDB against GCS bronze objects (written by §§3.1, 4.2, 4.3, 4.4 receivers); return results. Exit: 2xx with rows. Failures: 403 (not ops), 400 (invalid SQL or URI), 500 (DuckDB execution error), 504 (timeout, configurable cap).
- **`auth`.** Entry: handled as a FastAPI dependency on every protected handler (not its own endpoint). Process: validate JWT signature against Customer Master JWKS; extract claims; populate request-scoped `Identity` object. Exit: identity available to downstream handler, or 401 on failure.

**Exit (service-wide).**
- Success: HTTP 2xx per handler. Writes (only via `mapping_crud`, `onboarding_review`, and resubmit triggers in `quarantine`) commit to `config.source_mappings` or publish to `ingress.resubmit` or `mapping.changed` Pub/Sub. Reads return data scoped by tenant.
- Failure modes handled: per-handler as above; cross-cutting failure (token expired, downstream DB unavailable) handled by FastAPI middleware and returned as standard error envelope.
- Failure modes propagated: data-plane failures (mapping that fails at runtime in §3 streaming consumer) are not dis-ui-server's concern; surfaced via quarantine handler later.
- Edge case: token expires mid-request — the §5 ui is responsible for refresh; dis-ui-server returns 401 and the UI retries after refresh.


```
services/dis-ui-server/
├── CLAUDE.md
├── README.md
├── pyproject.toml
├── Dockerfile
├── .dockerignore
│
├── src/
│   └── dis_ui_server/
│       ├── __init__.py
│       ├── main.py             # HTTP server entrypoint (FastAPI)
│       ├── config.py
│       │
│       ├── auth/               # Customer Master token validation
│       │   ├── __init__.py
│       │   ├── verifier.py     # JWT signature + claims validation
│       │   └── scope.py        # tenant_id extraction + RBAC enforcement
│       │
│       ├── handlers/           # one per DIS UI sub-module (FastAPI routers)
│       │   ├── __init__.py
│       │   ├── sample_upload.py
│       │   ├── onboarding_review.py
│       │   ├── mapping_crud.py
│       │   ├── quarantine.py
│       │   ├── audit.py
│       │   └── duckdb_query.py
│       │
│       ├── onboarding/         # merged from former onboarding-service
│       │   ├── __init__.py
│       │   ├── inference/      # Layer 1: schema inference (DuckDB-driven)
│       │   │   ├── __init__.py
│       │   │   ├── duckdb_describe.py
│       │   │   ├── type_sniff.py
│       │   │   └── null_profile.py
│       │   ├── suggestion/     # Layer 2: mapping + normalization suggestion
│       │   │   ├── __init__.py
│       │   │   ├── name_match.py
│       │   │   ├── value_match.py
│       │   │   ├── historical.py
│       │   │   └── normalize_rules.py
│       │   ├── validation_draft/   # Layer 3: validation suite proposals
│       │   │   ├── __init__.py
│       │   │   ├── source_shape.py
│       │   │   └── canonical_shape.py
│       │   └── shadow/         # shadow rollout coordination
│       │       ├── __init__.py
│       │       └── compare.py
│       │
│       ├── repos/              # read-side data access (one per data source)
│       │   ├── __init__.py
│       │   ├── canonical_replica.py    # reads from Cloud SQL read replica
│       │   ├── config.py               # config.source_mappings CRUD
│       │   ├── quarantine.py           # quarantine.* table queries
│       │   └── audit_bq.py             # BigQuery audit_events queries
│       │
│       ├── duckdb_runner/      # ad-hoc query panel (ops-restricted)
│       │   ├── __init__.py
│       │   └── runner.py
│       │
│       └── clients/
│           ├── __init__.py
│           └── customer_master.py
│
├── tests/
│   ├── unit/
│   │   ├── test_auth.py
│   │   ├── test_scope.py
│   │   ├── test_handlers.py
│   │   ├── test_repos.py
│   │   ├── test_inference.py
│   │   ├── test_name_match.py
│   │   ├── test_normalize_rules.py
│   │   └── test_validation_draft.py
│   ├── integration/
│   │   ├── conftest.py
│   │   ├── test_mapping_crud.py
│   │   ├── test_quarantine_views.py
│   │   ├── test_audit_lookup.py
│   │   ├── test_duckdb_panel.py
│   │   ├── test_tenant_scope_enforcement.py
│   │   ├── test_onboarding_full_pipeline.py
│   │   ├── test_promote_staged.py
│   │   └── test_shadow_compare.py
│   └── fixtures/
│       ├── tokens/             # signed Customer Master tokens for tests
│       ├── canonical_seeds/
│       ├── samples/            # sample CSVs from known source types
│       └── golden_mappings/    # expected mapping outputs for review
│
├── scripts/
│   ├── run-local.sh
│   ├── curl-handler.sh
│   └── analyze-sample.py       # one-shot CLI analyzer for debugging
│
└── deploy/
    ├── service.yaml
    ├── configmap.yaml
    └── README.md
```

**Why `auth/` is here despite Customer Master owning auth.** This service receives Customer Master tokens and must verify them (signature, expiry, claims) before scoping. Verifying ≠ resolving; this service does verify but does not re-authenticate. The distinction matters.

**Why `handlers/` are thin FastAPI routers.** Each file is an `APIRouter` exposing one sub-module's endpoints; `main.py` mounts them. Handlers delegate to either `repos/` (for read-dominant operations like quarantine views) or to `onboarding/` (for sample analysis and shadow rollout). They contain no business logic of their own.

**Why `onboarding/` lives inside this service.** Earlier drafts had `services/onboarding-service/` as a separate process called by dis-ui-server. Reconsidered: dis-ui-server was the only caller, the CPU profile of sample inference does not warrant process isolation, and the architecture v0.5 decision chose a single BFF over per-domain APIs. The internal structure (inference / suggestion / validation_draft / shadow) is preserved as folders, not as a separate service. If onboarding work later blocks BFF latency in production, the sub-module is designed for clean extraction into its own service in a single refactor.

**Why `repos/` instead of `sinks/`.** Sinks are write-side (emit to a sink). Repos are read-side (read from a source). The dis-ui-server read surface (canonical replica, config, quarantine, audit) is repo-shaped; injected via FastAPI `Depends()`. Write paths (mapping CRUD into `config.source_mappings`, staged-to-active promotion) go through the same repos.

**Why `duckdb_runner/` is its own folder.** Ops-restricted ad-hoc SQL execution is a security-sensitive surface. Isolating it makes the auth gate explicit (this handler requires ops role) and makes the runner separately auditable.

**Why `clients/` has Customer Master only.** Removed `onboarding_service.py` (was the client to the standalone service; not needed now that onboarding is in-process). `auth/` does token verification (offline JWT validation); `clients/customer_master.py` is for any *online* calls to Customer Master (key rotation fetch, etc.). Different concerns; the verifier does not need the client.

**What's deliberately not here.** No data-plane logic. No mapping execution at runtime (that lives in the streaming consumer; this service handles only the *authoring* surface). No canonical writes. No Pub/Sub message handling. This service is the UI's read-and-narrow-write surface plus the onboarding authoring backend; everything else lives in the headless data-plane services.

---
