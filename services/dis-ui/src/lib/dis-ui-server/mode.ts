export type ServerMode = 'fixture' | 'real'

// Runtime switch between fixture mode (slice 19 default, no backend) and real
// mode (calls dis-ui-server). Anything other than 'real' resolves to 'fixture',
// so the app runs locally with no env configured.
export const SERVER_MODE: ServerMode =
  import.meta.env.VITE_DIS_UI_SERVER_MODE === 'real' ? 'real' : 'fixture'

// The dis-ui-server base URL for real mode. FM5: this must come from the
// environment, never a hardcoded localhost. It is unused in fixture mode and
// required in real mode; a missing value in real mode is a misconfiguration, not
// something to paper over with a default (root CLAUDE.md code-quality rule 4).
export function getBaseUrl(): string {
  const url = import.meta.env.VITE_DIS_UI_SERVER_BASE_URL
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error(
      'VITE_DIS_UI_SERVER_BASE_URL is required when VITE_DIS_UI_SERVER_MODE=real',
    )
  }
  return url
}
