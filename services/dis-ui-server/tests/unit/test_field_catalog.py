"""Field catalog (slice 14b b): derivation, drift guard, and the no-tenant-context proof.

The endpoint half runs over the UNREACHABLE-DB client — passing proves the
catalog opens no ``rls_session`` and touches no database (acceptance: "no
tenant context required").
"""

from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from dis_canonical import StoreSkuChangeEvent, StoreSkuSaleEvent
from dis_core.errors import FieldCatalogDriftError
from dis_ui_server.catalog import build_field_catalog
from dis_ui_server.catalog.labels import LABELS, FieldLabel
from dis_ui_server.mapping_validation import mandatory_mapping_produced
from dis_validation import mapping_produced_columns

TENANT_B = "019e89f9-dbd5-7703-8221-ae707db9b918"

# -- derivation -----------------------------------------------------------------


def test_catalog_covers_exactly_the_mapping_produced_columns() -> None:
    catalog = build_field_catalog()
    by_section: dict[str, set[str]] = {}
    for entry in catalog:
        by_section.setdefault(entry.section, set()).add(entry.key)
    assert by_section["sale_event"] == set(mapping_produced_columns(StoreSkuSaleEvent))
    assert by_section["change_event"] == set(mapping_produced_columns(StoreSkuChangeEvent))


def test_consumer_injected_columns_are_never_mappable() -> None:
    # The provenance filter is load-bearing: raw model_fields would leak these.
    keys = {entry.key for entry in build_field_catalog()}
    never_mappable = (
        "tenant_id",
        "store_id",
        "trace_id",
        "mapping_version_id",
        "source_id",
        "source_event_id",
        "id",
    )
    for column in never_mappable:
        assert column not in keys


def test_mandatory_flags_match_the_live_required_sets() -> None:
    catalog = build_field_catalog()
    for model, section in ((StoreSkuSaleEvent, "sale_event"), (StoreSkuChangeEvent, "change_event")):
        flagged = {e.key for e in catalog if e.section == section and e.mandatory}
        assert flagged == set(mandatory_mapping_produced(model))


def test_change_event_mandatory_is_the_polymorphic_common_set() -> None:
    # The polymorphic design holds: no subtype payload column is required, so
    # pricing-only and inventory-only templates can both satisfy coverage.
    assert set(mandatory_mapping_produced(StoreSkuChangeEvent)) == {
        "event_date",
        "sku_id",
        "event_category",
        "event_subtype",
        "source_event_timestamp",
    }


def test_choice_fields_carry_the_check_vocabularies() -> None:
    by_key = {(e.section, e.key): e for e in build_field_catalog()}
    sale_subtype = by_key[("sale_event", "event_subtype")]
    assert sale_subtype.datatype == "choice"
    assert sale_subtype.allowed_values == ["SALE", "RETURN", "VOID"]
    category = by_key[("change_event", "event_category")]
    assert category.datatype == "choice"
    assert category.allowed_values == [
        "INVENTORY",
        "PRICE",
        "COST",
        "REGULATORY",
        "STATUS",
        "CATALOGUE",
        "OTHER",
    ]
    # Free-form change subtype is NOT a choice (varchar, no CHECK vocab).
    assert by_key[("change_event", "event_subtype")].datatype == "text"


def test_structural_facts_derive_from_annotations() -> None:
    by_key = {(e.section, e.key): e for e in build_field_catalog()}
    assert by_key[("sale_event", "sku_id")].max_length == 128  # required Annotated
    assert by_key[("change_event", "attribute_name")].max_length == 64  # Optional-wrapped Annotated
    assert by_key[("sale_event", "quantity")].datatype == "number"
    assert by_key[("sale_event", "line_item_seq")].datatype == "integer"
    assert by_key[("sale_event", "event_date")].datatype == "date"
    assert by_key[("change_event", "value_after")].datatype == "json"


# -- drift guard (both directions) ------------------------------------------------


def test_missing_label_fails_the_build(monkeypatch: pytest.MonkeyPatch) -> None:
    pruned = {section: dict(labels) for section, labels in LABELS.items()}
    del pruned["sale_event"]["quantity"]
    monkeypatch.setattr("dis_ui_server.catalog.field_catalog.LABELS", pruned)
    with pytest.raises(FieldCatalogDriftError) as excinfo:
        build_field_catalog()
    assert excinfo.value.missing == ("quantity",)


def test_stale_label_fails_the_build(monkeypatch: pytest.MonkeyPatch) -> None:
    padded = {section: dict(labels) for section, labels in LABELS.items()}
    padded["change_event"]["renamed_away"] = FieldLabel("Ghost", "No such canonical column.")
    monkeypatch.setattr("dis_ui_server.catalog.field_catalog.LABELS", padded)
    with pytest.raises(FieldCatalogDriftError) as excinfo:
        build_field_catalog()
    assert excinfo.value.stale == ("renamed_away",)


def test_signal_history_is_outside_the_catalog_universe() -> None:
    # Not an event model (daily-compute output, D22/D31/D32): it is absent from
    # the routing universe, and the shared provenance accessor would refuse it
    # anyway — so it cannot join the catalog by accident from either direction.
    from dis_canonical import StoreSkuSignalHistory
    from dis_core.errors import SuiteDriftError
    from dis_ui_server.mapping_validation import EVENT_MODELS

    assert StoreSkuSignalHistory not in EVENT_MODELS
    with pytest.raises(SuiteDriftError):
        mapping_produced_columns(StoreSkuSignalHistory)


def test_label_drift_aborts_the_boot_not_just_the_builder(monkeypatch: pytest.MonkeyPatch) -> None:
    # The guarantee is crashloop-at-startup, so prove it through the real app
    # lifespan (create_app + lifespan run), not only the builder function.
    pruned = {section: dict(labels) for section, labels in LABELS.items()}
    del pruned["sale_event"]["quantity"]
    monkeypatch.setattr("dis_ui_server.catalog.field_catalog.LABELS", pruned)
    monkeypatch.setenv("POSTGRES_URL", "postgresql+psycopg://u:p@127.0.0.1:9/ithina_dis_db")
    # Slice 8 required config (lazy construction; the drift abort fires regardless).
    monkeypatch.setenv("GCS_BUCKET_BRONZE", "ithina-bronze-raw")
    monkeypatch.setenv("PUBSUB_PROJECT_ID", "local-dis")
    monkeypatch.setenv("PUBSUB_EMULATOR_HOST", "127.0.0.1:9")
    monkeypatch.setenv("STORAGE_EMULATOR_HOST", "http://127.0.0.1:9")

    from dis_ui_server.main import create_app

    with pytest.raises(FieldCatalogDriftError):
        with TestClient(create_app()):
            pass  # startup must never be reached with a drifted catalog


def test_a_model_side_column_gain_without_a_label_aborts() -> None:
    # A GENUINE model-side gain: an event model with one NEW field, classified
    # mapping-produced in the provenance partition (the state after a future
    # canonical migration + provenance update), but with NO label authored yet.
    # The catalog must refuse to build — otherwise a mappable field would
    # silently vanish from the UI while the validator accepts it.
    from dis_ui_server.catalog.field_catalog import _entries_for
    from dis_ui_server.mapping_validation import SECTION_BY_MODEL
    from dis_validation.provenance import PROVENANCE, ColumnProvenance

    class GainedSaleEvent(StoreSkuSaleEvent):
        brand_new_col: str | None = None

    parent = PROVENANCE[StoreSkuSaleEvent]
    PROVENANCE[GainedSaleEvent] = ColumnProvenance(
        consumer_injected=parent.consumer_injected,
        db_generated=parent.db_generated,
        compute_owned=parent.compute_owned,
        mapping_produced=parent.mapping_produced | {"brand_new_col"},
    )
    SECTION_BY_MODEL[GainedSaleEvent] = "sale_event"
    try:
        with pytest.raises(FieldCatalogDriftError) as excinfo:
            _entries_for(GainedSaleEvent)
        assert excinfo.value.missing == ("brand_new_col",)
    finally:
        del PROVENANCE[GainedSaleEvent]
        del SECTION_BY_MODEL[GainedSaleEvent]


# -- the endpoint: identical across callers, no tenant context, no DB --------------


def test_catalog_identical_for_every_caller(client: TestClient, mint_token: Callable[..., str]) -> None:
    tenant_a = client.get(
        "/api/v1/template-mapping-fields", headers={"Authorization": f"Bearer {mint_token()}"}
    )
    tenant_b = client.get(
        "/api/v1/template-mapping-fields",
        headers={"Authorization": f"Bearer {mint_token(tenant_id=TENANT_B)}"},
    )
    ops = client.get(
        "/api/v1/template-mapping-fields",
        headers={"Authorization": f"Bearer {mint_token(tenant_id=None, roles=('dis:ops',))}"},
    )
    assert tenant_a.status_code == tenant_b.status_code == ops.status_code == 200
    # Byte-identical bodies; and the client's DB is UNREACHABLE, so serving 200
    # at all proves no rls_session / no DB read is involved.
    assert tenant_a.content == tenant_b.content == ops.content
    body = tenant_a.json()
    assert len(body) == 35  # 20 sale + 15 change mapping-produced columns
    assert [e["section"] for e in body] == ["sale_event"] * 20 + ["change_event"] * 15


def test_catalog_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/template-mapping-fields")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth_token"
