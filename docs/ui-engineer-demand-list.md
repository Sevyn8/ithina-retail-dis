# DIS UI engineer demand list (dis-ui-server endpoints)

**Status:** RECONSTRUCTION, v0.2, 2026-06-03. The original demand list was lost (never committed; authored in-chat). This is a faithful rebuild, not the original.

**Provenance.** Synthesized from in-repo and recovered sources:
- the DIS UI Surface Map v1.0 (per-screen endpoint dependencies, data, and actions),
- the recovered `openapi-dis-ui-backend.yaml` v0.1.0 conventions and the onboarding shapes (the only shapes recovered verbatim),
- `docs/architecture.md` section 4.17 (the dis-ui-server handler set),
- the slice 19 `GET /me` shape (`services/dis-ui/src/lib/dis-ui-server/`).

**Every request and response shape here is PROVISIONAL** unless marked RECOVERED. The canonical sources to reconcile against are the original OpenAPI spec if it resurfaces and `docs/decisions.md` D25 (Customer Master claim vocabulary, still open). Where the surface map used older paths (`POST /uploads`), this doc uses the recovered `/v1/` convention.

**Naming note.** The BFF was `dis-api` in the surface map and the recovered spec; it is now `dis-ui-server` (commit `4c6a044`). Paths are unchanged; the service name is updated here.

---

## 0. Conventions

- **Auth.** Every endpoint takes a Customer Master Bearer JWT (RECOVERED). dis-ui-server verifies signature against JWKS, extracts `tenant_id` and role claims, and enforces RBAC at the handler level (arch 4.17).
- **Scope tags.** T = tenant-scoped (RLS to the caller's `tenant_id`). P = platform/ops only. T+P = both, with ops able to cross-tenant via a `tenant_id` filter.
- **Paths.** `/v1/<group>/<resource>` (RECOVERED).
- **Errors (RECOVERED).** Standard `Error` body; `RateLimited` (429, `Retry-After`); `Backpressure` (downstream unhealthy, DLQ above threshold, `Retry-After`).
- **Events referenced (RECOVERED).** `ingress.ready`, `ingress.resubmit`, `quarantine`, `pipeline.dlq`, `mapping.changed`, `identity.changed`.
- **Lineage.** `trace_id`, `parent_trace_id` on resubmits; every canonical row carries `mapping_version_id` (decisions.md D22).
- **RBAC vocabulary.** Slice 19 uses a `role` claim plus a `dis:<resource>:<action>` permission namespace. This is the chosen provisional vocabulary pending D25. No Phase 1 screen gates on the fine-grained permission array; Phase 1 gates on `userType` and `tenant_id` only.

---

## 1. Cross-cutting

### 1.1 GET /v1/me  ·  scope T+P  ·  screens: all (AuthBoundary, header)
Current user identity and profile for the authenticated session.
Response (PROVISIONAL, current slice 19 fixture shape):
```jsonc
{
  "user_id": "usr_tenant_demo",
  "email": "tenant.admin@demo.ithina.test",
  "user_type": "TENANT",            // TENANT | PLATFORM
  "tenant_id": "ten_demo_0001",     // null for PLATFORM
  "tenant_name": "Demo Retail Co",  // null for PLATFORM; server-side display join
  "role": "tenant_owner",           // PROVISIONAL value; token carries role per arch 4.17
  "permissions": ["dis:sample:upload", "dis:mapping:view", "dis:mapping:promote", "dis:quarantine:view"]
}
```
Open: arch 4.17 lists no `/me` handler. Identity may instead come from decoding token claims client-side. Resolution pending Sanjeev and slice 13. (See dis-ui-server-contract.md.)

### 1.2 GET /v1/dashboard/summary  ·  scope T (ops via tenant switch)  ·  screen: Tenant Dashboard
Per-tenant at-a-glance: last submission per source, quarantined counts, active source count, recent latency snapshot.
Response (PROVISIONAL):
```jsonc
{
  "tenant_id": "ten_demo_0001",
  "sources": [
    {"source_id": "src_pos_main", "name": "POS-CSV-Main", "health": "healthy", "rows_24h": 1247, "last_ok_at": "2026-06-03T09:12:00Z", "quarantined_open": 0}
  ],
  "latency_1h": {"p50_ms": 2100, "p95_ms": 6800, "p99_ms": 11200}
}
```

### 1.3 GET /v1/sources  ·  scope T+P  ·  screens: Sources, Dashboard
List configured sources. Tenant sees own (RLS); ops may pass `?tenant_id=` to cross-tenant. Query: `status`, `tenant_id` (ops), `q`.
Response (PROVISIONAL): array of
```jsonc
{"source_id": "src_pos_main", "name": "POS-CSV-Main", "type": "CSV", "store": "Store-01", "status": "active", "active_version": 3, "quarantine_rate_24h": 0.0, "last_ok_at": "2026-06-03T09:12:00Z"}
```
status enum (PROVISIONAL): `active | staged | deprecated | failing`.

### 1.4 GET /v1/sources/{source_id}  ·  scope T+P  ·  screen: Sources detail
Single source with mapping-version history pointer and recent activity. (Shape extends 1.3 with `versions_url`, `recent_activity`.)

### 1.5 PATCH /v1/sources/{source_id}  ·  scope T  ·  screen: Sources
Edit source metadata (display name, contact, store association). Body: partial source object.

### 1.6 POST /v1/sources/{source_id}/deprecate  ·  scope T (ops too)  ·  screen: Sources
Soft-disable; new submissions rejected. Empty body. Response: updated source.

---

## 2. Onboarding

### 2.1 POST /v1/onboarding/samples  ·  scope T+P  ·  screen: Sample Upload  ·  RECOVERED
Upload a sample file for a new source. Body: multipart/form-data with `file` (binary, required), `source_kind` (required, e.g. "csv", "json"), `tenant_id` (ops, on behalf of tenant), `label`.
Response (RECOVERED): `{ "sample_id": "...", "gcs_uri": "...", "status": "received" }`.
Note: sample lands in the onboarding-staging GCS path, not bronze (pre-mapping, exploratory).

### 2.2 GET /v1/onboarding/samples/{sample_id}  ·  scope T+P  ·  screens: Sample Upload (poll), Mapping Review  ·  RECOVERED
Inference, proposed mapping, and validation suggestions once the onboarding sub-module has processed the sample. Used both to poll for analysis completion and to load the Mapping Review screen.
Response (PROVISIONAL, derived from Mapping Review data):
```jsonc
{
  "sample_id": "smp_...",
  "status": "ready",                 // received | analyzing | ready | failed
  "columns": [
    {"source_col": "item_code", "inferred_type": "string", "sample_values": ["A123"], "null_pct": 0.0,
     "proposed_canonical": "sku_id", "confidence": 0.98, "transforms": []},
    {"source_col": "txn_date", "inferred_type": "string", "sample_values": ["03-12-25"], "null_pct": 0.01,
     "proposed_canonical": "event_ts", "confidence": 0.62, "transforms": [{"type": "date_format", "value": "DD-MM-YY"}]}
  ]
}
```

### 2.3 PATCH /v1/onboarding/samples/{sample_id}/mapping  ·  scope T+P  ·  screen: Mapping Review
Operator overrides to the draft mapping (per-column canonical target, transforms, authoritative-for flags). Body: partial column-mapping list.

### 2.4 POST /v1/onboarding/samples/{sample_id}/dry-run  ·  scope T+P  ·  screen: Mapping Review
Render preview canonical rows from the sample under the current draft mapping. Response: `{ "rows": [ ...10-20 canonical rows... ] }`.

### 2.5 POST /v1/onboarding/samples/{sample_id}/approve  ·  scope T+P  ·  screen: Mapping Review
Write the mapping to `config.source_mappings` with `status='staged'`; starts shadow rollout. Response: `{ "source_id": "...", "mapping_version": N, "status": "staged" }`.

### 2.6 GET /v1/sources/{source_id}/shadow-stats  ·  scope T+P  ·  screen: Shadow Rollout Review (Phase 2)
Rollup of the staged-window output: window, input chunks, staged rows, validation pass rate, diff-vs-active counts.

### 2.7 GET /v1/sources/{source_id}/shadow-diff  ·  scope T+P  ·  screen: Shadow Rollout Review (Phase 2)
Sample diff rows (staged vs current active). Query: `limit`.

### 2.8 POST /v1/sources/{source_id}/promote  ·  scope T+P  ·  screen: Shadow Rollout Review (Phase 2)
Staged becomes active; old active becomes deprecated; publishes `mapping.changed`.

### 2.9 POST /v1/sources/{source_id}/reject  ·  scope T+P  ·  screen: Shadow Rollout Review (Phase 2)
Staged becomes deprecated; operator iterates.

---

## 3. Mapping CRUD

### 3.1 GET /v1/sources/{source_id}/mappings  ·  scope T+P  ·  screen: Mapping Versions & CRUD
Version list with status, created date, created by, active window, field/transform counts, suite version.
Response (PROVISIONAL): array of
```jsonc
{"version": 3, "status": "active", "created_at": "2026-05-28", "created_by": "anjali", "field_count": 12, "transform_count": 4, "suite_version": 3, "active_from": "2026-05-28", "active_to": null}
```
status enum (PROVISIONAL): `active | staged | deprecated`.

### 3.2 GET /v1/sources/{source_id}/mappings/{version}  ·  scope T+P  ·  screen: Mapping Versions (view)
Full immutable mapping definition for a version (decisions.md D22; versions are immutable).

### 3.3 POST /v1/sources/{source_id}/mappings  ·  scope T (ops too)  ·  screen: Mapping Versions (edit)
Create a new staged version (a copy-to-edit; editing in place is not allowed per D22). Opens the Mapping Review flow.

### 3.4 POST /v1/sources/{source_id}/mappings/{version}/deprecate  ·  scope P  ·  screen: Mapping Versions
Ops-only. Deprecate the active mapping (rare; breaks ingestion until a new mapping is promoted).

---

## 4. Quarantine

### 4.1 GET /v1/quarantine  ·  scope T+P  ·  screen: Quarantine Console
Failed rows. Tenant slice is RLS-scoped; ops passes `?tenant_id=` to cross-tenant. Query: `source_id`, `error_type`, `from`, `to`, `status` (open|resolved).
Response (PROVISIONAL): array of
```jsonc
{"trace_id": "ee...8e", "source": "Shopify", "store": "Online", "error_reason": "price not a valid number",
 "failure_stage": "canonical-shape", "mapping_version": 5, "failed_at": "2026-06-03T09:08:00Z", "status": "open"}
```
failure_stage enum (PROVISIONAL): `source-shape | canonical-shape | fk | normalization`.

### 4.2 GET /v1/quarantine/{trace_id}  ·  scope T+P  ·  screen: Quarantine Console (detail)
Row detail: original payload, error context, the mapping version that processed it, chain depth.

### 4.3 POST /v1/quarantine/{trace_id}/resubmit  ·  scope T (ops too)  ·  screen: Quarantine Console (Phase 2 action)
Publishes `ingress.resubmit`. Body: `{ "resubmit_type": "replay" | "fixed_file", "parent_trace_id": "..." }`. Chain depth capped at 3 backend-side (arch 6.5).

### 4.4 POST /v1/quarantine/{trace_id}/resolve  ·  scope P  ·  screen: Quarantine Console (ops, Phase 3)
Ops-only. Dismiss without replay.

---

## 5. Audit and trace

### 5.1 GET /v1/audit/{trace_id}  ·  scope T+P  ·  screen: Audit & Trace Lookup
Direct trace lookup: ordered per-stage lifecycle for a chunk or row.
Response (PROVISIONAL):
```jsonc
{
  "trace_id": "fa...4c",
  "tenant_id": "ten_demo_0001",
  "source_id": "src_pos_main",
  "stages": [
    {"stage": "received", "at": "2026-06-03T09:00:01Z", "status": "ok"},
    {"stage": "validated", "at": "2026-06-03T09:00:02Z", "status": "ok"},
    {"stage": "mapped", "at": "2026-06-03T09:00:03Z", "status": "ok", "mapping_version_id": 3},
    {"stage": "committed", "at": "2026-06-03T09:00:04Z", "status": "ok"}
  ],
  "prior_trace_id": null
}
```
Quarantined traces end at a `quarantined` stage with `error_code`.

### 5.2 GET /v1/audit  ·  scope T+P  ·  screen: Audit & Trace Lookup (search, Phase 3 filters)
Search audit events. Query: `tenant_id` (ops), `store_id`, `source_id`, `from`, `to`, `status`, `mapping_version_id`. Returns the result list; clicking a row loads 5.1.

---

## 6. Notifications

### 6.1 GET /v1/notifications/unread-count  ·  scope T+P  ·  screen: all (bell badge)
Polled every 30s (surface map 6.5). Response: `{ "unread": 3 }`.

### 6.2 GET /v1/notifications  ·  scope T+P  ·  screen: Notifications (Phase 2)
Per-user, scoped list. Query: `filter` (unread|all|errors).
Response (PROVISIONAL): array of
```jsonc
{"id": "ntf_...", "severity": "warning", "text": "32 rows quarantined", "source": "Shopify", "at": "2026-06-03T09:08:00Z", "read": false, "link": "/quarantine?source=shopify"}
```

### 6.3 PATCH /v1/notifications/{id}/read  ·  scope T+P  ·  screen: Notifications (Phase 2)
Mark one read.

### 6.4 POST /v1/notifications/mark-all-read  ·  scope T+P  ·  screen: Notifications (Phase 2)
Mark all read.

---

## 7. Ops

### 7.1 GET /v1/ops/fleet/summary  ·  scope P  ·  screen: Ops Fleet (Phase 3)
Rollup: total tenants, sources, rows/24h, overall quarantine rate, p95 latency.

### 7.2 GET /v1/ops/fleet/tenants  ·  scope P  ·  screen: Ops Fleet (Phase 3)
Tenant-level health table. Query: `tier`, `region`, `sort`.

### 7.3 POST /v1/ops/tenants/{tenant_id}/notify  ·  scope P  ·  screen: Ops Fleet (Phase 3)
Manual notification to a tenant.

### 7.4 POST /v1/ops/duckdb/query  ·  scope P  ·  screen: DuckDB Query Panel (Phase 3)
Ad-hoc SQL over a GCS bronze blob. Body: `{ "gcs_uri": "...", "sql": "..." }`. Response: `{ "columns": [...], "rows": [...] }`.

### 7.5 GET /v1/ops/duckdb/history  ·  scope P  ·  screen: DuckDB Query Panel (Phase 3)
Per-user query history (last 10).

---

## 8. Build sequencing

### 8.1 Minimum set already consumed (slice 19)
`GET /v1/me` only. Slice 19 wired the fixture client around it.

### 8.2 Phase 1 / slice 20 fixture set (the five MVP screens)
The endpoints whose fixtures slice 20 must ship:
- Sample Upload: 2.1, 2.2
- Mapping Review: 2.2, 2.3, 2.4, 2.5
- Mapping Versions (read-only): 3.1, 3.2
- Quarantine Console (tenant, read + detail): 4.1, 4.2
- Audit & Trace Lookup (trace_id direct): 5.1
Plus cross-cutting already present: 1.1, and 1.3 for source context.

### 8.3 Recommended grouping for Sanjeev's slices 15 to 17
This is a recommendation, not a decision. Sanjeev owns the real cut.
- **Slice 15 (cross-cutting + onboarding):** 1.1 to 1.6, 2.1 to 2.9. The onboarding flow end to end plus session and source registry. Highest UI dependency.
- **Slice 16 (mapping CRUD + quarantine):** 3.1 to 3.4, 4.1 to 4.4. The two heaviest tenant workflows after onboarding.
- **Slice 17 (audit + notifications + ops):** 5.1 to 5.2, 6.1 to 6.4, 7.1 to 7.5. Cross-tenant and ops surfaces, plus the notification plumbing.

---

## 9. Open questions and reconciliation

1. **GET /me existence.** Arch 4.17 lists no `/me` handler. Confirm whether dis-ui-server exposes 1.1, or whether the UI derives identity from token claims. Pending Sanjeev and slice 13.
2. **RBAC vocabulary.** All `role`, `user_type`, and `permissions` values here are provisional pending D25. The recovered surface map section 6.2 used an admin-frontend-style 4-tuple; this doc and slice 19 use the `dis:<resource>:<action>` namespace. D25 settles which is canonical.
3. **Path and shape drift.** Only the onboarding shapes (2.1, 2.2) are RECOVERED verbatim. Everything else is derived from the surface map's documented data and actions and must be checked against the original OpenAPI spec if it resurfaces, or against Sanjeev's slice 15 to 17 implementation, whichever lands first.
4. **Sources grouping.** The surface map treats Sources as a screen adjacent to Mapping CRUD; this doc folds the source endpoints (1.3 to 1.6) into cross-cutting because the dashboard and onboarding both read them. Confirm grouping with Sanjeev.
5. **Endpoint count.** The lost original was described as 26 endpoints across 7 groups. This rebuild lands near that across the same 7 groups; exact parity with the original is not claimed.
```
