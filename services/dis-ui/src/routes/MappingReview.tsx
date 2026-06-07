import { ArrowRight, Check } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { useAuth } from '../auth/useAuth'

import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { ProgressRail } from '@/components/ui/progress-rail'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { DemoDataBanner } from '../components/DemoDataBanner'
import { StatusBadge } from '../components/StatusBadge'
import type { StatusTone } from '../components/StatusBadge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { patchSampleMapping, useSample } from '../lib/dis-ui-server/onboarding'
import type { DryRunResult, SampleColumn } from '../lib/dis-ui-server/onboarding'
import { DisUiServerHttpError } from '../lib/dis-ui-server/client'
import { createMappingTemplate } from '../lib/dis-ui-server/mapping-templates'
import type { MappingTemplateDetail } from '../lib/dis-ui-server/mapping-templates'
import { assembleMappingRules } from '../lib/onboarding/assemble-mapping-rules'
import { localDryRun } from '../lib/onboarding/dry-run-local'
import { useTemplateMappingFields } from '../lib/dis-ui-server/mapping-fields'
import type {
  FieldDatatype,
  FieldSection,
  TemplateMappingField,
} from '../lib/dis-ui-server/mapping-fields'
import { useStoresOnboarded } from '../lib/dis-ui-server/stores'
import {
  COMMON_TIMEZONES,
  DATE_FORMAT_CHOICES,
  DECIMAL_CHOICES,
  THOUSANDS_CHOICES,
  isRuleComplete,
  requiredRuleKind,
} from '../components/locale-rules'
import type { LocaleDeclaration, RuleKind } from '../components/locale-rules'
import { CSV_JOURNEY_STEPS, CSV_JOURNEY_STEP_INDEX } from './csv-journey'

type Override = { proposed_canonical: string; authoritative: boolean }

// The three sub-steps the review route runs behind the shared journey rail.
type JourneyStep = 'review' | 'preview' | 'golive'

// Map a create failure to a user-facing message (createMappingTemplate throws
// DisUiServerHttpError in real mode; the server's codes are mapped per the contract).
function createErrorMessage(err: unknown): string {
  if (err instanceof DisUiServerHttpError) {
    if (err.status === 409 || err.code === 'mapping_template_name_conflict') {
      return 'A template with that name already exists for this source. Choose a different name.'
    }
    if (err.status === 400 || err.code === 'mapping_config') {
      return 'The mapping rules were rejected. Check the field mappings and format rules.'
    }
    if (err.status === 403) {
      return 'You are not authorized to create a template for this tenant.'
    }
  }
  return 'Could not create the template. Please try again.'
}

// High-confidence columns are auto-mapped and shown calmly; the rest are pulled out for
// the operator's judgment. The threshold is the existing >=0.70 confidence band.
const HIGH_CONFIDENCE = 0.7

function confidenceBand(confidence: number): { text: string; tone: StatusTone } {
  if (confidence >= HIGH_CONFIDENCE) {
    return { text: 'OK', tone: 'success' }
  }
  if (confidence >= 0.5) {
    return { text: 'Low confidence', tone: 'warning' }
  }
  return { text: 'Very low confidence', tone: 'danger' }
}

// Review mapping / Preview / Go live (CSV journey steps 2-4; surface map screen 4), on the
// redesign visual language behind the shared 4-step rail. The framing is AI-assisted and
// human-approved: high-confidence columns are calm, low-confidence ones are pulled out for
// review (editable canonical target + the confidence signal). The data layer (onboarding.ts:
// the override echo, the 2.4 dry-run, the 2.5 approve) is UNCHANGED (R3); only the
// composition and the step flow are new. We display only backend-provided signals (the
// confidence, the canonical target, the mapping rules); no fabricated reasoning.
export function MappingReview() {
  const { sampleId } = useParams()
  const { snapshot } = useAuth()
  const navigate = useNavigate()
  const sample = useSample(sampleId ?? null)
  // Canonical mapping targets now come from the real template-mapping-fields catalog
  // (T1), not a hardcoded list. Section-grouped, with mandatory/datatype metadata.
  const fields = useTemplateMappingFields()

  // Onboarded-store timezones feed the datetime locale declaration (a datetime field
  // requires a timezone per the real parse_datetime op); never inferred, the user picks.
  const stores = useStoresOnboarded(snapshot)

  const [step, setStep] = useState<JourneyStep>('review')
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  // FORMAT-RULES declarations (T3), the second concern. Per source column, the locale
  // declaration that builds the REAL mapping_rules.normalize TransformSpec. Mandatory by
  // the mapped field's datatype and NEVER inferred/pre-filled - starts empty; the operator
  // must declare it before proceeding.
  const [localeRules, setLocaleRules] = useState<Record<string, LocaleDeclaration>>({})
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)
  // The created template (DRAFT) returned by Go-live; its lifecycle pointers advance as the
  // operator promotes (fixture synth; real mode only on a real 2xx, never faked).
  // The template created at go-live. Create-as-ACTIVE (D88): it is live in one step, so there is
  // no separate activate action and no promote/activation state.
  const [created, setCreated] = useState<MappingTemplateDetail | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Per-column UI expanders (T8): the format-rule "more examples" reveal, and the auto-mapped
  // row's "change" reveal of the canonical select. Keyed by source_col; default collapsed.
  const [showAllExamples, setShowAllExamples] = useState<Record<string, boolean>>({})
  const [editingField, setEditingField] = useState<Record<string, boolean>>({})

  // Catalog datatype lookup, by canonical key (first section wins; datatype is consistent
  // per key). Drives which locale rule a mapped column requires.
  const catalogByKey = new Map<string, TemplateMappingField>()
  for (const field of fields.data ?? []) {
    if (!catalogByKey.has(field.key)) {
      catalogByKey.set(field.key, field)
    }
  }
  const timezones = [
    ...new Set([...(stores.data ?? []).map((s) => s.timezone), ...COMMON_TIMEZONES]),
  ]

  // The canonical-target options, section-grouped from the catalog. Each option's value is
  // the canonical key, so selecting one is the same setOverride path as before (behavior
  // unchanged); the display carries the friendly name, a mandatory marker, and the datatype.
  const SECTION_LABEL: Record<FieldSection, string> = {
    sale_event: 'Sale event',
    change_event: 'Change event',
  }
  function renderCanonicalGroups() {
    const catalog: TemplateMappingField[] = fields.data ?? []
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

  if (sampleId === undefined) {
    return <EmptyState title="No sample" message="No sample id in the URL." />
  }
  if (sample.isPending) {
    return <LoadingState label="Loading mapping..." />
  }
  if (sample.isError) {
    return <ErrorState message="Could not load the sample analysis." />
  }
  // No analyzed sample in the store (reload / direct nav): a clean empty state, not demo
  // data and not a crash. The analysis lives only for the session that parsed the CSV.
  if (sample.data === null || sample.data === undefined) {
    return (
      <section className="flex flex-col gap-4">
        <EmptyState
          title="No analyzed sample"
          message="Upload a CSV to review its mapping; the analysis is not retained across reloads."
        />
        <div>
          <Link to="/upload" className={buttonVariants({ variant: 'default', size: 'sm' })}>
            Upload a CSV
          </Link>
        </div>
      </section>
    )
  }

  const analysis = sample.data

  function overrideFor(column: SampleColumn): Override {
    return (
      overrides[column.source_col] ?? {
        proposed_canonical: column.proposed_canonical,
        authoritative: false,
      }
    )
  }

  function setOverride(sourceCol: string, next: Override): void {
    setOverrides((prev) => ({ ...prev, [sourceCol]: next }))
    void patchSampleMapping(sampleId as string, {
      source_col: sourceCol,
      proposed_canonical: next.proposed_canonical,
      authoritative: next.authoritative,
    })
  }

  function setLocale(sourceCol: string, patch: Partial<LocaleDeclaration>): void {
    setLocaleRules((prev) => ({ ...prev, [sourceCol]: { ...prev[sourceCol], ...patch } }))
  }

  // The locale rule a column requires, from its MAPPED field's catalog datatype (recomputes
  // when the field mapping changes). null = no locale rule needed.
  function ruleKindFor(column: SampleColumn): RuleKind {
    const canonicalKey = overrideFor(column).proposed_canonical
    const datatype: FieldDatatype | undefined = catalogByKey.get(canonicalKey)?.datatype
    return datatype === undefined ? null : requiredRuleKind(datatype)
  }

  function continueToPreview(): void {
    setActionError(null)
    // Client-side, best-effort coercion preview (non-blocking): project the parsed sample rows
    // through the current mapping + locale rules and ALWAYS advance to preview. The server's
    // pipeline is the authoritative coercion; this preview never gates reaching go-live.
    const renameMap: Record<string, string> = {}
    for (const column of analysis.columns) {
      renameMap[column.source_col] = overrideFor(column).proposed_canonical
    }
    setDryRun(
      localDryRun({
        sampleRows: analysis.sample_rows,
        renameMap,
        localeRules,
        catalogByKey,
      }),
    )
    setStep('preview')
  }

  // Go-live: assemble the full mapping_rules from the wizard state, then CREATE the template
  // for real (mode-aware: real POST / fixture synth). Create-as-ACTIVE (D88): the result is
  // LIVE in one step (active_version=1), so the success copy says "Created and live" and there
  // is no separate activate step.
  async function goLive(): Promise<void> {
    setActionError(null)
    const assembled = assembleMappingRules(
      analysis.columns.map((column) => ({
        source_col: column.source_col,
        proposed_canonical: overrideFor(column).proposed_canonical,
        rule_kind: ruleKindFor(column),
        locale: localeRules[column.source_col],
      })),
    )
    if (!assembled.ok) {
      setActionError(assembled.error)
      return
    }
    try {
      const detail = await createMappingTemplate({
        source_id: analysis.source_id,
        template_name: analysis.template_name,
        mapping_rules: assembled.rules,
      })
      setCreated(detail)
      setStep('golive')
    } catch (err) {
      setActionError(createErrorMessage(err))
    }
  }

  const currentIndex =
    step === 'review'
      ? CSV_JOURNEY_STEP_INDEX.review
      : step === 'preview'
        ? CSV_JOURNEY_STEP_INDEX.preview
        : CSV_JOURNEY_STEP_INDEX.golive

  // Proceed gate (FM2): every column whose datatype requires a locale rule must have a
  // complete declaration before preview/go-live. Undeclared required rules block Continue.
  const undeclaredColumns = analysis.columns.filter(
    (c) => !isRuleComplete(ruleKindFor(c), localeRules[c.source_col]),
  )
  const allRulesDeclared = undeclaredColumns.length === 0

  // A column needs full attention if it is low-confidence OR carries a required locale rule
  // (so any rule-bearing column stays a full, editable card whether or not it is declared).
  function needsAttention(column: SampleColumn): boolean {
    return column.confidence < HIGH_CONFIDENCE || ruleKindFor(column) !== null
  }

  // The catalog-sourced canonical-target select (R8 alternatives optgroup + the section
  // groups). Same aria-label + setOverride path as before; shared by full and condensed cards.
  function canonicalSelect(column: SampleColumn, ov: Override) {
    return (
      <Select
        aria-label={`Canonical for ${column.source_col}`}
        value={ov.proposed_canonical}
        onChange={(e) =>
          setOverride(column.source_col, { ...ov, proposed_canonical: e.target.value })
        }
        className="h-7 w-auto"
      >
        {column.alternatives && column.alternatives.length > 0 ? (
          <optgroup label="Assistant's alternatives">
            {/* Alternatives are catalog keys (server list[str]); the server cannot supply a
                per-alternative confidence, so none is shown (no fabricated percentages). */}
            {column.alternatives.map((alt) => (
              <option key={`alt-${alt}`} value={alt}>
                {alt}
              </option>
            ))}
          </optgroup>
        ) : null}
        {renderCanonicalGroups()}
      </Select>
    )
  }

  function authoritativeToggle(column: SampleColumn, ov: Override) {
    return (
      <label className="flex items-center gap-1 text-caption text-muted-foreground">
        <input
          type="checkbox"
          aria-label={`Authoritative for ${column.source_col}`}
          checked={ov.authoritative}
          onChange={(e) =>
            setOverride(column.source_col, { ...ov, authoritative: e.target.checked })
          }
        />
        Authoritative
      </label>
    )
  }

  // A full card (T8): a header row (mono column + type/null/sample + confidence badge), an
  // optional one-line assistant note (R8), then a TWO-COLUMN grid - "Maps to field" (the
  // catalog select + authoritative checkbox) and "Format rule" (the required-rule select +
  // one example + "more examples"). Columns stack on narrow widths; no table, no in-card
  // horizontal scroll (FM2). Used for needs-attention columns; leads the page.
  function fullCard(column: SampleColumn) {
    const ov = overrideFor(column)
    const band = confidenceBand(column.confidence)
    return (
      <Card key={column.source_col}>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="font-mono text-sm text-foreground">{column.source_col}</span>
              <div className="text-caption text-muted-foreground">
                {column.inferred_type} · {Math.round(column.null_pct * 100)}% null · sample:{' '}
                {column.sample_values.join(', ')}
              </div>
            </div>
            <StatusBadge tone={band.tone}>
              {Math.round(column.confidence * 100)}% {band.text}
            </StatusBadge>
          </div>

          {/* The assistant's explanation, when provided (R8); optional, never fabricated. */}
          {column.reasoning != null && column.reasoning.length > 0 ? (
            <div className="text-caption font-normal text-muted-foreground italic">
              Assistant: {column.reasoning}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-label text-muted-foreground">Maps to field</span>
              <div className="flex flex-wrap items-center gap-3">
                {canonicalSelect(column, ov)}
                {authoritativeToggle(column, ov)}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-label text-muted-foreground">Format rule</span>
              {renderFormatRules(column)}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // A condensed row (T8): a compact ONE-LINE row for an auto-mapped column with nothing
  // outstanding - check icon, mono column, arrow, target field, "no rule needed", confidence,
  // and a small "change" control that expands to reveal the canonical select (and the
  // authoritative toggle) so no control is permanently hidden. No tall card.
  function condensedCard(column: SampleColumn) {
    const ov = overrideFor(column)
    const band = confidenceBand(column.confidence)
    const target = catalogByKey.get(ov.proposed_canonical)
    const editing = editingField[column.source_col] ?? false
    return (
      <div
        key={column.source_col}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border px-3 py-2"
      >
        <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
        <span className="font-mono text-xs text-muted-foreground">{column.source_col}</span>
        <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">
          {target ? target.display_name : ov.proposed_canonical}
        </span>
        <span className="text-caption text-muted-foreground">No rule needed</span>
        <StatusBadge tone={band.tone}>
          {Math.round(column.confidence * 100)}% {band.text}
        </StatusBadge>
        <button
          type="button"
          aria-label={`Change mapping for ${column.source_col}`}
          aria-expanded={editing}
          onClick={() => setEditingField((prev) => ({ ...prev, [column.source_col]: !editing }))}
          className="ml-auto text-caption text-primary hover:underline"
        >
          {editing ? 'Done' : 'Change'}
        </button>
        {editing ? (
          <div className="flex w-full flex-wrap items-center gap-3 pt-1">
            {canonicalSelect(column, ov)}
            {authoritativeToggle(column, ov)}
          </div>
        ) : null}
      </div>
    )
  }

  // The FORMAT-RULES half (T3): a mandatory, never-inferred locale declaration whose shape
  // is driven by the mapped field's datatype, each choice carrying a visible example. Feeds
  // the real mapping_rules.normalize {op, args}. Text/other datatypes need no locale rule.
  function renderFormatRules(column: SampleColumn) {
    const kind = ruleKindFor(column)
    const decl = localeRules[column.source_col]
    const col = column.source_col
    if (kind === null) {
      return <span className="text-caption text-muted-foreground">No locale rule needed</span>
    }
    const complete = isRuleComplete(kind, decl)
    // One example (T8): the selected choice's example, defaulting to the first when undeclared;
    // "more examples" reveals the full set. Collapsed by default, so the card stays compact.
    const choices: { value: string; label: string; example: string }[] =
      kind === 'decimal' ? DECIMAL_CHOICES : DATE_FORMAT_CHOICES
    const selectedValue = kind === 'decimal' ? decl?.decimal_separator : decl?.format
    const oneExample = (choices.find((c) => c.value === selectedValue) ?? choices[0]).example
    const expanded = showAllExamples[col] ?? false
    return (
      <div className="flex flex-col gap-1">
        {kind === 'decimal' ? (
          <>
            <Select
              aria-label={`Decimal separator for ${col}`}
              value={decl?.decimal_separator ?? ''}
              onChange={(e) => setLocale(col, { decimal_separator: e.target.value })}
              className="h-7 w-auto"
            >
              <option value="">Declare separator...</option>
              {DECIMAL_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label={`Thousands separator for ${col}`}
              value={decl?.thousands_separator ?? ''}
              onChange={(e) => setLocale(col, { thousands_separator: e.target.value })}
              className="h-7 w-auto"
            >
              {THOUSANDS_CHOICES.map((c) => (
                <option key={c.label} value={c.value}>
                  Thousands: {c.label}
                </option>
              ))}
            </Select>
          </>
        ) : (
          <>
            <Select
              aria-label={`Date format for ${col}`}
              value={decl?.format ?? ''}
              onChange={(e) => setLocale(col, { format: e.target.value })}
              className="h-7 w-auto"
            >
              <option value="">Declare format...</option>
              {DATE_FORMAT_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
            {kind === 'datetime' ? (
              <Select
                aria-label={`Timezone for ${col}`}
                value={decl?.timezone ?? ''}
                onChange={(e) => setLocale(col, { timezone: e.target.value })}
                className="h-7 w-auto"
              >
                <option value="">Declare timezone...</option>
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            ) : null}
          </>
        )}

        {/* One example by default; "more examples" reveals the rest. */}
        <div className="text-caption text-muted-foreground">
          {expanded ? (
            choices.map((c) => <div key={c.value}>{c.example}</div>)
          ) : (
            <div>{oneExample}</div>
          )}
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setShowAllExamples((prev) => ({ ...prev, [col]: !expanded }))}
          className="self-start text-caption text-primary hover:underline"
        >
          {expanded ? 'Fewer examples' : 'More examples'}
        </button>

        {!complete ? (
          <span className="text-caption text-danger">Required before preview</span>
        ) : null}
      </div>
    )
  }

  const attention = analysis.columns.filter((c) => needsAttention(c))
  const autoMapped = analysis.columns.filter((c) => !needsAttention(c))

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-display">
            {step === 'review' ? 'Review mapping' : step === 'preview' ? 'Preview' : 'Go live'}
          </h1>
          <p className="text-caption text-muted-foreground">
            {step === 'review'
              ? 'We mapped your columns to the canonical schema. Verify the ones we are unsure about.'
              : step === 'preview'
                ? 'Dry-run canonical rows produced by your approved mapping.'
                : 'Your mapping is approved.'}
          </p>
        </div>
        {/* Honest source label (FM4): AI when the server's suggestions are LLM-derived, basic
            name matching otherwise. Fallback carries no reasoning, so no AI prose is shown. */}
        {step === 'review' ? (
          analysis.source === 'llm' ? (
            <StatusBadge tone="info">Suggestions: AI</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">Suggestions: basic match</StatusBadge>
          )
        ) : null}
      </header>

      <ProgressRail steps={[...CSV_JOURNEY_STEPS]} current={currentIndex} />

      <DemoDataBanner />

      {actionError !== null ? (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      ) : null}

      {step === 'review' ? (
        <>
          {/* Sample data preview (T11): the first rows from the real client-side parse, so the
              operator sees actual data behind the columns. Bounded to 10 rows; row_count is the
              true total. No in-card horizontal scroll beyond the table's own overflow guard. */}
          {analysis.sample_rows.length > 0 ? (
            <Card>
              <CardContent>
                <h2 className="text-subheading mb-1">Sample data</h2>
                <p className="text-caption text-muted-foreground mb-2">
                  First {analysis.sample_rows.length} of {analysis.row_count} rows.
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {analysis.columns.map((c) => (
                          <TableHead key={c.source_col} className="font-mono text-xs">
                            {c.source_col}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analysis.sample_rows.map((row, index) => (
                        <TableRow key={index}>
                          {analysis.columns.map((c) => (
                            <TableCell key={c.source_col} className="text-muted-foreground">
                              {row[c.source_col] ?? ''}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Needs your review: full cards, leading the page (low-confidence or a required
              locale rule outstanding). Each is the two stacked concerns (field + format). */}
          {attention.length > 0 ? (
            <div className="flex flex-col gap-2">
              <div>
                <h2 className="text-subheading">Needs your review ({attention.length})</h2>
                <p className="text-caption text-muted-foreground">
                  Confirm or correct the canonical target, and declare any required format rule.
                </p>
              </div>
              {attention.map((column) => fullCard(column))}
            </div>
          ) : null}

          {/* Auto-mapped: condensed one-line cards (high-confidence, nothing outstanding). */}
          {autoMapped.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h2 className="text-subheading text-muted-foreground">
                Auto-mapped ({autoMapped.length})
              </h2>
              {autoMapped.map((column) => condensedCard(column))}
            </div>
          ) : null}

          {/* FM2: required locale rules must be declared (never inferred) before preview. */}
          {!allRulesDeclared ? (
            <p role="alert" className="text-caption text-danger">
              Declare the required format rule for:{' '}
              {undeclaredColumns.map((c) => c.source_col).join(', ')}.
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate('/upload')}>
              Back
            </Button>
            <Button type="button" disabled={!allRulesDeclared} onClick={() => continueToPreview()}>
              Continue to preview
            </Button>
          </div>
        </>
      ) : null}

      {step === 'preview' && dryRun !== null ? (
        <>
          <Card>
            <CardContent>
              <div className="overflow-x-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {Object.keys(dryRun.rows[0] ?? {}).map((key) => (
                        <TableHead key={key}>{key}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dryRun.rows.map((row, index) => (
                      <TableRow key={index}>
                        {Object.values(row).map((value, cell) => (
                          <TableCell key={cell}>{String(value)}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          <div className="flex gap-3">
            <Button type="button" variant="ghost" onClick={() => setStep('review')}>
              Back
            </Button>
            <Button type="button" onClick={() => void goLive()}>
              Go live
            </Button>
          </div>
        </>
      ) : null}

      {step === 'golive' && created !== null
        ? (() => {
            const version = created.active_version ?? created.latest_version
            return (
              <Card>
                <CardContent className="flex flex-col gap-3">
                  {/* Create-as-ACTIVE (D88): live in one step, no draft/activate ceremony. */}
                  <p role="status" className="text-body-strong text-success">
                    Created and live: {created.template_name} v{version} for {created.source_id}.
                  </p>
                  <p className="text-caption text-muted-foreground">
                    New files for this source are now processed through this mapping.
                  </p>

                  <div className="flex items-center gap-2">
                    <span className="text-label text-muted-foreground">Lifecycle</span>
                    <StatusBadge tone="success">active</StatusBadge>
                  </div>

                  <div>
                    <Link
                      to={`/sources/${created.source_id}/templates/${created.template_id}`}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      View template
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )
          })()
        : null}
    </section>
  )
}
