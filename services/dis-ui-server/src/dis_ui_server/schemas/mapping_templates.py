"""Wire shapes for the ``/mapping-templates`` resource (list, detail, create, patch).

The resource is the TEMPLATE (a lineage of versions, D68); versions are nested
data. ``mapping_rules`` is served as the RAW validated D49 document — the
``dis_mapping.SourceMapping`` model itself is the wire type, so the serve-shape
and the validate-shape are one model and cannot drift, and an edit round-trips
the exact locale/format declarations instead of forcing the UI to re-invent
them (never-default locale). Requests carry ``mapping_rules`` as a plain dict;
the handler validates explicitly via ``mapping_validation.validate_mapping_rules``
(a malformed document is a 400 ``MappingConfigError`` through the §2.3 envelope,
never a 500 from inside body parsing and never a stored-invalid-config write).

Status vocabulary is lowercased on the wire (§2.6); DRAFT IS surfaced on this
template surface (it is the editable head of a lineage) — a deliberate,
documented supersession of the older version-list rule (API_CONTRACT §7).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from dis_mapping import SourceMapping

MappingTemplateStatus = Literal["draft", "staged", "active", "deprecated"]


class MappingTemplateVersion(BaseModel):
    """One version row of the lineage, rules served raw (D49)."""

    mapping_version_id: int  # global BIGSERIAL — the D22 canonical-row pin / audit reference
    version: int  # = version_seq_per_source (per-template counter, §2.6 wire name)
    status: MappingTemplateStatus
    mapping_rules: SourceMapping
    field_count: int  # len(rename) — display convenience, not a lossy rules rendering
    transform_count: int  # entries across normalize + cast + derive
    predecessor_version_id: int | None
    created_at: datetime
    created_by_user_id: str | None  # raw UUID string or null (Blocker 5 / D56 pending)
    activated_at: datetime | None
    deprecated_at: datetime | None


class MappingTemplate(BaseModel):
    """Lineage summary — one list entry per template."""

    template_id: str  # UUID, lowercase string
    source_id: str
    template_name: str
    latest_version: int
    active_version: int | None
    staged_version: int | None
    draft_version: int | None
    versions_count: int
    created_at: datetime  # earliest version's created_at (template birth)
    latest_version_created_at: datetime


class MappingTemplateDetail(MappingTemplate):
    """The template with its full version lineage (version desc, DRAFT + DEPRECATED included)."""

    versions: list[MappingTemplateVersion]


class MappingTemplateCreate(BaseModel):
    """``POST /mapping-templates`` body. v1 is hand-authored: the operator supplies
    the ``source_id`` (validated well-formed only — no source registry exists, a
    deliberate slice limit) and the full D49 rules document."""

    source_id: str = Field(pattern=r"^[a-z0-9_]{1,128}$")
    template_name: str = Field(min_length=1, max_length=200)
    mapping_rules: dict[str, Any]


class MappingTemplatePatch(BaseModel):
    """``PATCH /mapping-templates/{template_id}`` body — at least one field present.

    ``template_name`` renames the LINEAGE (all version rows; D17 immutability
    covers version content, not the lineage label). ``mapping_rules`` edits the
    DRAFT in place, or mints a new DRAFT version chained to the STAGED/ACTIVE
    head when none exists.
    """

    template_name: str | None = Field(default=None, min_length=1, max_length=200)
    mapping_rules: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _at_least_one(self) -> MappingTemplatePatch:
        if self.template_name is None and self.mapping_rules is None:
            raise ValueError("PATCH body must carry template_name and/or mapping_rules")
        return self
