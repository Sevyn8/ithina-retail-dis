import { getBaseUrl } from './mode'

// Typed fetch wrapper for real-mode dis-ui-server calls. This is the wired seam
// for when real mode lands (slice 13); it is unused in fixture mode. The bearer
// token is the Customer Master session token the UI holds.
//
// FM4 note: callers are responsible for validating the parsed JSON against the
// expected response type (e.g. a parseMeResponse guard) and throwing on a shape
// mismatch, so a backend that returns a different shape degrades to the caller's
// error state rather than propagating a half-shaped object. That validation
// ships with the real path; it is not implemented in slice 19.
export async function request<T>(path: string, opts: { token: string }): Promise<T> {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    headers: { authorization: `Bearer ${opts.token}` },
  })
  if (!response.ok) {
    throw new Error(`dis-ui-server request to ${path} failed with status ${response.status}`)
  }
  return (await response.json()) as T
}

// A non-2xx response from dis-ui-server, carrying the HTTP status plus the parsed
// error envelope (services/dis-ui-server/errors_http.py: {"error": {code, message,
// trace_id, details}}). Callers map (status, code) to a user-facing message; the
// `details` bag carries load-bearing context (e.g. tier-0 `reason` on a 422).
export class DisUiServerHttpError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(status: number, code: string, message: string, details: Record<string, unknown>) {
    super(message)
    this.name = 'DisUiServerHttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

// Best-effort parse of the standard error envelope. A non-JSON or off-shape body
// degrades to an empty code so the caller still gets the status to map on.
async function parseErrorEnvelope(
  response: Response,
): Promise<{ code: string; message: string; details: Record<string, unknown> }> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown; details?: unknown } }
    const err = body.error ?? {}
    return {
      code: typeof err.code === 'string' ? err.code : '',
      message: typeof err.message === 'string' ? err.message : `request failed (${response.status})`,
      details:
        typeof err.details === 'object' && err.details !== null
          ? (err.details as Record<string, unknown>)
          : {},
    }
  } catch {
    return { code: '', message: `request failed (${response.status})`, details: {} }
  }
}

// POST a multipart/form-data body to dis-ui-server. The Content-Type header is
// deliberately NOT set: the browser sets it with the correct multipart boundary
// from the FormData. On a non-2xx, throws DisUiServerHttpError with the parsed
// envelope so the caller can map the status and code.
export async function postMultipart<T>(path: string, opts: { token: string; form: FormData }): Promise<T> {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.token}` },
    body: opts.form,
  })
  if (!response.ok) {
    const { code, message, details } = await parseErrorEnvelope(response)
    throw new DisUiServerHttpError(response.status, code, message, details)
  }
  return (await response.json()) as T
}
