import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { ProgressRail } from '@/components/ui/progress-rail'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { DemoDataBanner } from '../components/DemoDataBanner'
import { StatusBadge } from '../components/StatusBadge'
import type { StatusTone } from '../components/StatusBadge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  approveSample,
  dryRunSample,
  patchSampleMapping,
  useSample,
} from '../lib/dis-ui-server/onboarding'
import type { ApproveResult, DryRunResult, SampleColumn } from '../lib/dis-ui-server/onboarding'
import { useTemplateMappingFields } from '../lib/dis-ui-server/mapping-fields'
import type { FieldSection, TemplateMappingField } from '../lib/dis-ui-server/mapping-fields'
import { CSV_JOURNEY_STEPS, CSV_JOURNEY_STEP_INDEX } from './csv-journey'

type Override = { proposed_canonical: string; authoritative: boolean }

// The three sub-steps the review route runs behind the shared journey rail.
type JourneyStep = 'review' | 'preview' | 'golive'

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
  const navigate = useNavigate()
  const sample = useSample(sampleId ?? null)
  // Canonical mapping targets now come from the real template-mapping-fields catalog
  // (T1), not a hardcoded list. Section-grouped, with mandatory/datatype metadata.
  const fields = useTemplateMappingFields()

  const [step, setStep] = useState<JourneyStep>('review')
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)
  const [approved, setApproved] = useState<ApproveResult | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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
  if (sample.isError || sample.data === undefined) {
    return <ErrorState message="Could not load the sample analysis." />
  }

  const analysis = sample.data

  function overrideFor(column: SampleColumn): Override {
    return overrides[column.source_col] ?? { proposed_canonical: column.proposed_canonical, authoritative: false }
  }

  function setOverride(sourceCol: string, next: Override): void {
    setOverrides((prev) => ({ ...prev, [sourceCol]: next }))
    void patchSampleMapping(sampleId as string, {
      source_col: sourceCol,
      proposed_canonical: next.proposed_canonical,
      authoritative: next.authoritative,
    })
  }

  async function continueToPreview(): Promise<void> {
    setActionError(null)
    try {
      setDryRun(await dryRunSample(sampleId as string))
      setStep('preview')
    } catch {
      setActionError('Dry-run failed.')
    }
  }

  async function goLive(): Promise<void> {
    setActionError(null)
    try {
      setApproved(await approveSample(sampleId as string))
      setStep('golive')
    } catch {
      setActionError('Approve failed.')
    }
  }

  const currentIndex =
    step === 'review'
      ? CSV_JOURNEY_STEP_INDEX.review
      : step === 'preview'
        ? CSV_JOURNEY_STEP_INDEX.preview
        : CSV_JOURNEY_STEP_INDEX.golive

  const highConfidence = analysis.columns.filter((c) => c.confidence >= HIGH_CONFIDENCE)
  const needsReview = analysis.columns.filter((c) => c.confidence < HIGH_CONFIDENCE)

  function mappingRow(column: SampleColumn) {
    const ov = overrideFor(column)
    const band = confidenceBand(column.confidence)
    return (
      <TableRow key={column.source_col} className="align-top">
        <TableCell className="font-medium text-foreground">
          {column.source_col}
          <div className="text-caption font-normal text-muted-foreground">
            sample: {column.sample_values.join(', ')}
          </div>
          {/* The assistant's explanation, when provided. Optional and never fabricated: a
              column without reasoning shows nothing here (graceful). */}
          {column.reasoning != null && column.reasoning.length > 0 ? (
            <div className="text-caption font-normal text-muted-foreground italic">
              Assistant: {column.reasoning}
            </div>
          ) : null}
        </TableCell>
        <TableCell>{column.inferred_type}</TableCell>
        <TableCell>{Math.round(column.null_pct * 100)}%</TableCell>
        <TableCell>
          <Select
            aria-label={`Canonical for ${column.source_col}`}
            value={ov.proposed_canonical}
            onChange={(e) => setOverride(column.source_col, { ...ov, proposed_canonical: e.target.value })}
            className="h-7 w-auto"
          >
            {/* The assistant's other candidates as quick-picks, above the full list. Optional:
                absent -> just the full canonical list (today's behavior). Selecting either
                calls the same setOverride (the existing override path). */}
            {column.alternatives && column.alternatives.length > 0 ? (
              <optgroup label="Assistant's alternatives">
                {column.alternatives.map((alt) => (
                  <option key={`alt-${alt.target}`} value={alt.target}>
                    {alt.target} ({Math.round(alt.confidence * 100)}%)
                  </option>
                ))}
              </optgroup>
            ) : null}
            {renderCanonicalGroups()}
          </Select>
        </TableCell>
        <TableCell>
          <StatusBadge tone={band.tone}>
            {Math.round(column.confidence * 100)}% {band.text}
          </StatusBadge>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {column.transforms.length === 0
            ? '-'
            : column.transforms.map((t) => `${t.type}: ${t.value}`).join(', ')}
        </TableCell>
        <TableCell>
          <input
            type="checkbox"
            aria-label={`Authoritative for ${column.source_col}`}
            checked={ov.authoritative}
            onChange={(e) => setOverride(column.source_col, { ...ov, authoritative: e.target.checked })}
          />
        </TableCell>
      </TableRow>
    )
  }

  function mappingTable(columns: SampleColumn[]) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source column</TableHead>
            <TableHead>Inferred type</TableHead>
            <TableHead>Null %</TableHead>
            <TableHead>Canonical</TableHead>
            <TableHead>Confidence</TableHead>
            <TableHead>Mapping rules</TableHead>
            <TableHead>Authoritative</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{columns.map((column) => mappingRow(column))}</TableBody>
      </Table>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <header>
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
          {needsReview.length > 0 ? (
            <Card>
              <CardHeader>
                <h2 className="text-subheading">Needs your review</h2>
                <p className="text-caption text-muted-foreground">
                  {needsReview.length} column{needsReview.length === 1 ? '' : 's'} we are not confident
                  about. Confirm or correct the canonical target.
                </p>
              </CardHeader>
              <CardContent>{mappingTable(needsReview)}</CardContent>
            </Card>
          ) : null}

          {highConfidence.length > 0 ? (
            <Card>
              <CardHeader>
                <h2 className="text-subheading text-muted-foreground">Auto-mapped</h2>
                <p className="text-caption text-muted-foreground">
                  {highConfidence.length} high-confidence column{highConfidence.length === 1 ? '' : 's'}.
                  Edit if you need to.
                </p>
              </CardHeader>
              <CardContent>{mappingTable(highConfidence)}</CardContent>
            </Card>
          ) : null}

          <div className="flex gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate('/upload')}>
              Back
            </Button>
            <Button type="button" onClick={() => void continueToPreview()}>
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

      {step === 'golive' && approved !== null ? (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <p role="status" className="text-body-strong text-success">
              Mapping approved to staged (version {approved.mapping_version}) for {approved.source_id}.
            </p>
            <p className="text-caption text-muted-foreground">
              Future files for this source flow through this mapping once it is promoted to active.
            </p>
            <div>
              <Link
                to={`/sources/${approved.source_id}/mappings`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                View source mappings
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
