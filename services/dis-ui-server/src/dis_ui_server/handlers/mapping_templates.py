"""The ``/mapping-templates`` resource (slice 14b c/d/e) — template-grain CRUD.

The resource is the TEMPLATE (a lineage of versions, D68); ``{template_id}`` is
the only URL key. Reads and writes run through ``repos/mapping_templates.py``
(``rls_session``, tenant from token). Detail/PATCH lookups are throw-style 404
(``ResourceNotFoundError``) — under RLS, absent and other-tenant are the same
404, no existence oracle. Create and edit write DRAFT rows only; lifecycle
transitions (promote/reject) and the ``mapping.changed`` publish are a later
slice — DRAFT writes are invisible to the streaming consumer, which reads
``status='ACTIVE'`` only.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy import Row
from sqlalchemy.ext.asyncio import AsyncEngine

from dis_core.errors import ResourceNotFoundError
from dis_core.ids import new_uuid7
from dis_mapping import SourceMapping
from dis_ui_server.auth.identity import Identity
from dis_ui_server.auth.scope import require_tenant, tenant_uuid_of
from dis_ui_server.mapping_validation import validate_mapping_rules
from dis_ui_server.repos.mapping_templates import (
    create_template,
    get_template_rows,
    list_template_rows,
    patch_template,
)
from dis_ui_server.schemas.mapping_templates import (
    MappingTemplate,
    MappingTemplateCreate,
    MappingTemplateDetail,
    MappingTemplatePatch,
    MappingTemplateStatus,
    MappingTemplateVersion,
)

router = APIRouter()

# §2.6 vocabulary translation, pinned explicitly (a new DB status fails loud).
_STATUS_WIRE: dict[str, MappingTemplateStatus] = {
    "DRAFT": "draft",
    "STAGED": "staged",
    "ACTIVE": "active",
    "DEPRECATED": "deprecated",
}


def _created_by_uuid(identity: Identity) -> UUID | None:
    """The token ``sub`` as a UUID where it is one; NULL otherwise (column is
    nullable by design — the real claim vocabulary is unsigned, D56/Blocker 5)."""
    try:
        return UUID(identity.user_id)
    except ValueError:
        return None


def _to_version(row: Row[Any]) -> MappingTemplateVersion:
    # Stored rules always parse: every write validated them (a failure here is
    # real corruption and a correct 500, never papered over).
    rules = SourceMapping.model_validate(row.mapping_rules)
    return MappingTemplateVersion(
        mapping_version_id=row.mapping_version_id,
        version=row.version_seq_per_source,
        status=_STATUS_WIRE[row.status],
        mapping_rules=rules,
        field_count=len(rules.rename),
        transform_count=(
            sum(len(specs) for specs in rules.normalize.values())
            + len(rules.cast)
            + sum(len(specs) for specs in rules.derive.values())
        ),
        predecessor_version_id=row.predecessor_version_id,
        created_at=row.created_at,
        created_by_user_id=str(row.created_by_user_id) if row.created_by_user_id else None,
        activated_at=row.activated_at,
        deprecated_at=row.deprecated_at,
    )


def _version_seq_for(rows: Sequence[Row[Any]], status: str) -> int | None:
    return next((row.version_seq_per_source for row in rows if row.status == status), None)


def _summary_fields(rows: Sequence[Row[Any]]) -> dict[str, Any]:
    """Lineage summary off one template's rows (any order)."""
    newest = max(rows, key=lambda row: row.version_seq_per_source)
    return {
        "template_id": str(newest.template_id),
        "source_id": newest.source_id,
        "template_name": newest.template_name,
        "latest_version": newest.version_seq_per_source,
        "active_version": _version_seq_for(rows, "ACTIVE"),
        "staged_version": _version_seq_for(rows, "STAGED"),
        "draft_version": _version_seq_for(rows, "DRAFT"),
        "versions_count": len(rows),
        "created_at": min(row.created_at for row in rows),
        "latest_version_created_at": max(row.created_at for row in rows),
    }


def _to_detail(rows: Sequence[Row[Any]]) -> MappingTemplateDetail:
    ordered = sorted(rows, key=lambda row: row.version_seq_per_source, reverse=True)
    return MappingTemplateDetail(
        **_summary_fields(ordered),
        versions=[_to_version(row) for row in ordered],
    )


@router.get("/mapping-templates")
async def list_mapping_templates(
    request: Request,
    identity: Annotated[Identity, Depends(require_tenant)],
    source_id: str | None = None,
) -> list[MappingTemplate]:
    """The tenant's templates (lineage summaries), order (source_id, template_name)."""
    engine: AsyncEngine = request.app.state.engine
    rows = await list_template_rows(engine, tenant_uuid_of(identity), source_id=source_id)
    by_template: dict[UUID, list[Row[Any]]] = {}
    for row in rows:  # rows arrive lineage-grouped; group defensively anyway
        by_template.setdefault(row.template_id, []).append(row)
    summaries = [MappingTemplate(**_summary_fields(group)) for group in by_template.values()]
    return sorted(summaries, key=lambda t: (t.source_id, t.template_name))


@router.get("/mapping-templates/{template_id}")
async def get_mapping_template(
    request: Request,
    identity: Annotated[Identity, Depends(require_tenant)],
    template_id: UUID,
) -> MappingTemplateDetail:
    """One template with its full version lineage; 404 throw-style when invisible."""
    engine: AsyncEngine = request.app.state.engine
    tenant_id = tenant_uuid_of(identity)
    rows = await get_template_rows(engine, tenant_id, template_id)
    if not rows:
        raise ResourceNotFoundError(
            f"mapping template {template_id} not found",
            resource="mapping_template",
            identifier=str(template_id),
            tenant_id=str(tenant_id),
        )
    return _to_detail(rows)


@router.post("/mapping-templates", status_code=201)
async def create_mapping_template(
    request: Request,
    identity: Annotated[Identity, Depends(require_tenant)],
    body: MappingTemplateCreate,
) -> MappingTemplateDetail:
    """Create a template: mint the UUIDv7 ``template_id``, write its v1 DRAFT.

    The rules document passes the full four-step gate (D49 shape, non-empty
    rename, exactly-one-model routing, mandatory coverage) BEFORE any write; the
    stored JSONB is the validated model's dump, byte-aligned with what reads
    serve. A duplicate ``template_name`` is a clean 409, never a 500.
    """
    engine: AsyncEngine = request.app.state.engine
    tenant_id = tenant_uuid_of(identity)
    source = validate_mapping_rules(body.mapping_rules, tenant_id=str(tenant_id))
    row = await create_template(
        engine,
        tenant_id,
        template_id=new_uuid7(),
        source_id=body.source_id,
        template_name=body.template_name,
        mapping_rules=source.model_dump(mode="json"),
        created_by_user_id=_created_by_uuid(identity),
    )
    return _to_detail([row])


@router.patch("/mapping-templates/{template_id}")
async def patch_mapping_template(
    request: Request,
    identity: Annotated[Identity, Depends(require_tenant)],
    template_id: UUID,
    body: MappingTemplatePatch,
) -> MappingTemplateDetail:
    """Edit a template per the D17 lifecycle (see the repo's recorded semantics)."""
    engine: AsyncEngine = request.app.state.engine
    tenant_id = tenant_uuid_of(identity)
    rules_dump: dict[str, Any] | None = None
    if body.mapping_rules is not None:
        source = validate_mapping_rules(body.mapping_rules, tenant_id=str(tenant_id))
        rules_dump = source.model_dump(mode="json")
    rows = await patch_template(
        engine,
        tenant_id,
        template_id,
        template_name=body.template_name,
        mapping_rules=rules_dump,
        created_by_user_id=_created_by_uuid(identity),
    )
    return _to_detail(rows)
