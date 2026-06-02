# `libs/dis-mapping/`

The mapping config model and the transform engine. Used by the streaming consumer (to apply mappings at runtime) and by `dis-ui-server`'s onboarding sub-module (to validate proposed mappings during dry-run).

```
libs/dis-mapping/
├── pyproject.toml
├── README.md
├── src/
│   └── dis_mapping/
│       ├── __init__.py
│       ├── models/
│       │   ├── __init__.py
│       │   ├── source_mapping.py   # the config.source_mappings shape
│       │   └── transform.py        # transform spec (op, args)
│       ├── engine/
│       │   ├── __init__.py
│       │   ├── rename.py
│       │   ├── normalize.py        # declarative vocabulary
│       │   ├── cast.py
│       │   └── derive.py
│       └── escape_hatch/
│           ├── __init__.py
│           └── registry.py         # named custom transform functions
└── tests/
    └── unit/
```

**Why the engine is here and not in the streaming-consumer.** Two callers apply mappings: the streaming consumer (in production) and `dis-ui-server`'s onboarding sub-module (in dry-run). Putting the engine in a lib lets both use it identically; putting it in one service forces the other to duplicate or call.

**Why `escape_hatch/` is a registry.** The declarative + escape hatch decision (`decisions.md` D20) means some transforms are named functions. A registry pattern lets services register their custom transforms at startup; the engine looks them up by name from the mapping config.

---
