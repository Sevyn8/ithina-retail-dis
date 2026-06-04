"""Canonical object-path scheme: frozen shape, UUID tenant segment, no trace_id minting.

Slice 9a AC1/AC2. Q1 finding recorded here: the hand-authored contract `gcs_uri`
char-class (`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`) exactly
matches what ``build_object_path`` emits for a UUID tenant (Python's ``str(UUID)`` is
lowercase 8-4-4-4-12) — no divergence, so the committed contracts stand unchanged and
the builder coerces its tenant input so a string caller cannot emit a non-matching
segment.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

import pytest

from dis_core.errors import DisError, StorageError
from dis_storage.paths import ParsedObjectPath, build_object_path, parse_object_path

_TENANT = "019e89f9-dbd5-7703-8221-ae6b811599bb"
_TRACE = "019e8a00-0000-7000-8000-000000000abc"

# Resolved from libs/dis-storage/tests/unit/ -> repo root (parents[4]) / contracts/pubsub.
_CONTRACTS = Path(__file__).resolve().parents[4] / "contracts" / "pubsub"
_CARRYING_SCHEMAS = (
    "csv.received.schema.json",
    "ingress.ready.schema.json",
    "ingress.resubmit.schema.json",
    "quarantine.schema.json",
)


def _gcs_uri_pattern(schema_name: str) -> re.Pattern[str]:
    schema = json.loads((_CONTRACTS / schema_name).read_text())
    return re.compile(schema["properties"]["gcs_uri"]["pattern"])


def test_storage_error_is_dis_error_rooted() -> None:
    # dis-storage raises only DisError-rooted errors.
    assert issubclass(StorageError, DisError)


def test_builds_the_frozen_scheme() -> None:
    path = build_object_path(
        tenant_id=_TENANT,
        source_id="manual_csv_upload",
        trace_id=_TRACE,
        event_ts=datetime(2026, 6, 3, 14, 30, tzinfo=UTC),
        ext="csv",
    )
    assert path == (f"tenant/{_TENANT}/source/manual_csv_upload/yyyy=2026/mm=06/dd=03/{_TRACE}.csv")


def test_accepts_uuid_object_and_emits_canonical_lowercase() -> None:
    # UUID object in, canonical lowercase segment out — identical to the string form.
    path = build_object_path(
        tenant_id=UUID(_TENANT),
        source_id="manual_csv_upload",
        trace_id=_TRACE,
        event_ts=datetime(2026, 6, 3, tzinfo=UTC),
        ext="csv",
    )
    assert f"tenant/{_TENANT}/" in path


def test_uppercase_tenant_string_normalises_to_canonical_lowercase() -> None:
    # The coercion is what guarantees the contract regex (lowercase-only) matches.
    path = build_object_path(
        tenant_id=_TENANT.upper(),
        source_id="manual_csv_upload",
        trace_id=_TRACE,
        event_ts=datetime(2026, 6, 3, tzinfo=UTC),
        ext="csv",
    )
    assert f"tenant/{_TENANT}/" in path


def test_paths_nonuuid_tenant_rejected() -> None:
    # Named check (Slice 9a): a non-UUID tenant_id is a StorageError, never a path
    # the contract gcs_uri regex would reject downstream.
    with pytest.raises(StorageError, match="not a UUID"):
        build_object_path(
            tenant_id="t_acme9k2l1mn4",  # the retired invented form, the likeliest bad input
            source_id="manual_csv_upload",
            trace_id=_TRACE,
            event_ts=datetime(2026, 6, 3, tzinfo=UTC),
            ext="csv",
        )


def test_strips_leading_dot_on_ext() -> None:
    path = build_object_path(
        tenant_id=_TENANT,
        source_id="s",
        trace_id="tr",
        event_ts=datetime(2026, 1, 9, tzinfo=UTC),
        ext=".json",
    )
    assert path.endswith("/tr.json")


def test_uses_the_caller_trace_id_verbatim_never_mints() -> None:
    # hard rule 4: the caller supplies trace_id; the lib must echo it, not generate one.
    path = build_object_path(
        tenant_id=_TENANT,
        source_id="s",
        trace_id="CALLER-TRACE",
        event_ts=datetime(2026, 1, 9, tzinfo=UTC),
        ext="csv",
    )
    assert path.endswith("/CALLER-TRACE.csv")


def test_normalises_event_ts_to_utc_for_partitioning() -> None:
    # A non-UTC aware ts converts to UTC before the date is taken (stable partitions).
    ist = timezone(timedelta(hours=5, minutes=30))
    # 2026-06-04 02:00 IST == 2026-06-03 20:30 UTC → partition day must be 03.
    path = build_object_path(
        tenant_id=_TENANT,
        source_id="s",
        trace_id="tr",
        event_ts=datetime(2026, 6, 4, 2, 0, tzinfo=ist),
        ext="csv",
    )
    assert "/yyyy=2026/mm=06/dd=03/" in path


@pytest.mark.parametrize("field", ["tenant_id", "source_id", "trace_id", "ext"])
def test_empty_required_field_raises(field: str) -> None:
    kwargs = dict(
        tenant_id=_TENANT,
        source_id="s",
        trace_id="tr",
        event_ts=datetime(2026, 1, 9, tzinfo=UTC),
        ext="csv",
    )
    kwargs[field] = ""
    with pytest.raises(StorageError):
        build_object_path(**kwargs)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# parse_object_path: the inverse (AC1 round-trip, asymmetry asserted).
# ---------------------------------------------------------------------------


def test_round_trip_asserts_the_type_asymmetry() -> None:
    """Build then parse returns the inputs — with the build/parse asymmetry explicit.

    tenant_id round-trips as a **UUID** (coerced, canonical); trace_id round-trips
    as the **exact original string** (verbatim, hard rule 4). A loose "both
    UUID-typed" check could hide trace_id mangling — assert each side precisely.
    """
    event_ts = datetime(2026, 6, 3, 14, 30, tzinfo=UTC)
    path = build_object_path(
        tenant_id=_TENANT,
        source_id="manual_csv_upload",
        trace_id=_TRACE,
        event_ts=event_ts,
        ext="csv",
    )
    parsed = parse_object_path(path)

    assert isinstance(parsed, ParsedObjectPath)
    # tenant: UUID-typed, equal to the canonical form of the input.
    assert isinstance(parsed.tenant_id, UUID)
    assert parsed.tenant_id == UUID(_TENANT)
    # trace: a str, byte-for-byte the original — never coerced, never re-rendered.
    assert isinstance(parsed.trace_id, str)
    assert parsed.trace_id == _TRACE
    assert parsed.source_id == "manual_csv_upload"
    assert (parsed.year, parsed.month, parsed.day) == (2026, 6, 3)
    assert parsed.ext == "csv"


def test_round_trip_preserves_a_non_uuid_trace_verbatim() -> None:
    # The verbatim-echo guarantee holds for any caller trace shape, not just UUIDs.
    path = build_object_path(
        tenant_id=_TENANT,
        source_id="s",
        trace_id="CALLER-TRACE",
        event_ts=datetime(2026, 1, 9, tzinfo=UTC),
        ext="csv",
    )
    assert parse_object_path(path).trace_id == "CALLER-TRACE"


@pytest.mark.parametrize(
    "bad",
    [
        "tenant/t_acme9k2l1mn4/source/s/yyyy=2026/mm=06/dd=03/tr.csv",  # invented form
        f"tenant/{_TENANT.upper()}/source/s/yyyy=2026/mm=06/dd=03/tr.csv",  # uppercase
        f"tenant/{_TENANT}/yyyy=2026/mm=06/dd=03/tr.csv",  # missing source segment
        f"tenant/{_TENANT}/source/s/yyyy=2026/mm=06/dd=03/noext",  # no .ext
        f"gs://bucket/tenant/{_TENANT}/source/s/yyyy=2026/mm=06/dd=03/tr.csv",  # full URI
        "",
    ],
)
def test_parse_rejects_non_canonical_shapes(bad: str) -> None:
    with pytest.raises(StorageError):
        parse_object_path(bad)


# ---------------------------------------------------------------------------
# Contract gcs_uri regex, verified both directions against what the lib emits (AC2).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("schema_name", _CARRYING_SCHEMAS)
def test_built_path_matches_each_contract_gcs_uri_regex(schema_name: str) -> None:
    # Forward direction: a real built path, behind a bucket, passes the frozen regex.
    pattern = _gcs_uri_pattern(schema_name)
    path = build_object_path(
        tenant_id=UUID(_TENANT),
        source_id="shopify_pos_v2",
        trace_id=_TRACE,
        event_ts=datetime(2026, 6, 4, 10, 18, tzinfo=UTC),
        ext="csv",
    )
    assert pattern.match(f"gs://ithina-bronze-raw/{path}")


@pytest.mark.parametrize("schema_name", _CARRYING_SCHEMAS)
@pytest.mark.parametrize(
    "bad_uri",
    [
        # The retired invented tenant form.
        "gs://ithina-bronze-raw/tenant/t_acme9k2l1mn4/source/s/yyyy=2026/mm=06/dd=04/tr.csv",
        # Uppercase UUID segment (the regex is lowercase-only; the builder coerces).
        f"gs://ithina-bronze-raw/tenant/{_TENANT.upper()}/source/s/yyyy=2026/mm=06/dd=04/tr.csv",
        # Missing source segment.
        f"gs://ithina-bronze-raw/tenant/{_TENANT}/yyyy=2026/mm=06/dd=04/tr.csv",
    ],
)
def test_malformed_uris_fail_each_contract_gcs_uri_regex(schema_name: str, bad_uri: str) -> None:
    # Reverse direction: malformed paths must NOT pass.
    assert not _gcs_uri_pattern(schema_name).match(bad_uri)
