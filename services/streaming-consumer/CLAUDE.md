# services/streaming-consumer — Claude Code Context

Loaded when Claude Code works in `services/streaming-consumer/`. Service-specific rules; root `CLAUDE.md` applies first.

## What this service is

The ELT happy path (Slice 10). Consumes `ingress.ready`, fetches the bronze chunk, loads the active mapping per-lookup (D6), validates pre and post, applies the four `dis-mapping` sub-stages, stamps `mapping_version_id` (D22), and atomically dual-writes canonical (D30). Quarantine publish, per-row routing, B2 threshold: Slice 11. Replay (`ingress.resubmit`): Slice 12. Identity Service + D28 fallback: Slice 13. Circuit breaker + `pipeline.dlq`: D27, carried. For the EPE block see `README.md`; for the slice contract see `docs/slices/slice-10-streaming-consumer.md`.

**Status:** Slice 10 (happy path) built.

## Invariants this service holds

- **Trust boundary:** identity and `trace_id` are READ off `ingress.ready` (D54); never re-resolved, never minted. The fetch cross-checks the path (D53) and the bronze row against the event; disagreement fails loud.
- **Atomic dual-write at batch grain:** one `rls_session` transaction per ≤500 row-pair batch (architecture 4.6) covers the event INSERT and the hot upsert — either-or-neither (D30). A mid-batch failure rolls that batch back and the message nacks; earlier committed batches converge on redelivery via D33 read-time dedup + the D64 event-time-wins upsert. Transactional idempotency is deliberately NOT the mechanism.
- **D33/D38 dedup key:** `source_id` from the envelope (cross-checked vs path + bronze); `source_event_id` = `transaction_id:line_item_seq` when the source supplies both, else `bronze_ref:chunk_row_index` (D65: redelivery-stable, NOT correction-collapsing for id-less sources).
- **Hot merge (REVISED D63 — completeness-gated; D64, M-HOTKEY/0004):** projection registries + the load-time completeness classification live in `pipeline/mapping.py` (`LoadedMapping.hot_complete`, derived from the live hot NOT NULL + CHECK partition — PG validates NOT NULL on the INSERT candidate BEFORE arbitration, so only a complete candidate may ride ON CONFLICT). Two paths, both inside the per-batch `rls_session` transaction (D30) and in sorted COALESCE'd-natural-key order (the total order that removes the overlapping-batch deadlock hazard):
  - **COMPLETE mapping** (none in production today; the future catalogue slice): the proven atomic `INSERT … ON CONFLICT (COALESCE list) DO UPDATE … WHERE event-time-wins`; arbiter `uq_sscp_natural_key` (`''` engine-impossible via the sentinel CHECKs). Creates or updates — the ONLY path that inserts; an insert-race loser takes the UPDATE branch (no error surfaces).
  - **INCOMPLETE mapping** (every current production path): one conditional `UPDATE … WHERE <COALESCE-key> AND event-time-wins`; rowcount 0 → one READ-ONLY existence check → present = older-event no-op (counted in `hot_noops`, audited); absent = a D63 MISS. **NO INSERT exists on this path — the create-race cannot occur.** The miss does NOT abort the batch: the appended event rows COMMIT (history retained), then `write_chunk` raises loudly so the chunk nacks toward quarantine (Slice 11); redelivery re-appends (read-time dedup absorbs) until catalogue/position onboards.
  - On BOTH paths the WHERE predicate is re-evaluated (EvalPlanQual) against the LOCKED current row, so an older event never overwrites a newer one in either arrival order; `>=` makes exact-tie redelivery idempotent. Proven live with two real writers per path (`test_concurrent_upsert.py`) plus the deadlock-vs-sort demonstration. Concurrency-safe under N autoscaled instances (D58 split).
- **Minimal failure disposition = audit-and-nack:** validation/mapping/write failures emit a FAILURE audit (fire-and-forget) and NACK. Deterministic failures REDELIVER until Slice 11's quarantine lands — accepted interim posture: one FAILURE audit row per cycle (D44 tolerates), bounded by ack-deadline/retention, no data loss (bronze is the recoverable source, D5). The one ack-on-failure: an unparseable envelope (identity unknowable; redelivery identical).
- **Missing event-date partition fails loud** (no DEFAULT partition exists; no rolling creator yet — registered gap): the INSERT errors, the batch rolls back, the message nacks.
- **Audit (D42/D43/D44):** stages RECEIVED (intake+fetch), MAPPING_LOOKED_UP, PRE/POST_MAPPING_VALIDATED, MAPPING_EXECUTED, CANONICAL_WRITTEN; `IDENTITY_VALIDATED` never emitted (no identity call). Duplicate hits: ROW-scoped `CANONICAL_WRITTEN`, `outcome=SUCCESS`, detail in `event_data` (`duplicate`, `prior_trace_id`, `row_hash`, `dedup_key`). Hot `ingest_metadata` carries `source_event_id` (no first-class hot column) — write-shape aligned to the live column comment's key vocabulary.
- **Routing is mapping-load-time:** the mapping's target set fits exactly one event model (provenance sets) or raises `MappingConfigError`. Non-NULL suite refs raise `SuiteDefinitionError` (NULL=default is the only supported state). An absent ACTIVE mapping raises — required value, no fallback.
- **D60 struck:** no ordering key is set or consumed; a regression test guards the contracts.

## Writes / reads

- Writes: `canonical.store_sku_current_position` (upsert), `canonical.store_sku_sale_events` / `store_sku_change_events` (append-only INSERT, no UNIQUE), `audit.events` (fire-and-forget, Phase-1 Cloud SQL). Nothing else; no Pub/Sub publish exists in Slice 10.
- Reads: `bronze.data_ingress_events` (by `bronze_ref`), GCS via `dis-storage` only, `config.source_mappings` (ACTIVE, per-lookup), `identity_mirror.stores` (sale-path `tax_treatment` only — a data read; D39's FK is the existence enforcement).
- All Postgres access via `libs/dis-rls` (hard rules 1/12); positive `current_database()` assertion at startup. No BigQuery in Slice 10. The subscription is provisioned by `tools/local/create_topics.py`, never by runtime code.

## Test-tree exception (do not copy blindly)

This service's `tests/`, `tests/unit/`, and `tests/integration/` carry `__init__.py` — a DELIBERATE exception to the repo's no-`__init__`-in-test-dirs convention. Reason: the integration tests share TYPED helpers from their conftest (`from .conftest import …`), which `mypy --strict` (the per-package 9d gate) cannot resolve without package context; the alternative was untyped `Any` factory fixtures. pytest importlib collection and the per-package mypy run are both unaffected (the package anchors at `tests/`, unique within this mypy invocation; other services' rootless test modules collide with nothing). A new service should default to the repo convention unless it has the same typed-shared-conftest need.

## References

`README.md` (EPE) · root `CLAUDE.md` · `docs/slices/slice-10-streaming-consumer.md` · `docs/decisions.md` D30/D33/D38/D42/D54/D60/D63/D64/D65.

## When uncertain

Refer to the current slice doc in `docs/slices/`. If silent there, refer to architecture. If still uncertain, ask before coding.
