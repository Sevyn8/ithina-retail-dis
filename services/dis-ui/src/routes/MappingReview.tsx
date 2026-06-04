import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { OnboardingStepper } from '../components/OnboardingStepper'
import { StatusBadge } from '../components/StatusBadge'
import type { StatusTone } from '../components/StatusBadge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  CANONICAL_COLUMNS,
  approveSample,
  dryRunSample,
  patchSampleMapping,
  useSample,
} from '../lib/dis-ui-server/onboarding'
import type { ApproveResult, DryRunResult, SampleColumn } from '../lib/dis-ui-server/onboarding'

type Override = { proposed_canonical: string; authoritative: boolean }

function confidenceBand(confidence: number): { text: string; tone: StatusTone } {
  if (confidence >= 0.7) {
    return { text: 'OK', tone: 'success' }
  }
  if (confidence >= 0.5) {
    return { text: 'Low confidence', tone: 'warning' }
  }
  return { text: 'Very low confidence', tone: 'danger' }
}

// Mapping Review (surface map screen 4, onboarding step 2), on the design-system craft
// bar. Renders the inferred per-column mapping (carded table, confidence as a semantic
// badge), supports overrides + authoritative toggles, dry-run preview, and
// approve-to-staged. Behavior is unchanged; only the composition is rebuilt.
export function MappingReview() {
  const { sampleId } = useParams()
  const navigate = useNavigate()
  const sample = useSample(sampleId ?? null)

  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)
  const [approved, setApproved] = useState<ApproveResult | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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

  async function runDryRun(): Promise<void> {
    setActionError(null)
    try {
      setDryRun(await dryRunSample(sampleId as string))
    } catch {
      setActionError('Dry-run failed.')
    }
  }

  async function approve(): Promise<void> {
    setActionError(null)
    try {
      setApproved(await approveSample(sampleId as string))
    } catch {
      setActionError('Approve failed.')
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-display">Mapping Review</h1>
        <p className="text-caption text-muted-foreground">Review the proposed mapping.</p>
      </header>

      <OnboardingStepper active="Review" />

      <Card>
        <CardContent>
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
            <TableBody>
              {analysis.columns.map((column) => {
                const ov = overrideFor(column)
                const band = confidenceBand(column.confidence)
                return (
                  <TableRow key={column.source_col} className="align-top">
                    <TableCell className="font-medium text-foreground">
                      {column.source_col}
                      <div className="text-caption font-normal text-muted-foreground">
                        sample: {column.sample_values.join(', ')}
                      </div>
                    </TableCell>
                    <TableCell>{column.inferred_type}</TableCell>
                    <TableCell>{Math.round(column.null_pct * 100)}%</TableCell>
                    <TableCell>
                      <Select
                        aria-label={`Canonical for ${column.source_col}`}
                        value={ov.proposed_canonical}
                        onChange={(e) =>
                          setOverride(column.source_col, { ...ov, proposed_canonical: e.target.value })
                        }
                        className="h-7 w-auto"
                      >
                        {CANONICAL_COLUMNS.map((canonical) => (
                          <option key={canonical} value={canonical}>
                            {canonical}
                          </option>
                        ))}
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
                        onChange={(e) =>
                          setOverride(column.source_col, { ...ov, authoritative: e.target.checked })
                        }
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {actionError !== null ? (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      ) : null}

      {approved !== null ? (
        <p role="status" className="text-sm text-success">
          Mapping approved to staged (version {approved.mapping_version}) for {approved.source_id}.
        </p>
      ) : null}

      {dryRun !== null ? (
        <div>
          <h2 className="text-heading mb-1">Dry-run preview</h2>
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
        </div>
      ) : null}

      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={() => void runDryRun()}>
          Dry-run preview
        </Button>
        <Button type="button" variant="ghost" onClick={() => navigate('/upload')}>
          Back
        </Button>
        <Button type="button" onClick={() => void approve()}>
          Approve to staged
        </Button>
      </div>
    </section>
  )
}
