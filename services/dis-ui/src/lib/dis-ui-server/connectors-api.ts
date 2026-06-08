import type { LocaleDeclaration } from '../../components/locale-rules'
import type { ConnectorKey } from './connectors-catalog'

// =====================================================================================
// Live Sync connectors API - THE SINGLE STUB SEAM (Chunk 1, UI-only).
//
// Every function here returns MOCK data and performs NO network call. This is deliberately
// the only place the new "Connect a System" surface touches a backend boundary, so wiring
// the real integration later == replacing the bodies in this one module (the call sites,
// types, and step components do not change). Each function documents the expected REAL
// request/response with a `TODO(wire)` marker.
//
// Why it lives under lib/dis-ui-server/: the service rule says backend access goes only
// through lib/dis-ui-server/*. This module is that seam for connectors; it simply has no
// real implementation yet. It does NOT import client.ts / postJson in this pass.
//
// Shapes mirror the existing mapping-suggestion contract (suggestion + alternatives) and
// reuse the existing locale/format mechanism (LocaleDeclaration from locale-rules) rather
// than inventing a new detected-format API. Confidence/reasoning are placeholders shaped to
// the real Vertex mapping-suggestion response, marked TODO(wire) for the swap.
// =====================================================================================

// ----- OAuth (recommended path) ------------------------------------------------------

export type OAuthInitiation = {
  // The provider authorize URL the browser would be sent to. Stubbed string for now.
  authorizeUrl: string
  // Opaque CSRF/correlation state echoed back on the callback.
  state: string
}

// TODO(wire): POST /api/v1/connectors/{connector}/oauth/initiate with the pre-auth field
// (shop domain / region). Server returns the provider authorize URL + state; the browser
// redirects there and the provider calls our callback. Sevyn8 app credentials are held
// server-side and never reach the client.
export function initiateOAuth(
  connector: ConnectorKey,
  preAuth: Record<string, string>,
): Promise<OAuthInitiation> {
  return Promise.resolve({
    authorizeUrl: `https://stub.invalid/oauth/${connector}?shop=${encodeURIComponent(
      preAuth.shop_domain ?? preAuth.region ?? '',
    )}`,
    state: `stub-state-${connector}`,
  })
}

export type ConnectorAccount = {
  // The provider account / business name we connected to.
  businessName: string
  // Provider-side account identifier.
  accountId: string
  // We request read-only scopes only.
  readOnly: boolean
  // The access token is stored server-side (never returned to the client).
  tokenStored: boolean
}

// TODO(wire): the OAuth callback hits the server, which exchanges the code for a token,
// stores it server-side, and returns the connected account summary. The client polls or is
// redirected back with the result; this function stands in for "fetch the exchanged account".
export function exchangeToken(
  connector: ConnectorKey,
  params: { state: string },
): Promise<ConnectorAccount> {
  void params
  return Promise.resolve(stubAccount(connector))
}

// ----- API-token path ----------------------------------------------------------------

// TODO(wire): POST /api/v1/connectors/{connector}/token with the per-connector token fields.
// Server validates the token against the provider (read-only), stores it server-side, and
// returns the connected account summary. The raw token is never persisted client-side.
export function submitApiToken(
  connector: ConnectorKey,
  tokenFields: Record<string, string>,
): Promise<ConnectorAccount> {
  void tokenFields
  return Promise.resolve(stubAccount(connector))
}

function stubAccount(connector: ConnectorKey): ConnectorAccount {
  const names: Record<ConnectorKey, string> = {
    shopify: 'Acme Retail (Shopify)',
    square: 'Acme Retail (Square)',
    clover: 'Acme Retail (Clover)',
  }
  return {
    businessName: names[connector],
    accountId: `acct_stub_${connector}`,
    readOnly: true,
    tokenStored: true,
  }
}

// ----- Locations ----------------------------------------------------------------------

export type ConnectorLocation = {
  // Provider-side location id.
  id: string
  // Human label for the location.
  name: string
  // A short address line for disambiguation.
  address: string
}

// TODO(wire): GET /api/v1/connectors/{connector}/locations for the connected account. The
// returned provider locations are mapped to DIS store_id in this step. The location ->
// store_id resolution touches identity/store resolution and is a Sanjeev spec item.
export function fetchLocations(connector: ConnectorKey): Promise<ConnectorLocation[]> {
  void connector
  return Promise.resolve([
    { id: 'loc_001', name: 'Downtown Flagship', address: '100 Market St' },
    { id: 'loc_002', name: 'Riverside Mall', address: '24 Riverside Ave' },
    { id: 'loc_003', name: 'Airport Kiosk', address: 'Terminal B, Gate 12' },
  ])
}

// ----- Data types + cadence -----------------------------------------------------------

export type ConnectorDataType = 'orders' | 'products' | 'inventory'

export type SyncCadence = 'realtime' | 'hourly' | 'daily'

export const SYNC_CADENCES: { value: SyncCadence; label: string }[] = [
  { value: 'realtime', label: 'Real time (webhooks)' },
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Once a day' },
]

// ----- AI mapping suggestions ---------------------------------------------------------

export type ConnectorMappingSource = 'vertex' | 'fallback'

// One source field's suggestion, shaped like the real mapping-suggestion response
// (suggested target + alternatives), enriched with the per-row signals the surface shows.
export type ConnectorMappingField = {
  sourceField: string
  // Canonical catalog key, or null. Mirrors MappingSuggestionResponse.Suggestion.suggested_target.
  suggestedTarget: string | null
  // Catalog keys, mirrors Suggestion.alternatives.
  alternatives: string[]
  // TODO(wire): Vertex mapping-suggestion confidence (0..1). Placeholder values for now.
  confidence: number
  // TODO(wire): Vertex mapping-suggestion reasoning ("why" line). Placeholder for now.
  reasoning: string | null
  // Detected FORMAT line. Reuses the EXISTING locale/format mechanism (LocaleDeclaration),
  // not a new detected-format API. null = no locale rule applies to this field's datatype.
  // TODO(wire): the real detected format would come from the same source-shape inference the
  // CSV path uses; here it is a pre-filled stub.
  detectedFormat: LocaleDeclaration | null
  // A couple of sample values for context.
  sampleValues: string[]
}

export type ConnectorMappingResponse = {
  // TODO(wire): mirror MappingSuggestionResponse.source ("llm"/"fallback"); "vertex" here is
  // the placeholder label for the LLM path.
  source: ConnectorMappingSource
  fields: ConnectorMappingField[]
}

// TODO(wire): POST /api/v1/connectors/{connector}/mapping-suggestions with the selected data
// types. Server returns per-field Vertex suggestions (target + alternatives + confidence +
// reasoning) plus the detected source-shape format. This stub returns a fixed orders-shaped
// suggestion set whose targets are real catalog keys (so the canonical select always matches).
export function fetchMappingSuggestions(
  connector: ConnectorKey,
  dataTypes: ConnectorDataType[],
): Promise<ConnectorMappingResponse> {
  void connector
  void dataTypes
  return Promise.resolve({
    source: 'vertex',
    fields: [
      {
        sourceField: 'order_id',
        suggestedTarget: 'transaction_id',
        alternatives: ['line_item_seq'],
        confidence: 0.97,
        reasoning: 'Field name and sample values match a transaction reference.',
        detectedFormat: null,
        sampleValues: ['1001', '1002'],
      },
      {
        sourceField: 'line_sku',
        suggestedTarget: 'sku_id',
        alternatives: ['sku_variant'],
        confidence: 0.95,
        reasoning: 'Column name "sku" maps directly to the canonical SKU identifier.',
        detectedFormat: null,
        sampleValues: ['TSHIRT-RED-M', 'MUG-001'],
      },
      {
        sourceField: 'quantity',
        suggestedTarget: 'quantity',
        alternatives: [],
        confidence: 0.92,
        reasoning: 'Exact name match to canonical quantity.',
        detectedFormat: { decimal_separator: '.', thousands_separator: '' },
        sampleValues: ['2', '1'],
      },
      {
        sourceField: 'unit_price',
        suggestedTarget: 'unit_sale_price',
        alternatives: ['unit_retail_price'],
        confidence: 0.74,
        reasoning: 'Likely the price charged per unit; confirm against retail price.',
        detectedFormat: { decimal_separator: '.', thousands_separator: ',' },
        sampleValues: ['1,299.50', '19.00'],
      },
      {
        sourceField: 'created_at',
        suggestedTarget: 'source_sale_timestamp',
        alternatives: [],
        confidence: 0.88,
        reasoning: 'Order creation time aligns with the sale timestamp.',
        detectedFormat: { format: '%Y-%m-%d', timezone: 'America/New_York' },
        sampleValues: ['2026-05-30', '2026-05-31'],
      },
      {
        sourceField: 'currency_code',
        suggestedTarget: 'currency',
        alternatives: [],
        confidence: 0.6,
        reasoning: 'Three-letter code resembles an ISO 4217 currency.',
        detectedFormat: null,
        sampleValues: ['USD', 'USD'],
      },
      {
        sourceField: 'gateway',
        suggestedTarget: null,
        alternatives: ['payment_method'],
        confidence: 0.32,
        reasoning: 'No confident canonical target; review or ignore this field.',
        detectedFormat: null,
        sampleValues: ['stripe', 'cash'],
      },
    ],
  })
}

// ----- Template type ------------------------------------------------------------------

export type ConnectorTemplateType = { value: string; label: string }

// TODO(wire): the template type is backend-provided (derived from the connected data types /
// canonical event partition). GET /api/v1/connectors/{connector}/template-type. Stubbed value.
export function fetchTemplateType(): Promise<ConnectorTemplateType> {
  return Promise.resolve({ value: 'sale_event', label: 'Sale event' })
}

// ----- Preview ------------------------------------------------------------------------

// TODO(wire): the server would return canonical-coerced preview rows for the proposed
// mapping (the authoritative coercion). This stub returns fixed rows keyed by canonical
// field; the surface drops ignored fields before rendering.
export function fetchPreviewRows(): Promise<Record<string, string>[]> {
  return Promise.resolve([
    {
      transaction_id: '1001',
      sku_id: 'TSHIRT-RED-M',
      quantity: '2',
      unit_sale_price: '1299.50',
      source_sale_timestamp: '2026-05-30T00:00:00-04:00',
      currency: 'USD',
    },
    {
      transaction_id: '1002',
      sku_id: 'MUG-001',
      quantity: '1',
      unit_sale_price: '19.00',
      source_sale_timestamp: '2026-05-31T00:00:00-04:00',
      currency: 'USD',
    },
  ])
}

// ----- Create the live source ---------------------------------------------------------

export type LiveConnectorSource = {
  id: string
  connector: ConnectorKey
  sourceName: string
  status: 'live' | 'paused'
  // ISO timestamp of the last sync, or null if it has not run yet.
  lastSyncAt: string | null
  recordsSynced: number
}

export type CreateConnectorSourceInput = {
  connector: ConnectorKey
  sourceName: string
  authMethod: 'oauth' | 'api_token'
  locationIds: string[]
  dataTypes: ConnectorDataType[]
  cadence: SyncCadence
  // Canonical keys the operator chose to ignore (excluded from the template).
  ignoredFields: string[]
  templateType: string
}

// TODO(wire): POST /api/v1/connectors with the assembled mapping template + sync config.
// Server creates the connector source (ACTIVE), kicks off the first sync, and returns the
// live source summary. Stubbed here.
export function createConnectorSource(
  input: CreateConnectorSourceInput,
): Promise<LiveConnectorSource> {
  return Promise.resolve({
    id: `src_stub_${input.connector}`,
    connector: input.connector,
    sourceName: input.sourceName,
    status: 'live',
    lastSyncAt: null,
    recordsSynced: 0,
  })
}
