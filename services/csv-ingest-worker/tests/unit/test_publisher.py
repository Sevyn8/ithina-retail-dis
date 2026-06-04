"""ingress.ready envelope: frozen-contract population + drift guard (AC6) and the
real-Pub/Sub refuse guard."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from csv_ingest_worker.envelope import parse_csv_received
from csv_ingest_worker.publisher import (
    IngressReadyEnvelope,
    PubsubPublisher,
    build_ingress_ready,
)
from dis_core.errors import CsvIngestError

_CONTRACTS = Path(__file__).resolve().parents[3].parent / "contracts" / "pubsub"
_SCHEMA = json.loads((_CONTRACTS / "ingress.ready.schema.json").read_text())
_CSV_EXAMPLE = json.loads((_CONTRACTS / "csv.received.example.json").read_text())

_BRONZE_ID = UUID("019e93f0-57ca-7470-9899-ba6532ff15e1")
_RECEIVED_AT = datetime(2026, 6, 5, 11, 30, 12, tzinfo=UTC)


def _event_bytes(**overrides: object) -> bytes:
    payload = dict(_CSV_EXAMPLE)
    payload.update(overrides)
    return json.dumps(payload).encode()


def _build(**event_overrides: object) -> IngressReadyEnvelope:
    event = parse_csv_received(_event_bytes(**event_overrides))
    return build_ingress_ready(
        event, trace_id=event.trace_id, bronze_ref=_BRONZE_ID, received_at=_RECEIVED_AT
    )


# ---------------------------------------------------------------------------
# Population: every required field, identity from the event, codes verbatim.
# ---------------------------------------------------------------------------


def test_populates_every_required_field_from_event_and_bronze() -> None:
    envelope = _build()
    assert envelope.schema_version == 1
    assert envelope.trace_id == UUID(_CSV_EXAMPLE["trace_id"])  # READ, never minted
    assert envelope.tenant_id == UUID(_CSV_EXAMPLE["tenant_id"])
    assert envelope.store_id == UUID(_CSV_EXAMPLE["store_id"])
    assert envelope.source_id == _CSV_EXAMPLE["source_id"]
    assert envelope.bronze_ref == _BRONZE_ID
    assert envelope.gcs_uri == _CSV_EXAMPLE["gcs_uri"]
    # received_ts is when DIS durably accepted (bronze received_at), NOT the
    # producer's csv.received.received_ts (the dual-received_ts note, D59).
    assert envelope.received_ts == _RECEIVED_AT
    assert envelope.replay is False
    assert envelope.parent_trace_id is None


def test_codes_propagated_verbatim() -> None:
    envelope = _build()
    assert envelope.tenant_display_code == _CSV_EXAMPLE["tenant_display_code"]
    assert envelope.store_code == _CSV_EXAMPLE["store_code"]


def test_absent_codes_are_omitted_never_fabricated() -> None:
    payload = dict(_CSV_EXAMPLE)
    del payload["tenant_display_code"]
    del payload["store_code"]
    event = parse_csv_received(json.dumps(payload).encode())
    envelope = build_ingress_ready(
        event, trace_id=event.trace_id, bronze_ref=_BRONZE_ID, received_at=_RECEIVED_AT
    )
    wire = json.loads(envelope.to_bytes())
    assert "tenant_display_code" not in wire
    assert "store_code" not in wire


def test_resume_path_publishes_under_the_passed_prior_trace() -> None:
    # D59: the resume branch publishes under the PRIOR ingest's trace_id, which the
    # builder takes explicitly — also a read trace, never minted.
    event = parse_csv_received(_event_bytes())
    prior_trace = UUID("019e0000-0000-7000-8000-00000000aaaa")
    envelope = build_ingress_ready(
        event, trace_id=prior_trace, bronze_ref=_BRONZE_ID, received_at=_RECEIVED_AT
    )
    assert envelope.trace_id == prior_trace


# ---------------------------------------------------------------------------
# The wire form validates against the FROZEN contract (Draft 2020-12 + formats),
# the same validator the repo contract tests use.
# ---------------------------------------------------------------------------


def test_wire_form_validates_against_frozen_contract() -> None:
    wire = json.loads(_build().to_bytes())
    Draft202012Validator.check_schema(_SCHEMA)
    Draft202012Validator(_SCHEMA, format_checker=FormatChecker()).validate(wire)


def test_wire_form_without_codes_still_validates() -> None:
    payload = dict(_CSV_EXAMPLE)
    del payload["tenant_display_code"]
    del payload["store_code"]
    event = parse_csv_received(json.dumps(payload).encode())
    envelope = build_ingress_ready(
        event, trace_id=event.trace_id, bronze_ref=_BRONZE_ID, received_at=_RECEIVED_AT
    )
    Draft202012Validator(_SCHEMA, format_checker=FormatChecker()).validate(json.loads(envelope.to_bytes()))


# ---------------------------------------------------------------------------
# Drift guard: model field set == contract field set, both directions.
# ---------------------------------------------------------------------------


def test_model_fields_match_contract_properties_exactly() -> None:
    model_fields = set(IngressReadyEnvelope.model_fields)
    contract_fields = set(_SCHEMA["properties"])
    assert model_fields == contract_fields, (
        f"model-only: {model_fields - contract_fields}; contract-only: {contract_fields - model_fields}"
    )


def test_model_required_set_matches_contract_required() -> None:
    model_required = {name for name, info in IngressReadyEnvelope.model_fields.items() if info.is_required()}
    # schema_version is contract-required but model-defaulted (const 1, always
    # emitted on the wire — asserted by the wire-form validation test above).
    assert model_required | {"schema_version"} == set(_SCHEMA["required"])


def test_contract_is_additional_properties_false() -> None:
    assert _SCHEMA["additionalProperties"] is False


# ---------------------------------------------------------------------------
# Runtime publisher refuses real Pub/Sub (cloud wiring is deferred infra).
# ---------------------------------------------------------------------------


def test_publisher_refuses_real_pubsub(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PUBSUB_EMULATOR_HOST", raising=False)
    with pytest.raises(CsvIngestError, match="PUBSUB_EMULATOR_HOST"):
        PubsubPublisher(project_id="local-dis")
