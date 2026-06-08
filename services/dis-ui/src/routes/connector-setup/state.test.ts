import type { ConnectorMappingField } from '../../lib/dis-ui-server/connectors-api'
import { CONNECTOR_STEP_COUNT, CONNECTOR_STEP_INDEX } from './steps'
import {
  activeMappingFields,
  canAdvance,
  connectorWizardReducer,
  initialConnectorWizardState,
  isIgnored,
  mappingTargetFor,
} from './state'
import type { ConnectorWizardState } from './state'

// Pure stepper-logic + ignore-toggle tests for the Live Sync connector wizard. No rendering;
// just the reducer and its gating helpers.

const MAPPING_FIELDS: ConnectorMappingField[] = [
  {
    sourceField: 'order_id',
    suggestedTarget: 'transaction_id',
    alternatives: [],
    confidence: 0.9,
    reasoning: 'ref',
    detectedFormat: null,
    sampleValues: ['1'],
  },
  {
    sourceField: 'gateway',
    suggestedTarget: null,
    alternatives: ['payment_method'],
    confidence: 0.3,
    reasoning: null,
    detectedFormat: null,
    sampleValues: ['cash'],
  },
]

function reduce(
  state: ConnectorWizardState,
  ...actions: Parameters<typeof connectorWizardReducer>[1][]
) {
  return actions.reduce((s, a) => connectorWizardReducer(s, a), state)
}

describe('connectorWizardReducer - stepper', () => {
  it('starts at the Source step and cannot advance without a connector', () => {
    expect(initialConnectorWizardState.stepIndex).toBe(CONNECTOR_STEP_INDEX.source)
    expect(canAdvance(initialConnectorWizardState)).toBe(false)
  })

  it('selecting a connector unblocks the Source step', () => {
    const next = connectorWizardReducer(initialConnectorWizardState, {
      type: 'selectConnector',
      connector: 'shopify',
    })
    expect(next.connector).toBe('shopify')
    expect(canAdvance(next)).toBe(true)
  })

  it('next advances and back retreats, clamped to the step bounds', () => {
    const atOne = connectorWizardReducer(initialConnectorWizardState, { type: 'next' })
    expect(atOne.stepIndex).toBe(1)
    // back from step 0 stays at 0
    expect(connectorWizardReducer(initialConnectorWizardState, { type: 'back' }).stepIndex).toBe(0)
    // next never exceeds the last step
    let s = initialConnectorWizardState
    for (let i = 0; i < CONNECTOR_STEP_COUNT + 5; i += 1) {
      s = connectorWizardReducer(s, { type: 'next' })
    }
    expect(s.stepIndex).toBe(CONNECTOR_STEP_COUNT - 1)
  })

  it('switching connector resets credential + account state', () => {
    const s = reduce(
      initialConnectorWizardState,
      { type: 'selectConnector', connector: 'shopify' },
      { type: 'setPreAuthField', name: 'shop_domain', value: 'x.myshopify.com' },
      {
        type: 'setAccount',
        account: { businessName: 'b', accountId: 'a', readOnly: true, tokenStored: true },
      },
      { type: 'selectConnector', connector: 'square' },
    )
    expect(s.connector).toBe('square')
    expect(s.preAuth).toEqual({})
    expect(s.account).toBeNull()
  })
})

describe('connectorWizardReducer - step gating', () => {
  it('Connect step requires a source name and an established account', () => {
    let s: ConnectorWizardState = {
      ...initialConnectorWizardState,
      stepIndex: CONNECTOR_STEP_INDEX.connect,
      connector: 'shopify',
    }
    expect(canAdvance(s)).toBe(false)
    s = connectorWizardReducer(s, { type: 'setSourceName', value: 'Shop sales' })
    expect(canAdvance(s)).toBe(false)
    s = connectorWizardReducer(s, {
      type: 'setAccount',
      account: { businessName: 'b', accountId: 'a', readOnly: true, tokenStored: true },
    })
    expect(canAdvance(s)).toBe(true)
  })

  it('Locations step requires at least one checked location, each with a store', () => {
    let s: ConnectorWizardState = {
      ...initialConnectorWizardState,
      stepIndex: CONNECTOR_STEP_INDEX.locations,
    }
    expect(canAdvance(s)).toBe(false)
    s = connectorWizardReducer(s, {
      type: 'setLocationChecked',
      locationId: 'loc_001',
      checked: true,
    })
    expect(canAdvance(s)).toBe(false) // checked but no store
    s = connectorWizardReducer(s, {
      type: 'setLocationStore',
      locationId: 'loc_001',
      storeId: 'store-1',
    })
    expect(canAdvance(s)).toBe(true)
  })

  it('Data & sync step requires at least one data type', () => {
    let s: ConnectorWizardState = {
      ...initialConnectorWizardState,
      stepIndex: CONNECTOR_STEP_INDEX.dataSync,
    }
    expect(canAdvance(s)).toBe(true) // 'orders' is selected by default
    s = connectorWizardReducer(s, { type: 'toggleDataType', dataType: 'orders' })
    expect(s.dataTypes).toEqual([])
    expect(canAdvance(s)).toBe(false)
  })

  it('Preview step is non-blocking and the Live step is terminal', () => {
    expect(
      canAdvance({ ...initialConnectorWizardState, stepIndex: CONNECTOR_STEP_INDEX.preview }),
    ).toBe(true)
    expect(
      canAdvance({ ...initialConnectorWizardState, stepIndex: CONNECTOR_STEP_INDEX.live }),
    ).toBe(false)
  })
})

describe('connectorWizardReducer - mapping + ignore', () => {
  const base: ConnectorWizardState = {
    ...initialConnectorWizardState,
    stepIndex: CONNECTOR_STEP_INDEX.mapping,
    connector: 'shopify',
  }

  it('mappingTargetFor uses the override, else the suggestion, else empty', () => {
    expect(mappingTargetFor(base, MAPPING_FIELDS[0])).toBe('transaction_id') // suggestion
    expect(mappingTargetFor(base, MAPPING_FIELDS[1])).toBe('') // no suggestion -> unmapped
    const overridden = connectorWizardReducer(base, {
      type: 'setMappingTarget',
      sourceField: 'order_id',
      target: 'line_item_seq',
    })
    expect(mappingTargetFor(overridden, MAPPING_FIELDS[0])).toBe('line_item_seq')
  })

  it('cannot advance while a non-ignored field is unmapped', () => {
    // gateway has no target -> blocked
    expect(canAdvance(base, MAPPING_FIELDS)).toBe(false)
  })

  it('ignoring the unmapped field unblocks advancing and excludes it from active fields', () => {
    const s = connectorWizardReducer(base, { type: 'toggleIgnore', sourceField: 'gateway' })
    expect(isIgnored(s, 'gateway')).toBe(true)
    expect(activeMappingFields(s, MAPPING_FIELDS).map((f) => f.sourceField)).toEqual(['order_id'])
    expect(canAdvance(s, MAPPING_FIELDS)).toBe(true)
  })

  it('toggleIgnore flips the flag back off', () => {
    const on = connectorWizardReducer(base, { type: 'toggleIgnore', sourceField: 'gateway' })
    const off = connectorWizardReducer(on, { type: 'toggleIgnore', sourceField: 'gateway' })
    expect(isIgnored(off, 'gateway')).toBe(false)
  })
})
