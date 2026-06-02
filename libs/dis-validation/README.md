# `libs/dis-validation/`

Pandera schema helpers, suite loading, failure formatting.

```
libs/dis-validation/
├── pyproject.toml
├── README.md
├── src/
│   └── dis_validation/
│       ├── __init__.py
│       ├── suite_loader.py     # load a (tenant, source, version) suite
│       ├── source_shape.py     # base classes for pre-mapping suites
│       ├── canonical_shape.py  # base classes for post-mapping suites
│       └── failure_formatter.py # tenant-readable failure reasons
└── tests/
    └── unit/
```

**Why this lib exists.** The streaming consumer, `dis-ui-server`'s onboarding sub-module (Layer 3 validation draft), and the nightly batch (optional quality gate) all use Pandera suites. Shared loading and formatting code lives here.

---
