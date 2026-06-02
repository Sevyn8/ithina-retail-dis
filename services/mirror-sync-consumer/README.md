# `services/mirror-sync-consumer/` — *v1.0*

Subscribes to `identity.changed`, maintains the `identity_mirror` schema in the data-platform Postgres so canonical tables can have real FKs.

**Purpose.** Keep the data-platform's `identity_mirror` schema in sync with the admin database, so canonical tables can enforce FK constraints against tenant and store identifiers without crossing the DB boundary.

**Entry.**
- Trigger: Pub/Sub message on `identity.changed` subscription. Producer: §3.5 identity-service.
- Inputs: event envelope `{event_type: created|updated|deactivated, entity: tenant|store, entity_id, payload, source_ts}`.
- Preconditions: data-platform Postgres reachable; subscription healthy.

**Process.**
- Receive event; ack-extend if processing time approaches deadline.
- Dispatch by `entity` type to the corresponding sync function (`sync/tenants.py` or `sync/stores.py`).
- For `created` and `updated`: upsert into `identity_mirror.tenants_known` or `stores_known` with `source_ts` as conflict-resolution key (older events don't overwrite newer).
- For `deactivated`: soft-delete via `is_active = false` (do not hard-delete; canonical rows may still reference).
- Emit audit event with `trace_id` derived from event metadata.
- Ack message on successful commit.

**Exit.**
- Success: mirror row upserted; ack on the message. No downstream emission. `identity_mirror` is read by §3.7 streaming-consumer FK pre-check and as a fallback when §3.5 identity-service is unreachable.
- Failure modes handled: Postgres transient error → nack (Pub/Sub retries with backoff); event out-of-order (older `source_ts` than current row) → ack and skip (no-op).
- Failure modes propagated: persistent Postgres failure → nack repeatedly until DLQ thresholds trigger; ops alerted.
- Edge case: `identity.changed` published before the corresponding admin DB write commits (identity-service ordering bug) — mirror sees a row that the next `resolve_from_*` cannot find. Mitigated by retry-with-backoff on the read side; the mirror eventually converges.


```
services/mirror-sync-consumer/
├── CLAUDE.md
├── README.md
├── pyproject.toml
├── Dockerfile
├── .dockerignore
│
├── src/
│   └── mirror_sync_consumer/
│       ├── __init__.py
│       ├── main.py             # Pub/Sub subscriber entrypoint
│       ├── config.py
│       │
│       ├── consumer/
│       │   ├── __init__.py
│       │   ├── subscribe.py    # Pub/Sub pull loop
│       │   └── handler.py      # dispatch by event type
│       │
│       ├── sync/               # the actual mirror logic
│       │   ├── __init__.py
│       │   ├── tenants.py      # upsert tenants_known
│       │   └── stores.py       # upsert stores_known (soft-delete via is_active)
│       │
│       └── sinks/
│           ├── __init__.py
│           └── postgres.py     # writes to identity_mirror schema
│
├── tests/
│   ├── unit/
│   │   ├── test_handler_dispatch.py
│   │   ├── test_tenants_sync.py
│   │   └── test_stores_sync.py
│   ├── integration/
│   │   ├── conftest.py
│   │   ├── test_create_event.py
│   │   ├── test_update_event.py
│   │   └── test_soft_delete_event.py
│   └── fixtures/
│       └── events/             # sample identity.changed events
│
├── scripts/
│   ├── run-local.sh
│   └── replay-events.sh        # replay events from a saved snapshot
│
└── deploy/
    ├── service.yaml
    ├── configmap.yaml
    └── README.md
```

**Why this service is small.** It does one thing: turn `identity.changed` events into upserts on the mirror tables. The architecture intent matters more than the code volume; this service is what makes the FK contract from canonical to `identity_mirror` work in practice.

**Why `sync/` is split by entity (tenants, stores).** Different tables, different schema, different soft-delete semantics. Splitting makes each clear and testable.

**Why no `clients/`.** This service has no outbound calls. It reads from Pub/Sub and writes to Postgres. The two sinks (subscribe, postgres write) are sufficient.

**What's deliberately not here.** No identity resolution logic (the Identity Service does that). No admin DB connection (only the Identity Service has those credentials). This service consumes events; it never queries the source of truth.

---
