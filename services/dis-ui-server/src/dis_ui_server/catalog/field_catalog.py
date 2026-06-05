"""Build the template-mapping-fields catalog — one canonical truth, built at startup.

STRUCTURAL facts (which columns are mappable, mandatory-ness, datatype, allowed
values, max length) are DERIVED here from exactly the sources the create/edit
validator uses: ``dis_validation.mapping_produced_columns`` (the drift-guarded
provenance partition — NOT raw ``model_fields``, which would wrongly expose
consumer-injected columns like ``trace_id`` as "mappable") intersected with the
dis-canonical models' field annotations. AUTHORED facts (display name,
description) come from ``labels.py``, merged by key under a both-directions
drift check that raises ``FieldCatalogDriftError`` — the builder runs in the app
lifespan, so drift fails the BOOT loudly (crashloop is the correct
misconfiguration signal), never a half-true catalog at runtime.

The catalog is tenant-independent and immutable per process (its inputs are code
constants); it is built ONCE at startup and served from memory — no
``rls_session``, no DB, no per-request recompute.
"""

from __future__ import annotations

import enum
import types
import typing
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel

from dis_core.errors import FieldCatalogDriftError
from dis_ui_server.catalog.labels import LABELS
from dis_ui_server.mapping_validation import EVENT_MODELS, SECTION_BY_MODEL, mandatory_mapping_produced
from dis_ui_server.schemas.mapping_fields import FieldDatatype, TemplateMappingField
from dis_validation import mapping_produced_columns


def _unwrap_optional(annotation: Any) -> Any:
    """Drop ``None`` from ``X | None`` / ``Optional[X]``; return the remaining type."""
    if typing.get_origin(annotation) in (typing.Union, types.UnionType):
        members = [arg for arg in typing.get_args(annotation) if arg is not type(None)]
        if len(members) == 1:
            return members[0]
    return annotation


def _split_annotated(annotation: Any) -> tuple[Any, tuple[Any, ...]]:
    """Split ``Annotated[base, *meta]`` into (base, meta); plain types pass through."""
    if typing.get_args(annotation) and hasattr(annotation, "__metadata__"):
        args = typing.get_args(annotation)
        return args[0], tuple(args[1:])
    return annotation, ()


def _max_length(metadata: tuple[Any, ...]) -> int | None:
    """The declared max string length, wherever pydantic stashed it."""
    for item in metadata:
        length = getattr(item, "max_length", None)
        if isinstance(length, int):
            return length
    return None


def _datatype_and_values(base: Any) -> tuple[FieldDatatype, list[str] | None]:
    """The friendly datatype label + allowed values for choice/enum types."""
    if typing.get_origin(base) is typing.Literal:
        return "choice", [str(value) for value in typing.get_args(base)]
    if isinstance(base, type) and issubclass(base, enum.Enum):
        return "choice", [str(member.value) for member in base]
    if base is Any or typing.get_origin(base) is dict or base is dict:
        return "json", None
    if isinstance(base, type):
        # bool before int (bool subclasses int); datetime before date likewise.
        if issubclass(base, bool):
            return "boolean", None
        if issubclass(base, int):
            return "integer", None
        if issubclass(base, Decimal):
            return "number", None
        if issubclass(base, datetime):
            return "datetime", None
        if issubclass(base, date):
            return "date", None
        if issubclass(base, str):
            return "text", None
    raise FieldCatalogDriftError(
        f"cannot derive a friendly datatype for annotation {base!r}; the catalog "
        "builder's type dispatch must learn it before the column can be served"
    )


def _entries_for(model: type[BaseModel]) -> list[TemplateMappingField]:
    """Derive + merge one model's catalog entries, in model declaration order."""
    section = SECTION_BY_MODEL[model]
    produced = mapping_produced_columns(model)  # runs assert_no_drift (provenance guard)
    mandatory = mandatory_mapping_produced(model)
    authored = LABELS.get(section, {})

    derived_keys = [name for name in model.model_fields if name in produced]
    missing = tuple(sorted(set(derived_keys) - set(authored)))
    stale = tuple(sorted(set(authored) - set(derived_keys)))
    if missing or stale:
        raise FieldCatalogDriftError(
            f"field-catalog labels drifted for section {section!r}: "
            f"missing={list(missing)} stale={list(stale)} — every mapping-produced "
            "column needs exactly one authored label (catalog/labels.py)",
            missing=missing,
            stale=stale,
        )

    entries: list[TemplateMappingField] = []
    for name in derived_keys:
        field = model.model_fields[name]
        # Constraints may sit on FieldInfo.metadata (required fields) or inside an
        # Optional-wrapped Annotated (optional fields) — handle both placements.
        base, inline_meta = _split_annotated(_unwrap_optional(field.annotation))
        datatype, allowed_values = _datatype_and_values(base)
        label = authored[name]
        entries.append(
            TemplateMappingField(
                key=name,
                display_name=label.display_name,
                section=section,
                mandatory=name in mandatory,
                datatype=datatype,
                description=label.description,
                allowed_values=allowed_values,
                max_length=_max_length(tuple(field.metadata) + inline_meta),
            )
        )
    return entries


def build_field_catalog() -> list[TemplateMappingField]:
    """The full catalog: both event-model sections, stable order (section, declaration)."""
    catalog: list[TemplateMappingField] = []
    for model in EVENT_MODELS:
        catalog.extend(_entries_for(model))
    return catalog
