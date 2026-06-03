import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import {
  approveSample,
  dryRunSample,
  patchSampleMapping,
  useSample,
} from '../lib/dis-ui-server/onboarding'
import type { ApproveResult, DryRunResult, SampleColumn } from '../lib/dis-ui-server/onboarding'

// PROVISIONAL canonical-column vocabulary for the override dropdown. The demand
// list does not define the canonical column set; this is a flagged placeholder.
const CANONICAL_COLUMNS = ['sku_id', 'quantity', 'event_ts', 'store_id', 'price', 'sku_description']

type Override = { proposed_canonical: string; authoritative: boolean }

function confidenceLabel(confidence: number): { text: string; className: string } {
  if (confidence >= 0.7) {
    return { text: 'OK', className: 'text-green-700' }
  }
  if (confidence >= 0.5) {
    return { text: 'Low confidence', className: 'text-yellow-700' }
  }
  return { text: 'Very low confidence', className: 'text-red-700' }
}

// Mapping Review (surface map screen 4, onboarding step 2). Renders the inferred
// per-column mapping, supports overrides + authoritative toggles, dry-run preview,
// and approve-to-staged. Read-only enrichment beyond this is later phases.
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
    <section>
      <h1 className="text-xl font-semibold">Mapping Review</h1>
      <p className="mb-4 text-sm text-gray-500">Step 2 of 3: review the proposed mapping.</p>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-1">Source column</th>
            <th>Inferred type</th>
            <th>Null %</th>
            <th>Canonical</th>
            <th>Confidence</th>
            <th>Transforms</th>
            <th>Authoritative</th>
          </tr>
        </thead>
        <tbody>
          {analysis.columns.map((column) => {
            const ov = overrideFor(column)
            const conf = confidenceLabel(column.confidence)
            return (
              <tr key={column.source_col} className="border-b align-top">
                <td className="py-1">
                  {column.source_col}
                  <div className="text-xs text-gray-500">sample: {column.sample_values.join(', ')}</div>
                </td>
                <td>{column.inferred_type}</td>
                <td>{Math.round(column.null_pct * 100)}%</td>
                <td>
                  <select
                    aria-label={`Canonical for ${column.source_col}`}
                    value={ov.proposed_canonical}
                    onChange={(e) =>
                      setOverride(column.source_col, { ...ov, proposed_canonical: e.target.value })
                    }
                    className="rounded border px-1 py-0.5"
                  >
                    {CANONICAL_COLUMNS.map((canonical) => (
                      <option key={canonical} value={canonical}>
                        {canonical}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={conf.className}>
                  {Math.round(column.confidence * 100)}% {conf.text}
                </td>
                <td>
                  {column.transforms.length === 0
                    ? '-'
                    : column.transforms.map((t) => `${t.type}: ${t.value}`).join(', ')}
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Authoritative for ${column.source_col}`}
                    checked={ov.authoritative}
                    onChange={(e) =>
                      setOverride(column.source_col, { ...ov, authoritative: e.target.checked })
                    }
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {actionError !== null ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      {approved !== null ? (
        <p role="status" className="mt-3 text-sm text-green-700">
          Mapping approved to staged (version {approved.mapping_version}) for {approved.source_id}.
        </p>
      ) : null}

      {dryRun !== null ? (
        <div className="mt-4">
          <h2 className="text-sm font-semibold">Dry-run preview</h2>
          <table className="mt-1 w-full text-left text-xs">
            <thead>
              <tr className="border-b">
                {Object.keys(dryRun.rows[0] ?? {}).map((key) => (
                  <th key={key} className="py-1">
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dryRun.rows.map((row, index) => (
                <tr key={index} className="border-b">
                  {Object.values(row).map((value, cell) => (
                    <td key={cell}>{String(value)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-4 flex gap-3">
        <button type="button" onClick={() => void runDryRun()} className="rounded border px-3 py-1">
          Dry-run preview
        </button>
        <button type="button" onClick={() => navigate('/upload')} className="rounded border px-3 py-1">
          Back
        </button>
        <button type="button" onClick={() => void approve()} className="rounded border px-3 py-1">
          Approve to staged
        </button>
      </div>
    </section>
  )
}
