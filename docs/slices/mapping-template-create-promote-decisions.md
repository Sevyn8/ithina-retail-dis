# Mapping Template Create/Promote: locked decisions record

Companion to `mapping-template-create-promote-brief.md` (Sanjeev's shared brief).
This record captures what the operator (Amit) has LOCKED for the create/promote
build, and what is still PROVISIONAL pending alignment with Sanjeev, so the
choices are documented rather than tribal. It answers the four open product
decisions in the brief's Section 3.

Status: operator-locked where marked; provisional items must be reconciled with
Sanjeev before the corresponding server endpoints are built.

---

## Decisions (the brief Section 3 open questions)

### (a) Go-live behavior: CREATE-AS-DRAFT. LOCKED.

Go-live calls the real `createMappingTemplate()` and the result is a DRAFT. There
is no create-and-stage-in-one-step. The frontend assembles the full
`{version, rename, normalize, cast, derive}` document from the wizard state and
POSTs it; the server returns a DRAFT `MappingTemplateDetail`, exactly as the
create endpoint already behaves. Promotion to STAGED/ACTIVE is a separate action.

### (d) Go-live success semantics: HONEST DRAFT. LOCKED (follows from (a)).

The Go-live success copy says "Created (draft)", not "staged". The prior fixture
returned `status: 'staged'`, which implied approve-maps-to-staged; that wording
is retired. Until a real stage step exists, the UI states plainly that the
template was created as a draft. This resolves the brief's DRAFT-vs-staged
semantic mismatch on the UI side.

### (b) Promotion granularity: ONE-STEP DRAFT to ACTIVE (STAGED dropped). PROVISIONAL, pending-Sanjeev.

The promote UI is built to a ONE-STEP lifecycle: a single operator action takes a
template DRAFT to ACTIVE directly. STAGED has been DROPPED from the create/promote
flow: there is no Stage step, no intermediate STAGED state, and no STAGED copy in
this flow. (The wire types still carry `staged_version`/`'staged'` as a
backend-contract mirror, and the separate D17 staged-rollout screens are
unaffected; only the create/promote flow is one-step.)

This SIMPLIFIES the contract Sanjeev agreed to build: the server needs ONE
`/activate` endpoint and NO `/stage` endpoint. This must be FLAGGED to Sanjeev so
the UI shape and the endpoint shape agree before the server promotion endpoint is
built. It is NOT yet confirmed with him.

### (c) What triggers ACTIVE: direct operator action ("Activate"). PROVISIONAL, pending-Sanjeev.

The provisional trigger for ACTIVE is a direct operator action. This is NOT yet
confirmed and touches D17 (staged rollout: validate in shadow against live traffic
before promoting to active). The final trigger may become shadow-gated rather than
a direct action; it must be aligned with Sanjeev. The UI is built to the direct
action provisionally and must adapt if the gate model is chosen.

---

## Build posture

The full create to activate UI is built now (one-step DRAFT to ACTIVE),
real-endpoint-wired (not deferred behind a stub-only seam). Mode behavior:

- Fixture mode (local and demo) synthesizes the transition so the whole flow is
  walkable without a backend (a clearly-marked demo activation).
- Real mode, create-as-DRAFT: REAL. The `POST /api/v1/mapping-templates` endpoint
  exists, is validated, RLS-scoped, and tested; Go-live calls it for real.
- Real mode, activate: the single `/activate` endpoint does NOT exist yet.
  Real-mode activate surfaces an honest "activation endpoint not yet available"
  state and the lifecycle stays DRAFT.

Honesty guard (hard rule for this build): real-mode promotion must NEVER fake a
successful ACTIVE. ACTIVE gates real data ingestion (CSV upload binds to the
ACTIVE version), so a fabricated activation would imply the pipeline is live when
it is not. A faked ACTIVE is forbidden; real mode shows the not-yet-available
state instead.

---

## Open cross-team conflict (recorded so it is not lost)

The brief's Section 2 states that AI assistance is purely a frontend concern and
that `dis-ui-server` does not proxy, relay, or call AI on the frontend's behalf
(AI never appears on the wire; only the finished `{source_id, template_name,
mapping_rules}` document crosses to the backend).

This CONFLICTS with the shipped `dis-ui-server` BFF endpoint
`POST /api/v1/mapping-suggestions`, which was built to hold the Gemini API key
server-side for API-key safety (a browser-exposed key leaks), with a mechanical
fallback when no key is set. That endpoint puts AI suggestion-generation on the
backend, the opposite of the brief's Section 2 stance.

This is an unresolved cross-team architecture decision that Amit is aligning with
Sanjeev. Recorded here so the divergence is explicit and not lost:

- Brief Section 2: AI is frontend-only; the backend never calls AI.
- Shipped reality: `POST /api/v1/mapping-suggestions` calls AI server-side (key
  safety), per `docs/slices/llm-mapping-suggestion-contract.md`.

Resolution pending. Until resolved, the two documents disagree on where the AI
call lives, and the frontend's suggestion source (endpoint vs in-browser) follows
whatever is settled.
