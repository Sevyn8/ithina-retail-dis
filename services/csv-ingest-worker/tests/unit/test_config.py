"""WorkerConfig: required env resolves; a missing required value raises (rule 4)."""

from __future__ import annotations

import pytest

from csv_ingest_worker.config import (
    CSV_RECEIVED_SUBSCRIPTION,
    CSV_RECEIVED_TOPIC,
    DEDUP_WINDOW_HOURS,
    INGRESS_READY_TOPIC,
    WorkerConfig,
)
from dis_core.errors import CsvIngestError, DisError

_DIS_URL = "postgresql+psycopg://u:p@localhost:5433/ithina_dis_db"


def _set_all(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POSTGRES_URL", _DIS_URL)
    monkeypatch.setenv("PUBSUB_PROJECT_ID", "local-dis")
    monkeypatch.setenv("GCS_BUCKET_BRONZE", "ithina-bronze-raw")


def test_resolves_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_all(monkeypatch)
    cfg = WorkerConfig.from_env()
    assert cfg.postgres_url == _DIS_URL
    assert cfg.pubsub_project_id == "local-dis"
    assert cfg.bronze_bucket == "ithina-bronze-raw"


@pytest.mark.parametrize("missing", ["POSTGRES_URL", "PUBSUB_PROJECT_ID", "GCS_BUCKET_BRONZE"])
def test_missing_required_value_raises_dis_error(monkeypatch: pytest.MonkeyPatch, missing: str) -> None:
    # No silent fallback for a required value (code-quality rule 4); the error is
    # DisError-rooted and names the missing variable.
    _set_all(monkeypatch)
    monkeypatch.delenv(missing)
    with pytest.raises(CsvIngestError, match=missing):
        WorkerConfig.from_env()
    assert issubclass(CsvIngestError, DisError)


@pytest.mark.parametrize("empty", ["POSTGRES_URL", "PUBSUB_PROJECT_ID", "GCS_BUCKET_BRONZE"])
def test_empty_required_value_raises(monkeypatch: pytest.MonkeyPatch, empty: str) -> None:
    _set_all(monkeypatch)
    monkeypatch.setenv(empty, "")
    with pytest.raises(CsvIngestError, match=empty):
        WorkerConfig.from_env()


def test_contract_names_are_frozen_constants() -> None:
    # Topic/subscription names are contract constants (hard rule 10), not env config.
    assert CSV_RECEIVED_TOPIC == "csv.received"
    assert INGRESS_READY_TOPIC == "ingress.ready"
    assert CSV_RECEIVED_SUBSCRIPTION == "csv-ingest-worker.csv.received"
    assert DEDUP_WINDOW_HOURS == 24
