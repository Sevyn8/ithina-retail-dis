"""Post-mapping (canonical-shape) validation + the drift guard.

The suite is the default for the routed target model (the live
``post_validation_suite_ref`` is NULL = use default): the contribution is judged
against the model's source-owned columns — exactly the mapping's target set —
with dtype / nullability / max-length / enum vocab derived from ``model_fields``
(strict; off-universe columns rejected). Value-relation invariants (e.g.
``unit_sale_price <= unit_retail_price``) are deliberately NOT re-authored here:
they are live DB CHECK constraints, and a violation surfaces loudly at the write
inside the atomic transaction (either-or-neither, D30).

``assert_no_drift`` runs first and ERRORS (``SuiteDriftError``), never skips —
the D42 drift-guard type-narrowing limit (a narrowed column type passes the
name-set match and is caught only at INSERT, then swallowed by fire-and-forget
audit) is CARRIED, registered with the D42 resolution.
"""

from __future__ import annotations

import polars as pl

from dis_core.logging import LogContext
from dis_validation import (
    CanonicalShapeResult,
    CanonicalShapeSuiteDef,
    assert_no_drift,
    run_canonical_shape,
)
from streaming_consumer.pipeline.mapping import LoadedMapping


def run_post_validation(
    loaded: LoadedMapping,
    contribution: pl.DataFrame,
    *,
    tenant_id: str,
    trace_id: str,
) -> CanonicalShapeResult:
    """Judge the mapped contribution against the routed model's owned columns."""
    assert_no_drift(loaded.target_model)  # ERRORS, never skips (slice-05 criterion 6)
    suite = CanonicalShapeSuiteDef(
        target_model=loaded.target_model,
        owned_columns=loaded.source.target_columns,
    )
    return run_canonical_shape(
        suite,
        contribution,
        log_context=LogContext(tenant_id=tenant_id, trace_id=trace_id),
    )
