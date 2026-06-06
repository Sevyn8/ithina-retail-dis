"""``POST /mapping-suggestions``: per-column canonical-field suggestions.

Thin like the other handlers: ``require_tenant`` (the verified token is the sole
scope source), read the startup-built field catalog and the suggester from
``app.state``, delegate to ``GeminiSuggester.suggest`` (Gemini when a key is set,
mechanical fallback otherwise), return the wire model. No DB, no writes; the
suggester never raises on LLM trouble (it degrades to the fallback), so this
handler has no LLM error path of its own. See the contract:
docs/slices/llm-mapping-suggestion-contract.md.

NOTE (phase 1): ``app.state.gemini`` is wired in the lifespan by a later phase;
this handler only reads it. Tests inject a fake suggester on ``app.state.gemini``
and mount this router through the ``create_app(extra_api_routers=...)`` test seam.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from dis_ui_server.auth.identity import Identity
from dis_ui_server.auth.scope import require_tenant
from dis_ui_server.schemas.mapping_suggestions import (
    MappingSuggestionRequest,
    MappingSuggestionResponse,
)

router = APIRouter()


@router.post("/mapping-suggestions")
async def post_mapping_suggestions(
    request: Request,
    body: MappingSuggestionRequest,
    identity: Annotated[Identity, Depends(require_tenant)],
) -> MappingSuggestionResponse:
    """Suggest a canonical field per source column; ``source`` flags llm vs fallback."""
    catalog = request.app.state.field_catalog
    suggester = request.app.state.gemini
    source, model, suggestions = await suggester.suggest(body.columns, catalog)
    return MappingSuggestionResponse(source=source, model=model, suggestions=suggestions)
