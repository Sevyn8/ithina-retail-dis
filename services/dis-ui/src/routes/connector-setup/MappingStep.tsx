import { ArrowRight } from 'lucide-react'
import type { Dispatch } from 'react'

import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { LoadingState } from '../../components/states/LoadingState'
import { StatusBadge } from '../../components/StatusBadge'
import type { StatusTone } from '../../components/StatusBadge'
import {
  DATE_FORMAT_CHOICES,
  DECIMAL_CHOICES,
  requiredRuleKind,
} from '../../components/locale-rules'
import type { LocaleDeclaration, RuleKind } from '../../components/locale-rules'
import type { FieldSection, TemplateMappingField } from '../../lib/dis-ui-server/mapping-fields'
import type {
  ConnectorMappingField,
  ConnectorMappingResponse,
} from '../../lib/dis-ui-server/connectors-api'
import { isIgnored, mappingTargetFor } from './state'
import type { ConnectorWizardAction, ConnectorWizardState } from './state'

// Step 6 (AI mapping): per-field rows - source field -> canonical select (pre-selected from
// the suggestion), a confidence chip (High/Medium/Low) + a "why" reasoning line, a detected
// FORMAT line, and a per-row IGNORE checkbox.
//
// DELIBERATE DUPLICATION: the canonical-select grouping and the format-line rendering mirror
// MappingReview.tsx rather than sharing a component. MappingReview is a route tightly coupled
// to onboarding sample state (useSample / patchSampleMapping / dryRun); extracting a shared
// component would mean editing the existing Add Source surface, which must stay untouched.
// We DO reuse the genuinely shared, side-effect-free pieces: the mapping-fields catalog, the
// locale-rules format mechanism, the suggestion-shaped types, and the UI primitives.
//
// The confidence + reasoning come from the STUBBED suggestion (TODO-wire-to-Vertex in
// connectors-api). The detected FORMAT reuses the SAME locale/format mechanism (locale-rules);
// it is not a new detected-format API.

const SECTION_LABEL: Record<FieldSection, string> = {
  sale_event: 'Sale event',
  change_event: 'Change event',
}

// Confidence -> a High/Medium/Low chip in a semantic tone (presentation only).
function confidenceBand(confidence: number): { text: string; tone: StatusTone } {
  if (confidence >= 0.8) {
    return { text: 'High', tone: 'success' }
  }
  if (confidence >= 0.5) {
    return { text: 'Medium', tone: 'warning' }
  }
  return { text: 'Low', tone: 'danger' }
}

// A human description of the detected format, built from the SAME locale-rules choices the
// CSV path uses (so the surfaces read identically). null kind => no conversion needed.
function describeFormat(kind: RuleKind, decl: LocaleDeclaration | null): string {
  if (kind === null) {
    return 'No format conversion needed'
  }
  if (decl === null) {
    return 'Format not detected; declare it before going live'
  }
  if (kind === 'decimal') {
    const choice = DECIMAL_CHOICES.find((c) => c.value === decl.decimal_separator)
    const thousands = decl.thousands_separator ? `, thousands "${decl.thousands_separator}"` : ''
    return choice ? `${choice.label}${thousands}` : 'Decimal separator detected'
  }
  // date / datetime
  const choice = DATE_FORMAT_CHOICES.find((c) => c.value === decl.format)
  const tz = kind === 'datetime' && decl.timezone ? ` in ${decl.timezone}` : ''
  return choice ? `${choice.example}${tz}` : 'Date format detected'
}

export function MappingStep({
  state,
  dispatch,
  mapping,
  catalog,
  loading,
}: {
  state: ConnectorWizardState
  dispatch: Dispatch<ConnectorWizardAction>
  mapping: ConnectorMappingResponse | null
  catalog: TemplateMappingField[]
  loading: boolean
}) {
  if (loading || mapping === null) {
    return <LoadingState label="Suggesting field mappings..." />
  }

  // Catalog datatype lookup by key (first section wins; datatype is consistent per key).
  const catalogByKey = new Map<string, TemplateMappingField>()
  for (const field of catalog) {
    if (!catalogByKey.has(field.key)) {
      catalogByKey.set(field.key, field)
    }
  }

  // Section-grouped canonical options (duplicated from MappingReview's renderCanonicalGroups).
  function renderCanonicalGroups() {
    return (['sale_event', 'change_event'] as FieldSection[]).map((section) => {
      const inSection = catalog.filter((field) => field.section === section)
      if (inSection.length === 0) {
        return null
      }
      return (
        <optgroup key={section} label={SECTION_LABEL[section]}>
          {inSection.map((field) => (
            <option key={`${section}-${field.key}`} value={field.key}>
              {field.display_name}
              {field.mandatory ? ' *' : ''} ({field.datatype})
            </option>
          ))}
        </optgroup>
      )
    })
  }

  function row(field: ConnectorMappingField) {
    const target = mappingTargetFor(state, field)
    const ignored = isIgnored(state, field.sourceField)
    const band = confidenceBand(field.confidence)
    // The locale rule the MAPPED field's datatype implies (recomputes with the target).
    const datatype = catalogByKey.get(target)?.datatype
    const kind: RuleKind = datatype === undefined ? null : requiredRuleKind(datatype)
    return (
      <div
        key={field.sourceField}
        className={cn(
          'flex flex-col gap-2.5 rounded-md border border-border px-4 py-3.5',
          ignored && 'opacity-50',
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-mono text-sm text-foreground">{field.sourceField}</span>
          <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <Select
            aria-label={`Canonical for ${field.sourceField}`}
            value={target}
            disabled={ignored}
            onChange={(e) =>
              dispatch({
                type: 'setMappingTarget',
                sourceField: field.sourceField,
                target: e.target.value,
              })
            }
            className="h-8 w-auto"
          >
            <option value="">Unmapped</option>
            {field.alternatives.length > 0 ? (
              <optgroup label="Assistant's alternatives">
                {field.alternatives.map((alt) => (
                  <option key={`alt-${alt}`} value={alt}>
                    {alt}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {renderCanonicalGroups()}
          </Select>
          {ignored ? (
            <StatusBadge tone="neutral">Ignored</StatusBadge>
          ) : (
            // TODO-wire-to-Vertex: confidence is a placeholder from the stub suggestion.
            <StatusBadge tone={band.tone}>
              {Math.round(field.confidence * 100)}% {band.text}
            </StatusBadge>
          )}
          <label className="ml-auto flex items-center gap-1 text-caption text-muted-foreground">
            <input
              type="checkbox"
              aria-label={`Ignore ${field.sourceField}`}
              checked={ignored}
              onChange={() => dispatch({ type: 'toggleIgnore', sourceField: field.sourceField })}
            />
            Ignore
          </label>
        </div>

        {!ignored ? (
          <>
            {/* TODO-wire-to-Vertex: the "why" reasoning line is a placeholder from the stub. */}
            {field.reasoning != null && field.reasoning.length > 0 ? (
              <div className="text-body text-muted-foreground italic">Why: {field.reasoning}</div>
            ) : null}
            <div className="text-body text-muted-foreground">
              Detected format: {describeFormat(kind, field.detectedFormat)}
            </div>
          </>
        ) : (
          <div className="text-body text-muted-foreground">
            Excluded from the canonical template.
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex">
        {/* TODO-wire-to-Vertex: source label mirrors MappingSuggestionResponse.source. */}
        {mapping.source === 'vertex' ? (
          <StatusBadge tone="info">Suggestions: AI</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Suggestions: basic match</StatusBadge>
        )}
      </div>
      <div className="flex flex-col gap-3">{mapping.fields.map((field) => row(field))}</div>
    </div>
  )
}
