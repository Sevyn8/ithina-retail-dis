# `libs/dis-audit/`

Audit event model and emit helpers. Streaming insert into BigQuery `audit_events`.

```
libs/dis-audit/
├── pyproject.toml
├── README.md
├── src/
│   └── dis_audit/
│       ├── __init__.py
│       ├── event.py            # AuditEvent Pydantic model
│       ├── emit.py             # BigQuery streaming insert client
│       └── stages.py           # enum of pipeline stages
└── tests/
    └── unit/
```

**Why this lib exists.** Every service emits audit events. Same shape, same destination, same insert idempotency via insertId. Shared lib is the right home.

---
