# `services/receiver-csv-upload/` — *v1.0*

The HTTP receiver for manual CSV upload from the DIS UI. Same shape as `receiver-api/` but bound to a different ingress path: requests come from a user session (Customer Master-authenticated) via dis-ui-server, not from a machine token.

**Purpose.** Accept manual CSV uploads from authenticated users via the DIS UI without transiting bytes through the receiver, and hand them off to the pipeline once GCS confirms the upload.

**Entry.** Two distinct triggers (two-phase flow).
- *Phase 1 trigger:* HTTP POST to `/upload` from §3.10 dis-ui-server on behalf of an authenticated user. Inputs: source_id, expected filename, expected size. Preconditions: user authenticated; tenant + source registered.
- *Phase 2 trigger:* Pub/Sub message on `bucket.objects.changed` topic when the tenant's PUT to the signed URL completes. Inputs: GCS object path, metadata, byte count. Preconditions: object path matches the path issued in phase 1.

**Process.**
- *Phase 1 (handler):* validate user session; resolve identity via §3.5 identity-service `resolve_from_upload` method; generate `trace_id`; build the canonical GCS path via `libs/dis-storage` (`tenant/{id}/source/{id}/yyyy=Y/.../{trace_id}.csv`); issue a 15-minute signed PUT URL scoped to exactly that path; return URL and `trace_id` to caller.
- *Phase 2 (notification handler):* parse the GCS object-finalized event; validate path against metadata via `dis-storage`; run DuckDB-driven preflight (row count, header present, type sniff, null %); tokenize any PII columns flagged by `dis-pii`; write bronze metadata row; publish `ingress.ready`; emit audit events.

**Exit.**
- *Phase 1 success:* HTTP 2xx with `{upload_url, trace_id, expires_at}`. No durable outputs yet; the GCS object does not exist until the tenant uploads.
- *Phase 2 success:* bronze metadata row persisted; `ingress.ready` published (consumed by §3.7 streaming-consumer); audit events emitted (read by §3.10 dis-ui-server audit handler). No HTTP response (event-driven).
- Phase 1 failure modes: 401 (bad session), 400 (invalid source_id or size), 429 (rate limit), 503 (Identity Service circuit open).
- Phase 2 failure modes: preflight failure routes to `quarantine` topic (consumed by §3.8 quarantine-drainer) with `pre-mapping/structural` reason; bronze write failure retries with backoff then DLQs the GCS path for ops replay.
- Edge case: signed URL expires before tenant uploads, no phase 2 trigger fires; UI must re-request a URL. No durable artifact left behind.


```
services/receiver-csv-upload/
├── CLAUDE.md
├── README.md
├── pyproject.toml
├── Dockerfile
├── .dockerignore
│
├── src/
│   └── receiver_csv_upload/
│       ├── __init__.py
│       ├── main.py
│       ├── config.py
│       │
│       ├── handlers/
│       │   ├── __init__.py
│       │   └── upload.py       # POST /upload: issues signed URL, returns to caller
│       │
│       ├── notifications/      # GCS object-finalized event handler
│       │   ├── __init__.py
│       │   └── handler.py      # subscribed to bucket.objects.changed Pub/Sub
│       │
│       ├── enrichment/         # runs on notification, before bronze write
│       │   ├── __init__.py
│       │   ├── identity.py     # call Identity Service resolve_from_upload
│       │   ├── trace.py
│       │   └── pii.py          # tokenize PII before any persisted reference
│       │
│       ├── preflight/          # DuckDB-driven CSV pre-flight after upload completes
│       │   ├── __init__.py
│       │   ├── duckdb_check.py # row count, columns, null %, type sniff
│       │   └── rules.py        # baseline checks (size, MIME, header present)
│       │
│       ├── sinks/
│       │   ├── __init__.py
│       │   ├── bronze.py       # write metadata row (post-notification)
│       │   └── pubsub.py       # publish ingress.ready
│       │
│       └── clients/
│           ├── __init__.py
│           └── identity.py
│
├── tests/
│   ├── unit/
│   │   ├── test_preflight.py
│   │   ├── test_enrichment.py
│   │   ├── test_handlers.py
│   │   └── test_notification_handler.py
│   ├── integration/
│   │   ├── conftest.py
│   │   ├── test_signed_url_issue.py
│   │   ├── test_object_finalized_flow.py
│   │   ├── test_csv_malformed.py
│   │   └── test_csv_too_large.py
│   └── fixtures/
│       └── csvs/               # sample CSVs (good, malformed, edge cases)
│
├── scripts/
│   ├── run-local.sh
│   └── upload-local.sh
│
└── deploy/
    ├── service.yaml
    ├── configmap.yaml
    └── README.md
```

**Why two phases (handler + notification).** Large CSVs should not transit through Ithina receivers. The handler issues a signed URL (via `libs/dis-storage/signed_urls.py`) scoped to one object path, valid for ~15 minutes; the tenant PUTs directly to GCS. When the object is finalized in GCS, a Pub/Sub notification fires; the notification handler does the post-upload work (preflight, identity resolution, PII tokenization, bronze metadata write, `ingress.ready` publish). Two phases mean the request handler stays small and stateless; the heavy work happens out-of-band after upload completes.

**Why `notifications/` is its own folder.** The notification handler is a different control flow from the request handler: it consumes from Pub/Sub, not from HTTP. Splitting makes the dispatch model explicit.

**Why there is no `sinks/gcs.py` here.** The receiver does not write the CSV payload to GCS; the tenant does, via the signed URL. GCS path generation happens in `handlers/upload.py` (issuing the URL) via `libs/dis-storage`. The notification handler reads the path from the Pub/Sub notification, not by computing it.

**Why `identity.py` calls `resolve_from_upload` instead of `resolve_from_token`.** Manual upload identity is bound to a session, not a token. The user is already authenticated by Customer Master; the upload session carries the auth context forward. Different method on the Identity Service, same client.

**What's deliberately not here.** No mapping (still streaming consumer's job). No validation suites (those run in the streaming consumer post-fetch). The receiver does *structural* preflight, not *semantic* validation.

---
