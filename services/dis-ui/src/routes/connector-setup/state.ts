import type { ConnectorAuthMethod, ConnectorKey } from '../../lib/dis-ui-server/connectors-catalog'
import type {
  ConnectorAccount,
  ConnectorDataType,
  ConnectorMappingField,
  LiveConnectorSource,
  SyncCadence,
} from '../../lib/dis-ui-server/connectors-api'
import { CONNECTOR_STEP_COUNT, CONNECTOR_STEP_INDEX } from './steps'

// Pure state machine for the Live Sync connector wizard (Chunk 1). All step-advance gating,
// the per-field IGNORE flag, and the mapping-target override live here so the logic is unit
// testable without rendering. The route component owns only the side effects (the stub-api
// calls) and dispatches actions into this reducer.

export type LocationMapping = { checked: boolean; storeId: string }

export type ConnectorWizardState = {
  stepIndex: number
  connector: ConnectorKey | null
  sourceName: string
  authMethod: ConnectorAuthMethod
  // Pre-auth field values (OAuth path: shop domain / region), by field name.
  preAuth: Record<string, string>
  // API-token field values (token path), by field name.
  tokenFields: Record<string, string>
  // Set once the (stubbed) authorize / token submit succeeds.
  account: ConnectorAccount | null
  // locationId -> { checked, chosen DIS store_id }.
  locations: Record<string, LocationMapping>
  dataTypes: ConnectorDataType[]
  cadence: SyncCadence
  // sourceField -> chosen canonical key. Absent => use the suggestion's suggested target.
  // The suggestion set itself is NOT held here: it lives in the route's react-query layer
  // (connectors-api stub) and is passed into the gating helpers; the reducer holds only the
  // operator's decisions (overrides + ignores) so it stays a pure, fetch-free state machine.
  mappingOverrides: Record<string, string>
  // sourceField -> ignored (excluded from the template and the canonical preview).
  ignored: Record<string, boolean>
  templateType: string
  liveSource: LiveConnectorSource | null
}

export const initialConnectorWizardState: ConnectorWizardState = {
  stepIndex: 0,
  connector: null,
  sourceName: '',
  authMethod: 'oauth',
  preAuth: {},
  tokenFields: {},
  account: null,
  locations: {},
  dataTypes: ['orders'],
  cadence: 'daily',
  mappingOverrides: {},
  ignored: {},
  templateType: '',
  liveSource: null,
}

export type ConnectorWizardAction =
  | { type: 'selectConnector'; connector: ConnectorKey }
  | { type: 'setSourceName'; value: string }
  | { type: 'setAuthMethod'; method: ConnectorAuthMethod }
  | { type: 'setPreAuthField'; name: string; value: string }
  | { type: 'setTokenField'; name: string; value: string }
  | { type: 'setAccount'; account: ConnectorAccount }
  | { type: 'setLocationChecked'; locationId: string; checked: boolean }
  | { type: 'setLocationStore'; locationId: string; storeId: string }
  | { type: 'toggleDataType'; dataType: ConnectorDataType }
  | { type: 'setCadence'; cadence: SyncCadence }
  | { type: 'setMappingTarget'; sourceField: string; target: string }
  | { type: 'toggleIgnore'; sourceField: string }
  | { type: 'setTemplateType'; value: string }
  | { type: 'setLiveSource'; source: LiveConnectorSource }
  | { type: 'next' }
  | { type: 'back' }

function clampStep(index: number): number {
  return Math.max(0, Math.min(CONNECTOR_STEP_COUNT - 1, index))
}

export function connectorWizardReducer(
  state: ConnectorWizardState,
  action: ConnectorWizardAction,
): ConnectorWizardState {
  switch (action.type) {
    case 'selectConnector':
      // Switching connectors resets the connector-specific credential + account state so a
      // half-entered form for one provider never leaks into another.
      return {
        ...state,
        connector: action.connector,
        preAuth: {},
        tokenFields: {},
        account: null,
      }
    case 'setSourceName':
      return { ...state, sourceName: action.value }
    case 'setAuthMethod':
      return { ...state, authMethod: action.method }
    case 'setPreAuthField':
      return { ...state, preAuth: { ...state.preAuth, [action.name]: action.value } }
    case 'setTokenField':
      return { ...state, tokenFields: { ...state.tokenFields, [action.name]: action.value } }
    case 'setAccount':
      return { ...state, account: action.account }
    case 'setLocationChecked':
      return {
        ...state,
        locations: {
          ...state.locations,
          [action.locationId]: {
            checked: action.checked,
            storeId: state.locations[action.locationId]?.storeId ?? '',
          },
        },
      }
    case 'setLocationStore':
      return {
        ...state,
        locations: {
          ...state.locations,
          [action.locationId]: {
            checked: state.locations[action.locationId]?.checked ?? true,
            storeId: action.storeId,
          },
        },
      }
    case 'toggleDataType': {
      const has = state.dataTypes.includes(action.dataType)
      return {
        ...state,
        dataTypes: has
          ? state.dataTypes.filter((d) => d !== action.dataType)
          : [...state.dataTypes, action.dataType],
      }
    }
    case 'setCadence':
      return { ...state, cadence: action.cadence }
    case 'setMappingTarget':
      return {
        ...state,
        mappingOverrides: { ...state.mappingOverrides, [action.sourceField]: action.target },
      }
    case 'toggleIgnore':
      return {
        ...state,
        ignored: {
          ...state.ignored,
          [action.sourceField]: !(state.ignored[action.sourceField] ?? false),
        },
      }
    case 'setTemplateType':
      return { ...state, templateType: action.value }
    case 'setLiveSource':
      return { ...state, liveSource: action.source }
    case 'next':
      return { ...state, stepIndex: clampStep(state.stepIndex + 1) }
    case 'back':
      return { ...state, stepIndex: clampStep(state.stepIndex - 1) }
    default:
      return state
  }
}

// The canonical target for a field: the operator's override if set, else the suggested
// target, else '' (unmapped). Mirrors the CSV path's overrideFor pattern.
export function mappingTargetFor(
  state: ConnectorWizardState,
  field: ConnectorMappingField,
): string {
  return state.mappingOverrides[field.sourceField] ?? field.suggestedTarget ?? ''
}

export function isIgnored(state: ConnectorWizardState, sourceField: string): boolean {
  return state.ignored[sourceField] ?? false
}

// The fields that will actually contribute to the template (not ignored), in order. The
// suggestion set is passed in (it lives in the route's query layer, not the reducer).
export function activeMappingFields(
  state: ConnectorWizardState,
  mappingFields: ConnectorMappingField[],
): ConnectorMappingField[] {
  return mappingFields.filter((f) => !isIgnored(state, f.sourceField))
}

// Whether the wizard may advance from the current step. Pure: drives the Next/primary CTA
// disabled state. `mappingFields` is the (query-supplied) suggestion set, needed only by the
// mapping step. The Preview step is intentionally non-blocking (always advanceable); the Live
// step is terminal.
export function canAdvance(
  state: ConnectorWizardState,
  mappingFields: ConnectorMappingField[] = [],
): boolean {
  switch (state.stepIndex) {
    case CONNECTOR_STEP_INDEX.source:
      return state.connector !== null
    case CONNECTOR_STEP_INDEX.connect:
      // The authorize / token-submit action establishes the account and advances; until then
      // there is nothing to advance to.
      return state.sourceName.trim().length > 0 && state.account !== null
    case CONNECTOR_STEP_INDEX.authorized:
      return state.account !== null
    case CONNECTOR_STEP_INDEX.locations: {
      const checked = Object.values(state.locations).filter((l) => l.checked)
      return checked.length > 0 && checked.every((l) => l.storeId.length > 0)
    }
    case CONNECTOR_STEP_INDEX.dataSync:
      return state.dataTypes.length > 0
    case CONNECTOR_STEP_INDEX.mapping: {
      if (mappingFields.length === 0) {
        return false
      }
      // Every non-ignored field must have a canonical target.
      return activeMappingFields(state, mappingFields).every(
        (f) => mappingTargetFor(state, f).length > 0,
      )
    }
    case CONNECTOR_STEP_INDEX.preview:
      return true
    case CONNECTOR_STEP_INDEX.live:
      return false
    default:
      return false
  }
}
