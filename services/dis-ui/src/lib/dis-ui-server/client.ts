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
