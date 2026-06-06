"""The Gemini-backed mapping suggester, with the mechanical fallback built in.

``GeminiSuggester.suggest`` returns ``(source, model, suggestions)``:

- No api key (None/empty), or any model error/timeout/parse failure -> the
  mechanical ``fallback_matcher`` result with ``source="fallback"``. The frontend
  must always receive suggestions, so LLM trouble degrades, never raises.
- A key present and a clean structured response -> ``source="llm"``, with every
  ``suggested_target`` and alternative VALIDATED against the catalog key set (the
  model cannot invent a field; invalid targets are nulled / dropped).

The blocking google-genai call runs off the event loop via ``anyio.to_thread``
with a bounded timeout (the GCS/Pub/Sub pattern). The google-genai import is
LAZY (inside ``_call_model``) so this module loads without the package; only the
real LLM path needs it. ``_call_model`` is the single network seam tests override.
"""

from __future__ import annotations

import json
from typing import Any

import anyio

from dis_core.logging import get_logger
from dis_ui_server.config import SERVICE_NAME
from dis_ui_server.schemas.mapping_fields import TemplateMappingField
from dis_ui_server.schemas.mapping_suggestions import ColumnProfile, Suggestion, SuggestionSource
from dis_ui_server.suggest.fallback_matcher import match_columns

_log = get_logger(SERVICE_NAME)

_DEFAULT_MODEL = "gemini-2.5-flash"
_DEFAULT_TIMEOUT_S = 15.0


class GeminiSuggester:
    """Produces per-column mapping suggestions via Gemini, falling back mechanically."""

    def __init__(
        self,
        api_key: str | None,
        *,
        model: str = _DEFAULT_MODEL,
        timeout_s: float = _DEFAULT_TIMEOUT_S,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._timeout_s = timeout_s

    async def suggest(
        self,
        columns: list[ColumnProfile],
        catalog: list[TemplateMappingField],
    ) -> tuple[SuggestionSource, str | None, list[Suggestion]]:
        """Return (source, model, suggestions); never raises on LLM trouble."""
        if not self._api_key:
            return ("fallback", None, match_columns(columns, catalog))
        try:
            prompt = self._build_prompt(columns, catalog)
            with anyio.fail_after(self._timeout_s):
                text = await anyio.to_thread.run_sync(self._call_model, prompt)
            suggestions = self._parse_and_validate(text, columns, catalog)
            return ("llm", self._model, suggestions)
        except Exception as exc:  # timeout, transport, parse, anything: degrade
            _log.bind(stage="mapping_suggestions", error=type(exc).__name__).warning(
                "gemini suggestion failed; using mechanical fallback"
            )
            return ("fallback", None, match_columns(columns, catalog))

    # -- the single network seam (lazy import; tests override this) -----------------

    def _call_model(self, prompt: str) -> str:
        """Blocking Gemini call returning the raw JSON text. Lazy-imports the SDK."""
        import google.genai as genai
        from google.genai import types

        client = genai.Client(api_key=self._api_key)
        response = client.models.generate_content(
            model=self._model,
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        return response.text or ""

    # -- pure helpers (directly testable) ------------------------------------------

    def _build_prompt(self, columns: list[ColumnProfile], catalog: list[TemplateMappingField]) -> str:
        """Compose the prompt: the catalog is the CLOSED target set, JSON out only."""
        targets = [
            {
                "key": field.key,
                "display_name": field.display_name,
                "datatype": field.datatype,
                "section": field.section,
                "description": field.description,
            }
            for field in catalog
        ]
        profile = [
            {
                "source_column": column.name,
                "inferred_datatype": column.inferred_datatype,
                "null_pct": column.null_pct,
                "sample_values": column.sample_values,
            }
            for column in columns
        ]
        instructions = (
            "You map source CSV columns to canonical retail fields. For EACH source "
            "column, choose the single best target from the allowed targets, or null if "
            "no target fits. You MUST only use a target 'key' from the allowed list; "
            "never invent a field. Return ONLY JSON of the shape: "
            '{"suggestions": [{"source_column": str, "suggested_target": str or null, '
            '"confidence": number 0..1, "reasoning": short string, '
            '"alternatives": [target key, ...]}]}.'
        )
        return json.dumps(
            {
                "instructions": instructions,
                "allowed_targets": targets,
                "columns": profile,
            }
        )

    def _parse_and_validate(
        self,
        text: str,
        columns: list[ColumnProfile],
        catalog: list[TemplateMappingField],
    ) -> list[Suggestion]:
        """Parse the model JSON and constrain every target to a real catalog key."""
        valid_keys = {field.key for field in catalog}
        parsed = json.loads(text)
        raw_items = parsed.get("suggestions", []) if isinstance(parsed, dict) else []
        by_column: dict[str, dict[str, Any]] = {}
        for item in raw_items:
            if isinstance(item, dict) and isinstance(item.get("source_column"), str):
                by_column[item["source_column"]] = item

        suggestions: list[Suggestion] = []
        for column in columns:
            item = by_column.get(column.name, {})
            target = item.get("suggested_target")
            # GUARDRAIL: only a real catalog key survives; anything else -> null.
            if not isinstance(target, str) or target not in valid_keys:
                target = None
            confidence = item.get("confidence", 0.0)
            confidence = float(confidence) if isinstance(confidence, (int, float)) else 0.0
            confidence = min(1.0, max(0.0, confidence))
            reasoning = item.get("reasoning")
            reasoning = reasoning if isinstance(reasoning, str) and reasoning else None
            raw_alts = item.get("alternatives")
            alternatives: list[str] | None = None
            if isinstance(raw_alts, list):
                alts = [a for a in raw_alts if isinstance(a, str) and a in valid_keys]
                alternatives = alts or None
            suggestions.append(
                Suggestion(
                    source_column=column.name,
                    suggested_target=target,
                    confidence=confidence,
                    reasoning=reasoning,
                    alternatives=alternatives,
                )
            )
        return suggestions
