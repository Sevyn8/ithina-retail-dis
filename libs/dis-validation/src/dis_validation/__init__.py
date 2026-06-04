"""dis-validation — Pandera suites for the two validation gates (slice-05; D18, D21).

- Source-shape (pre-mapping): judges a raw chunk in the tenant's vocabulary.
- Canonical-shape (post-mapping): judges a mapped contribution against the
  invariants of the source-owned, mapping-produced columns of ONE named
  ``dis-canonical`` model — never the consumer-injected columns (D8).
- Provenance registry + drift guard: the mapping-produced-vs-consumer-injected
  line, drawn from the live schema, asserted both directions (errors, never skips).

Pure lib: no Postgres, GCS, Pub/Sub, network, or file I/O. Suite definitions are
handed in by the caller; loading them from ``config.source_mappings`` is the
consumer's side-input (Slice 10).
"""

from __future__ import annotations

from dis_validation.canonical_shape import (
    CanonicalShapeSuiteDef,
    materialize_canonical_shape,
    suite_column_set,
)
from dis_validation.failure_formatter import CanonicalShapeFailure, SourceShapeFailure
from dis_validation.provenance import (
    NOT_MAPPING_PRODUCED,
    PROVENANCE,
    ColumnProvenance,
    assert_no_drift,
    mapping_produced_columns,
)
from dis_validation.runner import (
    CanonicalShapeResult,
    SourceShapeResult,
    run_canonical_shape,
    run_source_shape,
)
from dis_validation.source_shape import (
    ColumnExpectation,
    SourceShapeSuiteDef,
    materialize_source_shape,
)

__all__ = [
    "NOT_MAPPING_PRODUCED",
    "PROVENANCE",
    "CanonicalShapeFailure",
    "CanonicalShapeResult",
    "CanonicalShapeSuiteDef",
    "ColumnExpectation",
    "ColumnProvenance",
    "SourceShapeFailure",
    "SourceShapeResult",
    "SourceShapeSuiteDef",
    "assert_no_drift",
    "mapping_produced_columns",
    "materialize_canonical_shape",
    "materialize_source_shape",
    "run_canonical_shape",
    "run_source_shape",
    "suite_column_set",
]
