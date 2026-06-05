"""``GET /template-mapping-fields`` — the mappable canonical field catalog (slice 14b b).

Identical for every tenant; NOT tenant-scoped, opens no ``rls_session``, touches
no database — the catalog was built once at startup (``app.state.field_catalog``)
from the same drift-guarded sources the create/edit validator uses (one
canonical truth). Authenticated (it is UI data surface), but any verified
identity qualifies: tenant or ops, no tenant context required — test-proven
byte-identical across callers.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from dis_ui_server.auth.identity import Identity
from dis_ui_server.auth.scope import get_current_identity
from dis_ui_server.schemas.mapping_fields import TemplateMappingField

router = APIRouter()


@router.get("/template-mapping-fields")
async def get_template_mapping_fields(
    request: Request,
    identity: Annotated[Identity, Depends(get_current_identity)],
) -> list[TemplateMappingField]:
    """The catalog, stable order (section, then canonical declaration order); bare array."""
    catalog: list[TemplateMappingField] = request.app.state.field_catalog
    return catalog
