"""The four-step mapping_rules gate (slice 14b principle 4) — config never stores invalid.

Pure unit tests (no app, no DB): the gate runs entirely before any write, so a
rejection here is exactly what the POST/PATCH handlers turn into a 400.
"""

from __future__ import annotations

import copy
from typing import Any

import pytest

from dis_canonical import StoreSkuChangeEvent, StoreSkuSaleEvent
from dis_core.errors import MappingConfigError
from dis_ui_server.mapping_validation import (
    mandatory_mapping_produced,
    route_target_model,
    validate_mapping_rules,
)

TENANT_A = "019e89f9-dbd5-7703-8221-ae6b811599bb"


def _sale_rules() -> dict[str, Any]:
    """A complete, valid sale-event template (every mandatory column provided)."""
    return {
        "version": 1,
        "rename": {
            "item_code": "sku_id",
            "qty": "quantity",
            "price": "unit_retail_price",
            "paid": "unit_sale_price",
            "ts": "source_sale_timestamp",
            "kind": "event_subtype",
        },
        "normalize": {
            "quantity": [
                {"op": "parse_decimal", "args": {"decimal_separator": ".", "thousands_separator": None}}
            ],
            "source_sale_timestamp": [
                {"op": "parse_datetime", "args": {"format": "%Y-%m-%d %H:%M:%S", "timezone": "UTC"}}
            ],
        },
        "cast": {
            "quantity": {"type": "decimal", "precision": 14, "scale": 3},
            "source_sale_timestamp": {"type": "datetime"},
        },
        "derive": {
            "event_date": [{"op": "date_from_datetime", "args": {"source_column": "source_sale_timestamp"}}],
            "currency": [{"op": "constant", "args": {"value": "EUR"}}],
        },
    }


def _change_rules(category: str, attribute: str) -> dict[str, Any]:
    """A change-event template carrying only the polymorphic-common mandatory set."""
    return {
        "version": 1,
        "rename": {
            "item": "sku_id",
            "when": "source_event_timestamp",
            "subtype": "event_subtype",
            "new_value": "value_after",
        },
        "normalize": {
            "source_event_timestamp": [
                {"op": "parse_datetime", "args": {"format": "%Y-%m-%d %H:%M:%S", "timezone": "UTC"}}
            ],
        },
        "cast": {"source_event_timestamp": {"type": "datetime"}},
        "derive": {
            "event_date": [{"op": "date_from_datetime", "args": {"source_column": "source_event_timestamp"}}],
            "event_category": [{"op": "constant", "args": {"value": category}}],
            "attribute_name": [{"op": "constant", "args": {"value": attribute}}],
        },
    }


# -- the valid paths --------------------------------------------------------------


def test_valid_sale_template_routes_to_sale_events() -> None:
    source = validate_mapping_rules(_sale_rules(), tenant_id=TENANT_A)
    assert route_target_model(source, tenant_id=TENANT_A) is StoreSkuSaleEvent


def test_pricing_only_and_inventory_only_change_templates_both_pass() -> None:
    # The polymorphic-coverage proof (plan-mode confirmation, operator-accepted):
    # mandatory change columns are the five common keys/discriminators only, so
    # two templates differing solely in their derive constants both validate.
    for category, attribute in (("PRICE", "current_retail_price"), ("INVENTORY", "stock_qty")):
        source = validate_mapping_rules(_change_rules(category, attribute), tenant_id=TENANT_A)
        assert route_target_model(source, tenant_id=TENANT_A) is StoreSkuChangeEvent


def test_mandatory_sets_are_derived_not_hardcoded() -> None:
    assert set(mandatory_mapping_produced(StoreSkuSaleEvent)) == {
        "event_date",
        "sku_id",
        "event_subtype",
        "source_sale_timestamp",
        "quantity",
        "unit_retail_price",
        "unit_sale_price",
        "currency",
    }
    assert set(mandatory_mapping_produced(StoreSkuChangeEvent)) == {
        "event_date",
        "sku_id",
        "event_category",
        "event_subtype",
        "source_event_timestamp",
    }


# -- the rejection paths (each a clean MappingConfigError, never a write) ----------


def test_missing_locale_declaration_is_refused() -> None:
    rules = _sale_rules()
    del rules["normalize"]["quantity"][0]["args"]["thousands_separator"]
    with pytest.raises(MappingConfigError, match="thousands_separator"):
        validate_mapping_rules(rules, tenant_id=TENANT_A)


def test_unknown_shape_key_is_refused() -> None:
    rules = _sale_rules()
    rules["transforms"] = {}  # the D49-stale field name; extra="forbid" catches it
    with pytest.raises(MappingConfigError, match="do not parse"):
        validate_mapping_rules(rules, tenant_id=TENANT_A)


def test_unknown_canonical_target_is_refused() -> None:
    rules = _sale_rules()
    rules["rename"]["x"] = "not_a_canonical_column"
    with pytest.raises(MappingConfigError, match="not_a_canonical_column"):
        validate_mapping_rules(rules, tenant_id=TENANT_A)


def test_consumer_injected_target_is_refused() -> None:
    # trace_id is a real canonical column but NEVER mapping-produced.
    rules = _sale_rules()
    rules["rename"]["t"] = "trace_id"
    with pytest.raises(MappingConfigError, match="fit 0 event models"):
        validate_mapping_rules(rules, tenant_id=TENANT_A)


def test_ambiguous_shared_only_targets_are_refused() -> None:
    rules = {"version": 1, "rename": {"a": "sku_id"}, "normalize": {}, "cast": {}, "derive": {}}
    with pytest.raises(MappingConfigError, match="fit 2 event models"):
        validate_mapping_rules(rules, tenant_id=TENANT_A)


def test_missing_mandatory_column_is_refused() -> None:
    rules = _sale_rules()
    del rules["derive"]["currency"]
    with pytest.raises(MappingConfigError, match=r"mandatory sale_event column\(s\) \['currency'\]"):
        validate_mapping_rules(rules, tenant_id=TENANT_A)


def test_empty_rename_is_refused() -> None:
    rules = {"version": 1, "rename": {}, "normalize": {}, "cast": {}, "derive": {}}
    with pytest.raises(MappingConfigError, match="no rename targets"):
        validate_mapping_rules(rules, tenant_id=TENANT_A)


def test_rejection_paths_do_not_mutate_the_input() -> None:
    rules = _sale_rules()
    frozen = copy.deepcopy(rules)
    rules["rename"]["x"] = "not_a_canonical_column"
    with pytest.raises(MappingConfigError):
        validate_mapping_rules(rules, tenant_id=TENANT_A)
    del rules["rename"]["x"]
    assert rules == frozen
