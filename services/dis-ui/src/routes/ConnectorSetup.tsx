import { useReducer, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { useAuth } from '../auth/useAuth'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  analyzeCsvSample,
  createConnectorSource,
  createCsvTemplate,
  exchangeToken,
  fetchCsvPreviewRows,
  fetchLocations,
  fetchMappingSuggestions,
  fetchPreviewRows,
  fetchTemplateType,
  initiateOAuth,
  submitApiToken,
} from '../lib/dis-ui-server/connectors-api'
import {
  useTemplateMappingFields,
  useTemplateMappingFieldsForType,
} from '../lib/dis-ui-server/mapping-fields'
import { useTemplateTypes } from '../lib/dis-ui-server/template-types'
import { useStoresOnboarded } from '../lib/dis-ui-server/stores'
import { StepRail } from './connector-setup/StepRail'
import { STEP_DEFS, flowFor } from './connector-setup/steps'
import {
  canAdvance,
  connectorWizardReducer,
  currentStepKey,
  initialConnectorWizardState,
  isIgnored,
  mappingTargetFor,
} from './connector-setup/state'
import { SourceStep } from './connector-setup/SourceStep'
import { ConnectStep } from './connector-setup/ConnectStep'
import { AuthorizedStep } from './connector-setup/AuthorizedStep'
import { LocationsStep } from './connector-setup/LocationsStep'
import { DataSyncStep } from './connector-setup/DataSyncStep'
import { CsvUploadStep } from './connector-setup/CsvUploadStep'
import { TemplateTypeStep } from './connector-setup/TemplateTypeStep'
import { MappingStep } from './connector-setup/MappingStep'
import { PreviewStep } from './connector-setup/PreviewStep'
import { LiveStep } from './connector-setup/LiveStep'
import { CsvCreatedStep } from './connector-setup/CsvCreatedStep'

// Unified Add Source surface (Chunk 1 POS + Chunk 2 CSV/SFTP), at /connectors/new. Two branches
// share the shell (StepRail, container, typography) but run different step flows; the reducer is
// branch-aware. WIRED (mode-aware, fixture-backed in tests): GET /api/v1/template-types and GET
// /api/v1/template-mapping-fields?template_type=X drive the CSV branch's Template type step and
// type-aware canonical targets. STUBBED at the connectors-api seam: CSV sample upload/analysis,
// the create-template POST, and preview rows (contracts not confirmed) - plus the entire POS
// branch (Chunk 1). The existing old Add Source (/connect, MappingReview) is untouched.
export function ConnectorSetup() {
  const { snapshot } = useAuth()
  const [state, dispatch] = useReducer(connectorWizardReducer, initialConnectorWizardState)
  const [authorizing, setAuthorizing] = useState(false)

  const stepKey = currentStepKey(state)
  const isCsv = state.branch === 'csv'

  const stores = useStoresOnboarded(snapshot)

  // ----- POS branch data (all stubbed, unchanged from Chunk 1) -----
  const posCatalog = useTemplateMappingFields()
  const locationsQuery = useQuery({
    queryKey: ['connectors', 'locations', state.connector],
    queryFn: () => fetchLocations(state.connector ?? 'shopify'),
    enabled: state.branch === 'pos' && state.connector !== null,
    staleTime: Infinity,
    retry: false,
  })
  const posMappingQuery = useQuery({
    queryKey: ['connectors', 'mapping', state.connector, state.dataTypes],
    queryFn: () => fetchMappingSuggestions(state.connector ?? 'shopify', state.dataTypes),
    enabled: state.branch === 'pos' && stepKey === 'mapping',
    staleTime: Infinity,
    retry: false,
  })
  const posTemplateTypeQuery = useQuery({
    queryKey: ['connectors', 'template-type'],
    queryFn: fetchTemplateType,
    enabled: state.branch === 'pos' && stepKey === 'preview',
    staleTime: Infinity,
    retry: false,
  })
  const posPreviewQuery = useQuery({
    queryKey: ['connectors', 'preview'],
    queryFn: fetchPreviewRows,
    enabled: state.branch === 'pos' && stepKey === 'preview',
    staleTime: Infinity,
    retry: false,
  })

  // ----- CSV branch data (WIRED catalog + types; stubbed upload/preview) -----
  const templateTypesQuery = useTemplateTypes()
  // WIRED: the type-aware canonical catalog (requires the chosen template_type).
  const csvFieldsQuery = useTemplateMappingFieldsForType(isCsv ? state.templateType : null)
  // STUBBED: the CSV sample analysis + suggestions.
  const csvAnalysisQuery = useQuery({
    queryKey: ['connectors', 'csv-analysis', state.csvFileName],
    queryFn: () => analyzeCsvSample(state.csvFileName),
    enabled: isCsv && state.csvAnalysisReady,
    staleTime: Infinity,
    retry: false,
  })
  // STUBBED: the CSV preview rows.
  const csvPreviewQuery = useQuery({
    queryKey: ['connectors', 'csv-preview'],
    queryFn: fetchCsvPreviewRows,
    enabled: isCsv && stepKey === 'preview',
    staleTime: Infinity,
    retry: false,
  })

  // Branch-resolved views the steps consume.
  const mapping = isCsv ? (csvAnalysisQuery.data ?? null) : (posMappingQuery.data ?? null)
  const mappingFields = mapping?.fields ?? []
  const mappingCatalog = isCsv ? (csvFieldsQuery.data ?? []) : (posCatalog.data ?? [])
  const mappingLoading = isCsv
    ? csvAnalysisQuery.isLoading || csvFieldsQuery.isLoading
    : posMappingQuery.isLoading || posCatalog.isPending
  const previewRows = isCsv ? (csvPreviewQuery.data ?? []) : (posPreviewQuery.data ?? [])
  const previewLoading = isCsv ? csvPreviewQuery.isLoading : posPreviewQuery.isLoading
  // POS keeps its Chunk-1 template-type handling (stub fetch + preview select); CSV uses the
  // type chosen on its own step.
  const effectiveTemplateType = isCsv
    ? state.templateType
    : state.templateType !== ''
      ? state.templateType
      : (posTemplateTypeQuery.data?.value ?? '')

  // Authorize (OAuth) or submit the API token (POS). STUBBED: sets the account and advances.
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

  // Create the live source (POS, STUBBED) and advance to the Live confirmation.
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

  // Create the mapping template (CSV, STUBBED). Ignored columns are represented by assigning
  // them to the `__ignore__` catalog field. No real POST (the create contract is unconfirmed).
  async function handleCreateTemplate(): Promise<void> {
    const fieldTargets: Record<string, string> = {}
    for (const field of mappingFields) {
      fieldTargets[field.sourceField] = isIgnored(state, field.sourceField)
        ? '__ignore__'
        : mappingTargetFor(state, field)
    }
    const created = await createCsvTemplate({
      sourceName: state.sourceName,
      templateType: state.templateType,
      fieldTargets,
    })
    dispatch({ type: 'setCreatedTemplate', template: created })
    dispatch({ type: 'next' })
  }

  function renderStep() {
    switch (stepKey) {
      case 'source':
        return <SourceStep state={state} dispatch={dispatch} />
      case 'connect':
        return (
          <ConnectStep
            state={state}
            dispatch={dispatch}
            onAuthorize={() => void handleAuthorize()}
            authorizing={authorizing}
          />
        )
      case 'authorized':
        return <AuthorizedStep state={state} />
      case 'locations':
        return (
          <LocationsStep
            state={state}
            dispatch={dispatch}
            locations={locationsQuery.data ?? []}
            stores={stores.data ?? []}
            loading={locationsQuery.isLoading}
          />
        )
      case 'dataSync':
        return <DataSyncStep state={state} dispatch={dispatch} />
      case 'upload':
        return <CsvUploadStep state={state} dispatch={dispatch} />
      case 'templateType':
        return (
          <TemplateTypeStep
            state={state}
            dispatch={dispatch}
            templateTypes={templateTypesQuery.data ?? []}
            loading={templateTypesQuery.isLoading}
          />
        )
      case 'mapping':
        return (
          <MappingStep
            state={state}
            dispatch={dispatch}
            mapping={mapping}
            catalog={mappingCatalog}
            loading={mappingLoading}
          />
        )
      case 'preview':
        return (
          <PreviewStep
            state={state}
            dispatch={dispatch}
            mappingFields={mappingFields}
            templateType={effectiveTemplateType}
            rows={previewRows}
            loading={previewLoading}
            readOnlyTemplateType={isCsv}
          />
        )
      case 'live':
        return <LiveStep state={state} />
      case 'created':
        return <CsvCreatedStep state={state} />
      default:
        return null
    }
  }

  // Footer primary action varies by step. Connect has no generic Next (its authorize button
  // advances); the terminal steps (live/created) show a Done link.
  function renderFooter() {
    if (stepKey === 'live' || stepKey === 'created') {
      return (
        <div className="flex gap-3">
          <Link to="/" className={buttonVariants({ variant: 'default' })}>
            Done
          </Link>
        </div>
      )
    }

    const back =
      state.stepIndex > 0 ? (
        <Button type="button" variant="ghost" onClick={() => dispatch({ type: 'back' })}>
          Back
        </Button>
      ) : null

    if (stepKey === 'connect') {
      // The authorize / token-submit button inside ConnectStep advances; only Back here.
      return <div className="flex gap-3">{back}</div>
    }

    const label =
      stepKey === 'authorized'
        ? 'Continue'
        : stepKey === 'mapping'
          ? 'Continue to preview'
          : stepKey === 'preview'
            ? isCsv
              ? 'Create template'
              : 'Go live'
            : 'Next'

    const onClick =
      stepKey === 'preview'
        ? isCsv
          ? () => void handleCreateTemplate()
          : () => void handleGoLive()
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

  const flow = flowFor(state.branch)
  const meta = STEP_DEFS[stepKey]

  return (
    // Centered container (~920px) so the wizard uses the page width. Page padding comes from
    // AppLayout's <main> (p-6); this only centers + caps width.
    <section className="mx-auto flex w-full max-w-[920px] flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-display">Connect a system</h1>
        <p className="text-body text-muted-foreground">
          Connect a live system or upload a file. We map it to the canonical schema, you approve, it
          goes live.
        </p>
      </header>

      <StepRail steps={flow.map((k) => STEP_DEFS[k].label)} current={state.stepIndex} />

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
