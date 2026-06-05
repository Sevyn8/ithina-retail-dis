"""ingress.ready envelope: typed parse, loud contract violations, and the drift guard.

The drift guard reconciles the Pydantic model against the committed contract file
both directions (the 9b/dis-audit reconcile pattern), so neither the model nor
the frozen contract can change without the other noticing (hard rule 10).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from dis_core.errors import EventContractError
from streaming_consumer.envelope import IngressReadyEvent, parse_ingress_ready

# services/streaming-consumer/tests/unit/ -> repo root / contracts/pubsub.
_CONTRACTS = Path(__file__).resolve().parents[3].parent / "contracts" / "pubsub"
_SCHEMA = json.loads((_CONTRACTS / "ingress.ready.schema.json").read_text())


def _good_payload() -> dict[str, object]:
    return {
        "schema_version": 1,
        "trace_id": "019e9508-0000-7000-8000-000000000001",
        "tenant_id": "019e89f9-dbd5-7703-8221-ae6b811599bb",
        "store_id": "019e89f9-dbd5-7703-8221-ae8bfa6528bf",
        "source_id": "sc_pos_v1",
        "template_id": "019e98c9-df80-7649-98cd-83fb6293777a",  # Slice 8 carry (D71)
        "bronze_ref": "019e9508-0000-7000-8000-000000000002",
        "gcs_uri": (
            "gs://ithina-bronze-raw/tenant/019e89f9-dbd5-7703-8221-ae6b811599bb/"
            "source/sc_pos_v1/yyyy=2026/mm=06/dd=05/019e9508-0000-7000-8000-000000000001.csv"
        ),
        "received_ts": "2026-06-05T12:00:00+00:00",
        "tenant_display_code": "acme-retail",
        "store_code": "AC-001",
    }


def test_good_payload_parses() -> None:
    event = parse_ingress_ready(json.dumps(_good_payload()).encode())
    assert event.schema_version == 1
    assert event.source_id == "sc_pos_v1"
    # Parsed, NOT consumed (Slice 8 / D71): the lookup stays template-unaware
    # until Slice 8a — a regression test in test_service_surface pins that.
    assert str(event.template_id) == "019e98c9-df80-7649-98cd-83fb6293777a"
    assert event.replay is False  # absent -> the contract default
    assert event.received_ts.tzinfo is not None


@pytest.mark.parametrize(
    "mutation",
    [
        ("trace_id", None),  # required, removed
        ("tenant_id", "not-a-uuid"),
        ("schema_version", 2),  # const: 1
        ("source_id", ""),  # min length
        ("template_id", None),  # required since Slice 8 (D71 carry)
        ("template_id", "not-a-uuid"),
        ("bronze_ref", None),
    ],
)
def test_contract_violations_raise_loudly(mutation: tuple[str, object]) -> None:
    field, value = mutation
    payload = _good_payload()
    if value is None:
        payload.pop(field)
    else:
        payload[field] = value
    with pytest.raises(EventContractError):
        parse_ingress_ready(json.dumps(payload).encode())


def test_extra_field_forbidden() -> None:
    payload = _good_payload()
    payload["surprise"] = "x"  # additionalProperties: false -> extra='forbid'
    with pytest.raises(EventContractError):
        parse_ingress_ready(json.dumps(payload).encode())


def test_not_json_raises() -> None:
    with pytest.raises(EventContractError, match="not valid JSON"):
        parse_ingress_ready(b"\x00\x01")
    with pytest.raises(EventContractError, match="not a JSON object"):
        parse_ingress_ready(b"[1, 2]")


def test_contract_error_carries_identifier_context() -> None:
    payload = _good_payload()
    payload["bronze_ref"] = "nope"
    try:
        parse_ingress_ready(json.dumps(payload).encode())
    except EventContractError as exc:
        assert exc.tenant_id == payload["tenant_id"]  # identifiers, never payload
        assert exc.trace_id == payload["trace_id"]
    else:  # pragma: no cover
        pytest.fail("expected EventContractError")


# ---------------------------------------------------------------------------
# Drift guard: model field set == contract field set, both directions.
# ---------------------------------------------------------------------------


def test_model_fields_match_contract_properties_exactly() -> None:
    model_fields = set(IngressReadyEvent.model_fields)
    contract_fields = set(_SCHEMA["properties"])
    assert model_fields == contract_fields, (
        f"model-only: {model_fields - contract_fields}; contract-only: {contract_fields - model_fields}"
    )


def test_model_required_set_matches_contract_required() -> None:
    model_required = {name for name, info in IngressReadyEvent.model_fields.items() if info.is_required()}
    assert model_required == set(_SCHEMA["required"])


def test_contract_is_additional_properties_false() -> None:
    # The model's extra='forbid' is only correct while the contract says so.
    assert _SCHEMA["additionalProperties"] is False
