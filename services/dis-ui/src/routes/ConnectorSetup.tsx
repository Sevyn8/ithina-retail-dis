import { useReducer, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { useAuth } from '../auth/useAuth'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  createConnectorSource,
  exchangeToken,
  fetchLocations,
  fetchMappingSuggestions,
  fetchPreviewRows,
  fetchTemplateType,
  initiateOAuth,
  submitApiToken,
} from '../lib/dis-ui-server/connectors-api'
import { useTemplateMappingFields } from '../lib/dis-ui-server/mapping-fields'
import { useStoresOnboarded } from '../lib/dis-ui-server/stores'
import { StepRail } from './connector-setup/StepRail'
import { CONNECTOR_STEPS, CONNECTOR_STEP_INDEX, CONNECTOR_STEP_META } from './connector-setup/steps'
import {
  canAdvance,
  connectorWizardReducer,
  initialConnectorWizardState,
  isIgnored,
  mappingTargetFor,
} from './connector-setup/state'
import { SourceStep } from './connector-setup/SourceStep'
import { ConnectStep } from './connector-setup/ConnectStep'
import { AuthorizedStep } from './connector-setup/AuthorizedStep'
import { LocationsStep } from './connector-setup/LocationsStep'
import { DataSyncStep } from './connector-setup/DataSyncStep'
import { MappingStep } from './connector-setup/MappingStep'
import { PreviewStep } from './connector-setup/PreviewStep'
import { LiveStep } from './connector-setup/LiveStep'

// "Connect a System" surface (Chunk 1): a NEW, separate 8-step wizard for Live Sync POS
// connectors (Shopify / Square / Clover), at /connectors/new. UI-ONLY: every backend
// interaction is isolated behind the connectors-api stub seam (no real dis-ui-server call).
// The existing Add Source surface (/connect) is untouched; this is a distinct route and
// component tree. The reducer (connector-setup/state.ts) owns all step-advance gating and
// the per-field IGNORE logic; this route owns only the side effects (the stub-api calls,
// fetched through react-query so there are no manual effects).
export function ConnectorSetup() {
  const { snapshot } = useAuth()
  const [state, dispatch] = useReducer(connectorWizardReducer, initialConnectorWizardState)
  const [authorizing, setAuthorizing] = useState(false)

  const fields = useTemplateMappingFields()
  const stores = useStoresOnboarded(snapshot)

  // Stubbed connector data, fetched lazily per step via react-query (enabled gates the fetch).
  const locationsQuery = useQuery({
    queryKey: ['connectors', 'locations', state.connector],
    queryFn: () => fetchLocations(state.connector ?? 'shopify'),
    enabled: state.connector !== null && state.stepIndex >= CONNECTOR_STEP_INDEX.locations,
    staleTime: Infinity,
    retry: false,
  })
  const mappingQuery = useQuery({
    queryKey: ['connectors', 'mapping', state.connector, state.dataTypes],
    queryFn: () => fetchMappingSuggestions(state.connector ?? 'shopify', state.dataTypes),
    enabled: state.connector !== null && state.stepIndex === CONNECTOR_STEP_INDEX.mapping,
    staleTime: Infinity,
    retry: false,
  })
  const templateTypeQuery = useQuery({
    queryKey: ['connectors', 'template-type'],
    queryFn: fetchTemplateType,
    enabled: state.stepIndex === CONNECTOR_STEP_INDEX.preview,
    staleTime: Infinity,
    retry: false,
  })
  const previewQuery = useQuery({
    queryKey: ['connectors', 'preview'],
    queryFn: fetchPreviewRows,
    enabled: state.stepIndex === CONNECTOR_STEP_INDEX.preview,
    staleTime: Infinity,
    retry: false,
  })

  const mapping = mappingQuery.data ?? null
  const mappingFields = mapping?.fields ?? []
  // Template type: the operator's choice if made, else the backend-provided (stubbed) default.
  const effectiveTemplateType =
    state.templateType !== '' ? state.templateType : (templateTypeQuery.data?.value ?? '')

  // Authorize (OAuth) or submit the API token. STUBBED: calls the connectors-api stub, sets
  // the connected account, and advances. No real provider call.
  async function handleAuthorize(): Promise<void> {
    const connector = state.connector
    if (connector === null) {
      return
    }
    setAuthorizing(true)
    try {
      const account =
        state.authMethod === 'oauth'
          ? await initiateOAuth(connector, state.preAuth).then(() =>
              exchangeToken(connector, { state: `stub-state-${connector}` }),
            )
          : await submitApiToken(connector, state.tokenFields)
      dispatch({ type: 'setAccount', account })
      dispatch({ type: 'next' })
    } finally {
      setAuthorizing(false)
    }
  }

  // Create the live source (STUBBED) and advance to the Live confirmation.
  async function handleGoLive(): Promise<void> {
    const connector = state.connector
    if (connector === null) {
      return
    }
    const locationIds = Object.entries(state.locations)
      .filter(([, m]) => m.checked)
      .map(([id]) => id)
    const ignoredFields = mappingFields
      .filter((f) => isIgnored(state, f.sourceField))
      .map((f) => mappingTargetFor(state, f))
      .filter((t) => t.length > 0)
    const source = await createConnectorSource({
      connector,
      sourceName: state.sourceName,
      authMethod: state.authMethod,
      locationIds,
      dataTypes: state.dataTypes,
      cadence: state.cadence,
      ignoredFields,
      templateType: effectiveTemplateType,
    })
    dispatch({ type: 'setLiveSource', source })
    dispatch({ type: 'next' })
  }

  function renderStep() {
    switch (state.stepIndex) {
      case CONNECTOR_STEP_INDEX.source:
        return <SourceStep state={state} dispatch={dispatch} />
      case CONNECTOR_STEP_INDEX.connect:
        return (
          <ConnectStep
            state={state}
            dispatch={dispatch}
            onAuthorize={() => void handleAuthorize()}
            authorizing={authorizing}
          />
        )
      case CONNECTOR_STEP_INDEX.authorized:
        return <AuthorizedStep state={state} />
      case CONNECTOR_STEP_INDEX.locations:
        return (
          <LocationsStep
            state={state}
            dispatch={dispatch}
            locations={locationsQuery.data ?? []}
            stores={stores.data ?? []}
            loading={locationsQuery.isLoading}
          />
        )
      case CONNECTOR_STEP_INDEX.dataSync:
        return <DataSyncStep state={state} dispatch={dispatch} />
      case CONNECTOR_STEP_INDEX.mapping:
        return (
          <MappingStep
            state={state}
            dispatch={dispatch}
            mapping={mapping}
            catalog={fields.data ?? []}
            loading={mappingQuery.isLoading || fields.isPending}
          />
        )
      case CONNECTOR_STEP_INDEX.preview:
        return (
          <PreviewStep
            state={state}
            dispatch={dispatch}
            mappingFields={mappingFields}
            templateType={effectiveTemplateType}
            rows={previewQuery.data ?? []}
            loading={previewQuery.isLoading}
          />
        )
      case CONNECTOR_STEP_INDEX.live:
        return <LiveStep state={state} />
      default:
        return null
    }
  }

  // Footer primary action varies by step. The Connect step has no generic Next (its
  // authorize button advances); the Live step is terminal (a Done link instead).
  function renderFooter() {
    if (state.stepIndex === CONNECTOR_STEP_INDEX.live) {
      return (
        <div className="flex gap-3">
          <Link to="/" className={buttonVariants({ variant: 'default' })}>
            Done
          </Link>
        </div>
      )
    }

    const back =
      state.stepIndex > CONNECTOR_STEP_INDEX.source ? (
        <Button type="button" variant="ghost" onClick={() => dispatch({ type: 'back' })}>
          Back
        </Button>
      ) : null

    if (state.stepIndex === CONNECTOR_STEP_INDEX.connect) {
      // The authorize / token-submit button inside ConnectStep advances; only Back here.
      return <div className="flex gap-3">{back}</div>
    }

    const label =
      state.stepIndex === CONNECTOR_STEP_INDEX.authorized
        ? 'Continue'
        : state.stepIndex === CONNECTOR_STEP_INDEX.mapping
          ? 'Continue to preview'
          : state.stepIndex === CONNECTOR_STEP_INDEX.preview
            ? 'Go live'
            : 'Next'

    const onClick =
      state.stepIndex === CONNECTOR_STEP_INDEX.preview
        ? () => void handleGoLive()
        : () => dispatch({ type: 'next' })

    return (
      <div className="flex gap-3">
        {back}
        <Button type="button" disabled={!canAdvance(state, mappingFields)} onClick={onClick}>
          {label}
        </Button>
      </div>
    )
  }

  const meta = CONNECTOR_STEP_META[state.stepIndex]

  return (
    // Centered container (~920px) so the wizard uses the page width instead of hugging the left
    // edge. Page padding comes from AppLayout's <main> (p-6); this only centers + caps width.
    // gap-8 sets the vertical rhythm between the page header, the stepper, and the step body.
    <section className="mx-auto flex w-full max-w-[920px] flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-display">Connect a system</h1>
        <p className="text-body text-muted-foreground">
          Sync sales directly from your point-of-sale system. We map it to the canonical schema, you
          approve, it goes live.
        </p>
      </header>

      <StepRail steps={[...CONNECTOR_STEPS]} current={state.stepIndex} />

      {/* Per-step body: one shared header type scale (18px/500 title + 14px muted description)
          for every step, then the step content, with generous spacing between. */}
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1.5">
          <h2 className="text-[18px] leading-6 font-medium text-foreground">{meta.title}</h2>
          <p className="text-body text-muted-foreground">{meta.description}</p>
        </header>

        {renderStep()}
      </div>

      <div className="border-t border-border pt-6">{renderFooter()}</div>
    </section>
  )
}
