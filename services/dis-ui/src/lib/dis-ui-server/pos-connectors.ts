// POS/ERP connector specs (redesign R5). PROVISIONAL and UI-PROPOSED: these are the
// representative credential shapes the connect step shows as the planned form. They are
// NOT the confirmed auth model. Sanjeev confirms the real per-POS auth (OAuth scopes,
// fields, secrets handling) when the connectors get built; the UI proposes, he confirms.
// No fetch, no hook, no working connect - the connect step is coming-soon/disabled (FM1).

// Flag consumed by the UI + asserted in tests: the credential shapes below are proposals,
// not final (FM2).
export const POS_CONNECTORS_PROVISIONAL = true

// DEFERRED, recorded not built (FM4): POS systems carry a "locations" concept that must
// map to our store_id. That mapping touches identity_mirror/store resolution and is a
// Sanjeev spec item; it is NOT built here and not part of the credential shell.
export const POS_LOCATION_MAPPING_DEFERRED =
  'POS location-to-store_id mapping is deferred (touches identity_mirror); a Sanjeev spec item, not built in R5.'

export type PosConnectorKey = 'shopify_pos' | 'square' | 'other'

export type PosCredentialField = {
  name: string
  label: string
  placeholder?: string
}

export type PosConnectorSpec = {
  key: PosConnectorKey
  // The primary connect action label (rendered DISABLED in the thin build).
  connectLabel: string
  // Representative credential fields (the proposed shape, NOT the confirmed auth model).
  credentialFields: PosCredentialField[]
}

export const POS_CONNECTOR_SPECS: Record<PosConnectorKey, PosConnectorSpec> = {
  shopify_pos: {
    key: 'shopify_pos',
    connectLabel: 'Authorize with Shopify',
    credentialFields: [
      { name: 'shop_domain', label: 'Shopify store domain', placeholder: 'your-store.myshopify.com' },
    ],
  },
  square: {
    key: 'square',
    connectLabel: 'Authorize with Square',
    credentialFields: [{ name: 'application_id', label: 'Square application ID' }],
  },
  other: {
    key: 'other',
    connectLabel: 'Connect',
    credentialFields: [
      { name: 'api_base_url', label: 'API base URL', placeholder: 'https://api.example.com' },
      { name: 'api_key', label: 'API key' },
    ],
  },
}

// Resolve a POS connector spec by key. Returns null for an unknown or non-POS key (e.g.
// 'csv'), so the connect step can render a not-found state rather than guessing.
export function posConnectorSpec(key: string): PosConnectorSpec | null {
  return POS_CONNECTOR_SPECS[key as PosConnectorKey] ?? null
}
