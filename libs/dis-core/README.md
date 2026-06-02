# `libs/dis-core/`

Shared base types, IDs, errors, and small primitives used across every service.

```
libs/dis-core/
├── pyproject.toml
├── README.md
├── src/
│   └── dis_core/
│       ├── __init__.py
│       ├── ids.py              # trace_id, tenant_id, store_id types
│       ├── timestamps.py       # event_ts, received_ts handling
│       ├── errors.py           # exception hierarchy
│       ├── result.py           # Result type for fallible operations
│       └── logging.py          # structured logging conventions
└── tests/
    └── unit/
```

**Why this lib exists.** Every service needs trace_id generation, error types, structured logging. Without a shared lib, each service invents its own and the codebase fragments. With a shared lib, the conventions are enforced by import.

**What's deliberately not here.** No business logic. No model definitions (those live in `dis-canonical`, `dis-mapping`). No I/O. This is a pure-stdlib library.

---
