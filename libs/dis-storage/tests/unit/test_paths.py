"""Canonical object-path scheme (AC6 path, AC7): frozen shape, no trace_id minting."""

from __future__ import annotations

from datetime import UTC, datetime, timezone

import pytest

from dis_core.errors import DisError, StorageError
from dis_storage.paths import build_object_path


def test_storage_error_is_dis_error_rooted() -> None:
    # AC7: dis-storage raises only DisError-rooted errors.
    assert issubclass(StorageError, DisError)


def test_builds_the_frozen_scheme() -> None:
    path = build_object_path(
        tenant_id="019e89f9-dbd5-7703-8221-ae6b811599bb",
        source_id="manual_csv_upload",
        trace_id="019e8a00-0000-7000-8000-000000000abc",
        event_ts=datetime(2026, 6, 3, 14, 30, tzinfo=UTC),
        ext="csv",
    )
    assert path == (
        "tenant/019e89f9-dbd5-7703-8221-ae6b811599bb/"
        "source/manual_csv_upload/yyyy=2026/mm=06/dd=03/"
        "019e8a00-0000-7000-8000-000000000abc.csv"
    )


def test_strips_leading_dot_on_ext() -> None:
    path = build_object_path(
        tenant_id="t",
        source_id="s",
        trace_id="tr",
        event_ts=datetime(2026, 1, 9, tzinfo=UTC),
        ext=".json",
    )
    assert path.endswith("/tr.json")


def test_uses_the_caller_trace_id_verbatim_never_mints() -> None:
    # hard rule 4: the caller supplies trace_id; the lib must echo it, not generate one.
    path = build_object_path(
        tenant_id="t",
        source_id="s",
        trace_id="CALLER-TRACE",
        event_ts=datetime(2026, 1, 9, tzinfo=UTC),
        ext="csv",
    )
    assert path.endswith("/CALLER-TRACE.csv")


def test_normalises_event_ts_to_utc_for_partitioning() -> None:
    # A non-UTC aware ts converts to UTC before the date is taken (stable partitions).
    from datetime import timedelta

    ist = timezone(timedelta(hours=5, minutes=30))
    # 2026-06-04 02:00 IST == 2026-06-03 20:30 UTC → partition day must be 03.
    path = build_object_path(
        tenant_id="t",
        source_id="s",
        trace_id="tr",
        event_ts=datetime(2026, 6, 4, 2, 0, tzinfo=ist),
        ext="csv",
    )
    assert "/yyyy=2026/mm=06/dd=03/" in path


@pytest.mark.parametrize("field", ["tenant_id", "source_id", "trace_id", "ext"])
def test_empty_required_field_raises(field: str) -> None:
    kwargs = dict(
        tenant_id="t",
        source_id="s",
        trace_id="tr",
        event_ts=datetime(2026, 1, 9, tzinfo=UTC),
        ext="csv",
    )
    kwargs[field] = ""
    with pytest.raises(StorageError):
        build_object_path(**kwargs)  # type: ignore[arg-type]
