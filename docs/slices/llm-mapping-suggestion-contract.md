# LLM-assisted mapping suggestion: contract spec (UI-defined, for Sanjeev to build)

**Status:** UI-defined contract proposal, internal. The UI defines the response shape it wants from an LLM-backed mapping-suggestion step; Sanjeev builds the Gemini integration to return it. This is a SHAPE item (the UI proposes; his policy on the model, prompt, key management, validation wins where it meets one).

## Division of authority (settled)

- The Gemini call is Sanjeev's backend. It lives in (or alongside) the onboarding mapping-suggestion step, where DuckDB schema inference already happens. The UI does NOT call Gemini, does NOT hold a model key, and continues to call only dis-ui-server. Where the LLM sits, how it is prompted, how the key is managed (Vertex AI / Gemini API), and how its output is validated are his to decide.
- The UI defines and consumes the suggestion contract. The UI presents the LLM's per-column suggestions and captures the human's approval/correction (the AI-assisted, human-approved loop). This doc is the response shape the UI wants.

## Why this enables better UI

Today the Review Mapping screen shows a mechanical confidence per column. An LLM-backed suggestion can carry reasoning and alternative candidates, which turns the human-approval step from "stare at a confidence number" into "the assistant suggests X because Y; confirm, or pick from these alternatives." That is the genuine UX upgrade, and it is only possible if the backend provides the richer fields below.

## The response shape (proposed)

The mapping-suggestion response is a list of per-column suggestions. Per source column:

- source_column (string): the column name as it appears in the uploaded sample.
- inferred_type (string): the type DuckDB inferred (string, integer, decimal, date, etc.). Unchanged from today.
- sample_values (string array): a few example values from the column. Unchanged from today (2.2).
- null_pct (number): null percentage. Unchanged from today.
- suggested_target (string or null): the canonical column the assistant suggests, from the canonical vocabulary (sku_id, quantity, store_id, source_sale_timestamp, unit_sale_price, unit_retail_price, current_retail_price, product_description). null if the assistant suggests not mapping this column (ignore/passthrough).
- confidence (number 0 to 1): the assistant's confidence in suggested_target. The UI renders the existing OK / low / very-low bands from this.
- reasoning (string or null): OPTIONAL. A short, plain-language explanation of why the assistant suggested this target (e.g. "values look like terminal identifiers, likely a store or register code"). The UI shows this on low-confidence columns to help the human decide. MUST be optional: the UI degrades gracefully when absent and NEVER fabricates reasoning the backend did not provide.
- alternatives (array, optional): a short ranked list of other plausible canonical targets the assistant also considered, each { target: string, confidence: number }. The UI offers these as quick-pick options in the canonical dropdown (the assistant's top candidates, above the full canonical list). Empty or absent is fine.
- suggested_rule (object or null): OPTIONAL. A suggested mapping_rule for this column, in the D49 mapping_rules vocabulary ({ rename | normalize | cast | derive } with its args), e.g. for a date column, a normalize with a detected date_format. The UI shows this in the existing "Mapping rules" column. null when no rule is suggested.

The response may also carry a top-level:
- model (string, optional): which model produced the suggestion (e.g. the Gemini model id), for audit/display.
- overall_confidence (number, optional): an aggregate, for a journey-level "we mapped N of M columns" summary.

## Honesty constraints (carry R3 FM2 forward)

- reasoning and alternatives are OPTIONAL. The UI must work whether or not they are present, and must NEVER invent reasoning or alternatives the backend did not return.
- Everything the UI shows is presented as the ASSISTANT's view, not ground truth: "the assistant suggests", "we are unsure because", "other candidates the assistant considered". The human approves or corrects; the assistant does not decide.
- Confidence is the model's self-reported confidence; the UI presents it as such, not as a guarantee.

## Fit with the existing system

- Canonical vocabulary: suggested_target and alternatives.target are the real canonical columns. The assistant suggests from that fixed set; it does not invent targets.
- mapping_rules (D49): suggested_rule uses the settled { rename, normalize, cast, derive } vocabulary, the same the "Mapping rules" column already displays. The assistant can propose a rule (notably a normalize date_format), the human approves it.
- The approval still produces the same SourceDraft / mapping_rules the pipeline already expects. The LLM changes how the suggestion is produced, not what an approved mapping IS. The downstream contract (approve to staged, the mapping_rules shape) is unchanged.

## Linkage to Sanjeev's i18n / normalizer doc

This contract is the natural home for two things from that doc:
- B3 multilingual semantic mapping (pris / Preis / prix all map to the price field): this is exactly what an LLM does well, semantic mapping by meaning in the source language, not string matching. The reasoning field can note the language inference; source_column and suggested_target carry the original-and-canonical pairing (B3.2 audit traceability).
- Date-format / locale (B2.4): the assistant can detect a likely date_format and propose it as a suggested_rule (normalize), BUT per B2.7 the decimal separator and date format must be EXPLICITLY declared by the human, not silently accepted from the model. So the LLM's date-format suggestion is a default to confirm in the locale step, not an auto-applied value. The locale-declaration step (separate backlog item) and this contract should agree on who owns the final date_format.

## What the UI will do with this (a future slice, when the endpoint exists)

- Review Mapping shows, per low-confidence column: the suggested target, the confidence band, the reasoning (when present), and the alternatives as quick-pick dropdown options above the full canonical list.
- High-confidence columns stay in the calm "auto-mapped" group, as now.
- The suggested_rule populates the "Mapping rules" column; the human can accept or change it.
- Until the endpoint exists, the UI fixture can be shaped to this contract (reasoning + alternatives on the low-confidence columns) so the screen is ready and demoable, clearly as fixture data, not a real model call.

## Open questions for Sanjeev

1. Confirm the LLM call lives in the onboarding mapping-suggestion step (his service), not dis-ui-server.
2. Will the suggestion include reasoning and alternatives? (the UI is built to use them but degrades without them)
3. Latency and cost posture: one Gemini call per onboarding sample (acceptable) vs anything per-row (not). Confirm per-sample.
4. Does suggested_rule (especially date_format) flow into the same mapping_rules the pipeline applies, and how does it interact with the mandatory locale declaration (B2.7)?
5. Model/key management (Vertex AI vs Gemini API), and whether model is surfaced for audit.
6. Validation: how is the LLM output constrained to the canonical vocabulary (so it cannot suggest a non-existent target)? (his guardrail; the UI assumes targets are valid canonical columns)
