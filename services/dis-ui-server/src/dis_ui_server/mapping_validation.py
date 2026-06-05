"""The create/edit ``mapping_rules`` gate — D49 shape + the 14b semantic layer.

A mapping-template write stores config the streaming consumer will later parse,
route, and run; anything it would refuse must be a clean 400 HERE, never a
stored-invalid-config write. Four steps, all raising ``MappingConfigError``
(mapped to 400 by ``errors_http``):

1. **Shape + D49 args** — ``SourceMapping.model_validate`` (the engine contract:
   frozen, ``extra="forbid"``, mandatory locale/separator/format declarations,
   derive composition typing). A pydantic ``ValidationError`` is wrapped, exactly
   as the consumer wraps it (``streaming_consumer/pipeline/mapping.py``).
2. **Non-empty rename** — the consumer refuses an empty mapping (no canonical
   contribution); so do we.
3. **Routing** — the target set must fit EXACTLY one event model's
   mapping-produced column set. Zero matches → unknown/foreign targets; two →
   ambiguous (the discriminating sets are disjoint by design, e.g.
   ``source_sale_timestamp`` vs ``source_event_timestamp``). Same rule as the
   consumer's ``route_target_model``; both sides derive from the ONE source,
   ``dis_validation.mapping_produced_columns`` (drift-guarded), so the SETS
   cannot diverge — only this ~10-line check is repeated (surfaced in the slice
   plan as a later promotion candidate into dis-validation).
4. **Mandatory coverage** — every required (non-Optional) field of the routed
   model that is mapping-produced must be provided by rename or derive
   (constant/copy/date_from_datetime count: "PROVIDED", not "a CSV column must
   point at it"). Derived live from ``model_fields`` ∩ the provenance partition,
   never hardcoded. For change events this is the five polymorphic-common
   keys/discriminators only — subtype payload columns are all Optional, so
   pricing-only and inventory-only templates both pass. (The row-level
   ``value_before OR value_after`` CHECK is deliberately NOT lifted to config
   validation: step 4 is strictly NOT-NULL-derived — one canonical truth, no
   hand-curated extras. An authored change-template lint is a surfaced later
   refinement, operator-gated.)

The catalog endpoint derives from the same two sources (same models, same
provenance accessor), so what the catalog shows mappable and what this gate
accepts cannot drift (slice principle: one canonical truth).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ValidationError

from dis_canonical import StoreSkuChangeEvent, StoreSkuSaleEvent
from dis_core.errors import MappingConfigError
from dis_mapping import SourceMapping
from dis_ui_server.schemas.mapping_fields import FieldSection
from dis_validation import mapping_produced_columns

# The routing universe: the two event tables of the dual-write — identical to the
# consumer's EVENT_MODELS (streaming_consumer/pipeline/mapping.py; not importable
# across services, cross-referenced instead). The hot table is never a routing
# target; signal_history raises inside mapping_produced_columns by design.
EVENT_MODELS: tuple[type[BaseModel], ...] = (StoreSkuSaleEvent, StoreSkuChangeEvent)

# Wire section labels, keyed by routed model (shared with the field catalog).
SECTION_BY_MODEL: dict[type[BaseModel], FieldSection] = {
    StoreSkuSaleEvent: "sale_event",
    StoreSkuChangeEvent: "change_event",
}


def mandatory_mapping_produced(model: type[BaseModel]) -> frozenset[str]:
    """The model's required (non-Optional) mapping-produced columns, derived live.

    The intersection of pydantic required-ness with the provenance partition —
    the exact set a template must provide by rename or derive. Never hardcoded:
    a canonical-model change flows through automatically (and trips the
    provenance drift guard first if unclassified).
    """
    produced = mapping_produced_columns(model)
    return frozenset(name for name, field in model.model_fields.items() if field.is_required()) & produced


def parse_mapping_rules(raw: dict[str, Any], *, tenant_id: str) -> SourceMapping:
    """Step 1+2: the D49 engine contract, plus the consumer's non-empty-rename rule."""
    try:
        source = SourceMapping.model_validate(raw)
    except ValidationError as exc:
        # Wrap without echoing values: a mapping_rules document is config, but a
        # malformed one can contain anything — only the failure SHAPE survives.
        raise MappingConfigError(
            f"mapping_rules do not parse as the D49 shape: {exc.error_count()} validation error(s); "
            "the contract is {version, rename, normalize, cast, derive} (libs/dis-mapping)",
            tenant_id=tenant_id,
        ) from exc
    except MappingConfigError as exc:
        # SourceMapping's own validators raise without a tenant in scope (the
        # engine never holds one); attach it here so the envelope carries the
        # load-bearing context (code-quality rule 5).
        exc.tenant_id = exc.tenant_id or tenant_id
        raise
    if not source.rename:
        raise MappingConfigError(
            "mapping_rules declare no rename targets; an empty mapping cannot produce a "
            "canonical contribution (the streaming consumer refuses it)",
            tenant_id=tenant_id,
        )
    return source


def route_target_model(source: SourceMapping, *, tenant_id: str) -> type[BaseModel]:
    """Step 3: the one event model this template's contribution targets."""
    targets = set(source.target_columns)
    matches = [model for model in EVENT_MODELS if targets <= mapping_produced_columns(model)]
    if len(matches) != 1:
        names = [model.__name__ for model in matches]
        raise MappingConfigError(
            f"mapping target columns {sorted(targets)} fit {len(matches)} event models "
            f"({names or 'none'}); a template must target exactly one of "
            f"{[m.__name__ for m in EVENT_MODELS]} — check the field catalog "
            "(GET /template-mapping-fields) for the mappable columns per section",
            tenant_id=tenant_id,
        )
    return matches[0]


def check_mandatory_coverage(source: SourceMapping, model: type[BaseModel], *, tenant_id: str) -> None:
    """Step 4: every mandatory mapping-produced column is provided by rename or derive."""
    missing = mandatory_mapping_produced(model) - set(source.target_columns)
    if missing:
        raise MappingConfigError(
            f"mapping_rules leave mandatory {SECTION_BY_MODEL[model]} column(s) "
            f"{sorted(missing)} unprovided; each must come from a rename or a derive "
            "(constant / copy / date_from_datetime)",
            tenant_id=tenant_id,
        )


def validate_mapping_rules(raw: dict[str, Any], *, tenant_id: str) -> SourceMapping:
    """The full four-step gate; returns the validated document for storage/serving."""
    source = parse_mapping_rules(raw, tenant_id=tenant_id)
    model = route_target_model(source, tenant_id=tenant_id)
    check_mandatory_coverage(source, model, tenant_id=tenant_id)
    return source
