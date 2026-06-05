"""AC1/AC11/AC12 units: importable surface, required config, error and contract
discipline.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from dis_core.errors import DisError
from streaming_consumer.config import (
    BATCH_SIZE_ROW_PAIRS,
    INGRESS_READY_SUBSCRIPTION,
    INGRESS_READY_TOPIC,
    ConsumerConfig,
)

_REPO = Path(__file__).resolve().parents[3].parent
_SRC = Path(__file__).resolve().parents[2] / "src" / "streaming_consumer"


def test_importable_surface() -> None:
    # AC1: the service is importable as a package (collection is proven by the
    # suite itself running under the repo testpaths).
    import streaming_consumer.main
    import streaming_consumer.orchestrate

    assert callable(streaming_consumer.main.main)
    assert hasattr(streaming_consumer.orchestrate, "ConsumerPipeline")


def test_frozen_constants() -> None:
    assert INGRESS_READY_TOPIC == "ingress.ready"  # hard rule 10
    assert INGRESS_READY_SUBSCRIPTION == "streaming-consumer.ingress.ready"
    assert BATCH_SIZE_ROW_PAIRS == 500  # architecture 4.6 grain


@pytest.mark.parametrize("missing", ["POSTGRES_URL", "PUBSUB_PROJECT_ID", "GCS_BUCKET_BRONZE"])
def test_required_env_raises_loudly(missing: str, monkeypatch: pytest.MonkeyPatch) -> None:
    # Code-quality rule 4: no silent default for a required value.
    monkeypatch.setenv("POSTGRES_URL", "postgresql+psycopg://u:p@localhost:5433/ithina_dis_db")
    monkeypatch.setenv("PUBSUB_PROJECT_ID", "local-dis")
    monkeypatch.setenv("GCS_BUCKET_BRONZE", "bucket")
    monkeypatch.delenv(missing)
    with pytest.raises(DisError, match=missing):
        ConsumerConfig.from_env()


def test_no_raw_runtime_or_value_errors_raised() -> None:
    # AC12: the service raises dis-core errors. The one sanctioned exception is
    # normalize.py's defensive TypeError on a post-validation impossibility.
    offenders: list[str] = []
    for path in _SRC.rglob("*.py"):
        for line_number, line in enumerate(path.read_text().splitlines(), start=1):
            if re.search(r"raise (RuntimeError|ValueError)\(", line):
                offenders.append(f"{path.name}:{line_number}")
    assert offenders == []


def test_mapping_lookup_stays_template_unaware_until_slice_8a() -> None:
    # Slice 8 / D71 hard limit: the carry is ENVELOPE-ONLY. The active-mapping
    # lookup keys on (tenant, source) with NO template_id predicate until
    # Slice 8a deliberately amends it (which updates this pin). The gate this
    # guards: a second ACTIVE template under one source must not ship before
    # the lookup is template-keyed, or .first() picks an arbitrary mapping.
    mapping_source = (_SRC / "pipeline" / "mapping.py").read_text()
    assert "template_id" not in mapping_source, (
        "pipeline/mapping.py mentions template_id — that is the Slice 8a change; "
        "Slice 8 carries the field on the envelope only (D71)"
    )


def test_contracts_describe_no_ordering_key() -> None:
    # AC11 (D60 resolved as STRIKE): neither contract mentions an ordering key —
    # this is the regression guard on the strike.
    for name in ("ingress.ready.schema.json", "csv.received.schema.json"):
        schema_text = (_REPO / "contracts" / "pubsub" / name).read_text()
        assert "ordering key" not in schema_text.lower(), name
        # The strike was description-only: the schema still parses and the
        # tenant_id property survives intact.
        schema = json.loads(schema_text)
        assert "tenant_id" in schema["properties"]
