"""The frozen canonical GCS object-path scheme (root CLAUDE.md hard rule 9).

    tenant/{tenant_id}/source/{source_id}/yyyy={Y}/mm={M}/dd={D}/{trace_id}.{ext}

Tenant prefix first (the security boundary), source second (operational queries),
date partitioning last (lifecycle rules). Confirmed verbatim against
``libs/dis-storage/README.md``. Never improvise another shape.

The caller supplies ``trace_id`` (hard rule 4: the lib never mints it). The date
segments come from ``event_ts``, normalised to UTC so partitioning is stable
regardless of the caller's timezone.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from dis_core.errors import StorageError
from dis_core.timestamps import ensure_utc


def build_object_path(
    *,
    tenant_id: UUID | str,
    source_id: str,
    trace_id: UUID | str,
    event_ts: datetime,
    ext: str,
) -> str:
    """Build the canonical object path (the key within the bronze bucket).

    Raises :class:`StorageError` if a required identifier is empty. Does not mint any
    identifier and performs no I/O.
    """
    tid = str(tenant_id).strip()
    sid = source_id.strip()
    trace = str(trace_id).strip()
    extension = ext.strip().lstrip(".")

    missing = [
        name
        for name, value in (
            ("tenant_id", tid),
            ("source_id", sid),
            ("trace_id", trace),
            ("ext", extension),
        )
        if not value
    ]
    if missing:
        raise StorageError(
            f"cannot build object path: empty required field(s): {', '.join(missing)}",
            tenant_id=tid or None,
            trace_id=trace or None,
        )

    ts = ensure_utc(event_ts)
    return (
        f"tenant/{tid}/source/{sid}/yyyy={ts.year:04d}/mm={ts.month:02d}/dd={ts.day:02d}/{trace}.{extension}"
    )
