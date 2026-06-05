import type { AuthSnapshot } from '../../auth/AuthSnapshot'
import { activeTemplateVersion, getMappingTemplate } from './mapping-templates'
import { SERVER_MODE } from './mode'

// ===========================================================================================
// PROVISIONAL - recurring-batch upload-session template carry.
//
// This is the ONLY module that couples to the PROPOSED (not-yet-confirmed) upload-session
// shape for recurring batches. The seam is D68-DEFERRED and NOT built: it does not exist on
// dis-ui-server today. The shape below is the UI-defined proposal in
//   docs/slices/recurring-batch-upload-seam-contract.md
// (POST /api/v1/upload-sessions gaining `template_id` + `intent`, the response carrying the
// resolved `mapping_version_id`). Sanjeev owns the backend and confirms the real shape; when
// he does, this whole module changes in one place and nothing else in the UI is coupled to
// the proposal. Until then everything here is fixture-only and clearly provisional.
// ===========================================================================================
export const UPLOAD_SESSION_TEMPLATE_CARRY_PROVISIONAL = true

// PROPOSED request: a recurring batch targets a specific (source_id, template_id) and is
// ingested through that template's ACTIVE mapping version. `intent` keeps the recurring-batch
// path unambiguous server-side vs the existing onboarding-sample path.
export type RecurringBatchSessionCreate = {
  source_id: string
  template_id: string
  intent: 'recurring_batch'
}

// PROPOSED response: the signed upload target (as the source-only upload-session does today)
// plus the resolved `mapping_version_id` - the active version that WILL be applied - so the
// UI can confirm "this batch will use mapping vN".
export type RecurringBatchSessionResult = {
  upload_session_id: string
  upload_url: string
  mapping_version_id: number
  intent: 'recurring_batch'
  trace_id: string
  expires_at: string
}

function ensureFixtureMode(fn: string): void {
  if (SERVER_MODE === 'real') {
    // The real endpoint is Sanjeev's and is not built (D68-deferred). Fail loud rather than
    // pretend - real mode must not silently fall back to the provisional fixture.
    throw new Error(`real-mode ${fn} is not implemented (recurring-batch upload-session is D68-deferred)`)
  }
}

// Create a recurring-batch upload session for (source_id, template_id), reusing the template's
// ACTIVE mapping. Resolves the active version from the EXISTING mapping-templates fixtures (no
// duplicated mapping data); throws a clear error when the template has no active version -
// you cannot reuse a mapping that was never activated (mirrors the seam contract's error).
//
// Fixture mode only. The returned upload_session_id matches the real `^us_[a-z0-9]{12}$`
// pattern, but the upload_url / trace_id / expires_at are static placeholders: nothing here
// uploads or ingests a file. The UI presents this honestly as a provisional demo.
export async function createRecurringBatchSession(
  snapshot: AuthSnapshot,
  req: RecurringBatchSessionCreate,
): Promise<RecurringBatchSessionResult> {
  ensureFixtureMode('createRecurringBatchSession()')
  const detail = await getMappingTemplate(snapshot, req.template_id)
  const active = activeTemplateVersion(detail)
  if (active === null) {
    throw new Error(
      `template ${req.template_id} has no active version to reuse: cannot start a recurring batch ` +
        '(activate a mapping first)',
    )
  }
  return {
    upload_session_id: 'us_recbatch0001',
    upload_url: 'https://example.invalid/provisional-upload-target',
    mapping_version_id: active.mapping_version_id,
    intent: req.intent,
    trace_id: 'trace_recbatch_provisional',
    expires_at: '2026-06-05T10:00:00Z',
  }
}
