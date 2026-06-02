# `services/csv-ingest-worker/` — *v1.0*

The GCS-event-triggered worker for CSV upload (Phase 2 of the two-phase CSV ingress flow). Subscribed to bronze-bucket object-finalized notifications; runs preflight, tokenizes PII, persists bronze metadata, and hands off to the streaming consumer via Pub/Sub.

Phase 1 of CSV upload (signed-URL issuance) lives in `services/dis-ui-server/` as the `upload_session` handler. See `decisions.md` D36 for the split rationale.

**Purpose.** Do the post-upload work that should not run inside a UI request: structural preflight, identity resolution, PII tokenization, bronze metadata persistence, and pipeline handoff. Scales with data volume rather than UI concurrency.

**Entry.**
- Trigger: Pub/Sub message on the `bucket.objects.changed` topic, published by GCS when a CSV object the tenant uploaded (against a dis-ui-server-issued signed URL) is finalized.
- Inputs: GCS object path, object metadata, byte count, content-type.
- Preconditions: object path matches the canonical path scheme issued by dis-ui-server's `upload_session` handler (`tenant/{id}/source/{id}/yyyy=Y/.../{trace_id}.csv`). The path itself carries `tenant_id`, `source_id`, and `trace_id`; the upload session is recoverable via Identity Service `resolve_from_upload`.

**Process.**
- Parse the GCS object-finalized event; extract `tenant_id`, `source_id`, `trace_id` from the path; validate path shape via `libs/dis-storage`.
- Resolve identity by calling Identity Service `resolve_from_upload` with the upload session ID encoded in the path. Confirms the tenant + store are still active and the upload session is known.
- Idempotency check: compute SHA-256 of the object; if the same SHA-256 + source_payload_id + tenant has been processed in the last 24h, log and ack — return the prior `trace_id`, do not re-process.
- DuckDB-driven preflight: row count, header present, type sniff, null %. Baseline checks (size, MIME, header). Failures route to `quarantine` topic with `pre-mapping/structural` reason and do not write bronze.
- Tokenize any PII columns flagged by `dis-pii` per source mapping config. v1.0 CSV launch has no PII columns flagged → tokenization is a no-op pass-through. If a column is flagged but no storage backend is configured, `dis-pii` raises at startup (loud failure, no plaintext PII reaches bronze).
- Write bronze metadata row via `libs/dis-rls` (RLS-scoped to the tenant).
- Publish `ingress.ready` for the streaming consumer.
- Emit audit events for each stage: object-finalized received, preflight result, PII tokenize, bronze write, ingress publish.

**Exit.**
- Success: bronze metadata row persisted; `ingress.ready` published (consumed by §3.7 streaming-consumer); audit events emitted (read by dis-ui-server `audit` handler); Pub/Sub message acked. No HTTP response (event-driven).
- Failure modes:
  - *Preflight failure:* route the row(s) to `quarantine` topic (consumed by §3.8 quarantine-drainer) with `pre-mapping/structural` reason. Ack the source message — preflight failure is a terminal outcome for the chunk, not a retry case.
  - *Bronze write failure (transient):* retry with backoff; if persistent, DLQ the GCS path for ops replay. Do not ack.
  - *Identity Service circuit open:* fall back to direct `identity_mirror` read; if also unavailable, nack and let Pub/Sub redeliver.
- Edge cases:
  - *Signed URL expired before tenant uploaded:* no object-finalized notification fires; this service never sees the case. No durable artifact in DIS.
  - *Tenant uploaded outside the path scope of the signed URL:* GCS rejects the PUT; no notification.
  - *GCS notification fires but object is empty (zero bytes):* preflight rejects; route to quarantine.

```
services/csv-ingest-worker/
├── CLAUDE.md
├── README.md
├── pyproject.toml
├── Dockerfile
├── .dockerignore
│
├── src/
│   └── csv_ingest_worker/
│       ├── __init__.py
│       ├── main.py             # Pub/Sub subscriber entrypoint
│       ├── config.py
│       │
│       ├── notifications/      # GCS object-finalized event handler
│       │   ├── __init__.py
│       │   └── handler.py      # subscribed to bucket.objects.changed Pub/Sub
│       │
│       ├── enrichment/         # runs on notification, before bronze write
│       │   ├── __init__.py
│       │   ├── identity.py     # call Identity Service resolve_from_upload
│       │   ├── trace.py        # read trace_id from GCS path; this service does NOT mint trace_ids
│       │   └── pii.py          # tokenize PII before any persisted reference
│       │
│       ├── preflight/          # DuckDB-driven CSV pre-flight after upload completes
│       │   ├── __init__.py
│       │   ├── duckdb_check.py # row count, columns, null %, type sniff
│       │   └── rules.py        # baseline checks (size, MIME, header present)
│       │
│       ├── sinks/
│       │   ├── __init__.py
│       │   ├── bronze.py       # write metadata row
│       │   ├── pubsub.py       # publish ingress.ready
│       │   └── quarantine.py   # publish to quarantine topic on preflight failure
│       │
│       └── clients/
│           ├── __init__.py
│           └── identity.py
│
├── tests/
│   ├── unit/
│   │   ├── test_preflight.py
│   │   ├── test_enrichment.py
│   │   ├── test_idempotency.py
│   │   └── test_notification_handler.py
│   ├── integration/
│   │   ├── conftest.py
│   │   ├── test_object_finalized_flow.py
│   │   ├── test_csv_malformed.py
│   │   ├── test_csv_too_large.py
│   │   └── test_csv_empty.py
│   └── fixtures/
│       └── csvs/               # sample CSVs (good, malformed, edge cases)
│
├── scripts/
│   └── run-local.sh
│
└── deploy/
    ├── service.yaml
    ├── configmap.yaml
    └── README.md
```

**Why this is a worker, not a receiver.** The "receiver" pattern is for services that accept HTTP requests. This service is triggered by GCS, not by a user; it has no public HTTP surface. Calling it a worker matches its operational shape: queue consumer, scales with backlog, retries on failure.

**Why this service does not generate `trace_id`.** Per D36, dis-ui-server's `upload_session` handler generates the `trace_id` and encodes it in the GCS object path. By the time this worker fires, `trace_id` is already pinned. This worker reads it; it does not mint.

**Why `notifications/` is the entry point.** No HTTP routes. The entry is a Pub/Sub subscriber on `bucket.objects.changed`. The `notifications/handler.py` is the single dispatch point.

**Why there is no `sinks/gcs.py` here.** This service does not write the CSV payload to GCS; the tenant does, via the signed URL issued by dis-ui-server. The GCS object path is constructed in dis-ui-server (`libs/dis-storage`) at signed-URL issuance time; this worker reads the path from the notification, not by computing it.

**Why `identity.py` calls `resolve_from_upload` instead of `resolve_from_token`.** Identity is bound to the upload session created in dis-ui-server's `upload_session` handler, not to a request token. The upload session ID is encoded in the GCS object path; this worker calls `resolve_from_upload(upload_id)` to retrieve the tenant + store identity.

**What's deliberately not here.** No HTTP routes (worker-only). No signed URL issuance (dis-ui-server's job). No mapping execution (streaming-consumer's job). No semantic validation suites (those run in the streaming consumer post-fetch). This worker does *structural* preflight, not *semantic* validation.

---
