# `libs/dis-canonical/`

Pydantic models and dataclasses representing canonical schema rows. Source-of-truth Python representation of `current_store_positions` and history tables.

```
libs/dis-canonical/
├── pyproject.toml
├── README.md
├── src/
│   └── dis_canonical/
│       ├── __init__.py
│       ├── hot/
│       │   ├── __init__.py
│       │   └── current_store_positions.py
│       ├── history/
│       │   ├── __init__.py
│       │   └── events.py
│       └── shared/
│           ├── __init__.py
│           └── identifiers.py  # sku_id, store_id formats
└── tests/
    └── unit/
```

**Why this lib exists separately from schemas/.** `schemas/canonical/` holds SQL DDL and dbt models (source of truth for storage). `libs/dis-canonical/` holds Python models (source of truth for in-memory representation). Both must agree; they're generated or kept in sync via `tools/codegen/`. Splitting by usage (SQL vs Python) is cleaner than co-locating.

**Why `hot/` and `history/` subdirs.** The two tiers have different semantics (merge upsert vs append) and different fields (history has full event metadata; hot has aggregated state). Splitting at the lib level reinforces the architectural distinction.

---
