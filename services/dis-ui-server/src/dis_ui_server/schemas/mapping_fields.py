"""Wire shape for ``GET /template-mapping-fields`` (bare array; identical for every tenant).

One entry per (section, canonical column): a column mappable in both template
kinds (e.g. ``sku_id``) appears once per section, because mandatory-ness and
guidance are per routed model. ``mandatory`` means "must be PROVIDED by the
template — by rename or by a constant/copy/date_from_datetime derive", not "a
CSV column must point at it".
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

FieldSection = Literal["sale_event", "change_event"]
FieldDatatype = Literal["text", "integer", "number", "date", "datetime", "boolean", "choice", "json"]


class TemplateMappingField(BaseModel):
    """One mappable canonical field, structure derived + labels authored."""

    key: str  # canonical column name — the exact mapping_rules target
    display_name: str
    section: FieldSection
    mandatory: bool
    datatype: FieldDatatype
    description: str
    allowed_values: list[str] | None = None  # choice fields only
    max_length: int | None = None  # text fields with a declared cap
