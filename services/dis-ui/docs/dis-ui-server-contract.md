# dis-ui-server contract (consumed by DIS UI)

What the DIS UI expects from `dis-ui-server`. This doc is **seeded from in-repo
sources**, not from a canonical demand list (which is absent): the handler set
comes from `docs/architecture.md` section 4.17, the auth model from
`services/dis-ui-server/` CLAUDE.md and README, and the GET /me shape from the
slice-19 fixture (`src/lib/dis-ui-server/fixtures.ts`).

**Every shape here is PROVISIONAL.** Reconcile against the canonical sources when
they land: `docs/ui-engineer-demand-list.md` section 1.1 (the endpoint inventory)
and `docs/decisions.md` D25 (the Customer Master RBAC claim vocabulary).

## Auth model

- The UI sends a Customer Master bearer token on every dis-ui-server call.
- dis-ui-server verifies the JWT against Customer Master's JWKS, extracts
  `tenant_id` and a `role` claim, and enforces RBAC at the handler level
  (tenant-scoped handlers require `tenant_id`; ops-only handlers require the ops
  role).
- On token expiry dis-ui-server returns 401 and the UI refreshes (real mode).
- Slice 19 substitutes an HMAC-signed stub JWT verified locally;
  `src/auth/verifyToken.ts` is the single seam that swaps to JWKS verification.

## Handler set (architecture section 4.17)

| Handler | Purpose | Scope |
|---|---|---|
| `upload_session` | Start a CSV upload (Phase 1): issue a signed PUT URL (D36) | Tenant |
| `sample_upload` | Submit an onboarding sample for inference | Tenant / ops |
| `onboarding_review` | Review and promote mappings (staged -> active) | Tenant / ops |
| `mapping_crud` | CRUD on `config.source_mappings` (new version per edit) | Tenant |
| `quarantine` | Quarantined rows: tenant slice and cross-tenant ops slice | Tenant + ops |
| `audit` | Lookup `audit.events` by trace_id / tenant / store / time | Tenant (ops cross-tenant) |
| `duckdb_query` | Ad-hoc SQL over a GCS bronze blob | Ops only |
| `auth` | Cross-cutting JWT verification (FastAPI dependency, not an endpoint) | All |

**Note:** architecture 4.17 lists **no `GET /me` endpoint**. See Open questions.

## GET /me (PROVISIONAL - slice-19 fixture shape)

The UI's `getMe()` currently returns this shape, derived from the `/dev/login`
personas. It is the Checkpoint 3 fixture, not a canonical contract.

```ts
type MeResponse = {
  user_id: string
  email: string
  user_type: 'TENANT' | 'PLATFORM'
  tenant_id: string | null      // null for PLATFORM (cross-tenant)
  tenant_name: string | null    // null for PLATFORM; getMe-only enrichment, not a token claim
  permissions: string[]         // PROVISIONAL, pending D25
}
```

`tenant_name` is the one field beyond the token's claims (the token carries
`tenant_id` + `role`, not `tenant_name`); it is a server-side display join the
BFF would add.

## Open questions

1. **The GET /me fork.** Architecture 4.17 lists no `/me` endpoint, but the UI
   assumes one. Whether real identity comes from a `GET /me` call or from
   decoding the token's claims is open, pending Sanjeev and slice 13. Slice 19
   decodes the stub locally and is correct either way.
2. **RBAC vocabulary.** `user_type` (TENANT/PLATFORM), `role`, and `permissions`
   are provisional placeholders pending decisions.md D25 (the Customer Master
   claim vocabulary). No UI currently gates on `permissions`.
3. **`/me` caching.** The `getMe` query uses `staleTime: Infinity` (identity is
   stable within a session). Revisit when real mode and tenant-switching exist.

## Canonical sources to reconcile against

- `docs/ui-engineer-demand-list.md` section 1.1 (absent at time of writing).
- `docs/decisions.md` D25 (Customer Master as external dependency; claim vocabulary still open).
