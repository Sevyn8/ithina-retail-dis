"""Subscriber message routing: terminal -> ack, transient -> nack (redelivery
converges via idempotency), malformed envelope -> ack after the loud error."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest

from csv_ingest_worker.pipeline import IngestOutcome
from csv_ingest_worker.subscriber import Subscriber, process_message
from dis_core.errors import (
    CsvIngestError,
    EventPathMismatchError,
    PiiBackendNotConfiguredError,
)

_CONTRACTS = Path(__file__).resolve().parents[3].parent / "contracts" / "pubsub"
_EXAMPLE_BYTES = (_CONTRACTS / "csv.received.example.json").read_bytes()
_EXAMPLE = json.loads(_EXAMPLE_BYTES)


class _StubPipeline:
    """A pipeline stand-in: returns an outcome, or raises what it is given."""

    def __init__(self, *, raises: Exception | None = None) -> None:
        self._raises = raises
        self.processed: list[Any] = []

    async def process(self, event: Any) -> IngestOutcome:
        self.processed.append(event)
        if self._raises is not None:
            raise self._raises
        return IngestOutcome(disposition="ingested", trace_id=UUID(_EXAMPLE["trace_id"]), bronze_id=None)


async def test_success_acks() -> None:
    pipeline = _StubPipeline()
    assert await process_message(pipeline, _EXAMPLE_BYTES) == "ack"  # type: ignore[arg-type]
    assert len(pipeline.processed) == 1


async def test_malformed_envelope_acks_without_processing() -> None:
    # Terminal: a redelivery of the same malformed envelope fails identically.
    pipeline = _StubPipeline()
    assert await process_message(pipeline, b"not json at all") == "ack"  # type: ignore[arg-type]
    assert pipeline.processed == []


@pytest.mark.parametrize(
    "terminal",
    [
        EventPathMismatchError("path disagrees", field="tenant_id"),
        PiiBackendNotConfiguredError("pii with no backend", columns=("customer_email",)),
    ],
)
async def test_terminal_failures_ack(terminal: Exception) -> None:
    pipeline = _StubPipeline(raises=terminal)
    assert await process_message(pipeline, _EXAMPLE_BYTES) == "ack"  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "transient",
    [
        ConnectionError("postgres unreachable"),
        RuntimeError("gcs emulator down"),
        OSError("publish transport failure"),
    ],
)
async def test_transient_failures_nack_for_redelivery(transient: Exception) -> None:
    pipeline = _StubPipeline(raises=transient)
    assert await process_message(pipeline, _EXAMPLE_BYTES) == "nack"  # type: ignore[arg-type]


def test_subscriber_refuses_real_pubsub(monkeypatch: pytest.MonkeyPatch) -> None:
    # Cloud wiring is deferred infra; without the emulator the subscriber refuses
    # loudly at construction (before any subscription check).
    monkeypatch.delenv("PUBSUB_EMULATOR_HOST", raising=False)
    with pytest.raises(CsvIngestError, match="PUBSUB_EMULATOR_HOST"):
        Subscriber(project_id="local-dis", pipeline=_StubPipeline())  # type: ignore[arg-type]
