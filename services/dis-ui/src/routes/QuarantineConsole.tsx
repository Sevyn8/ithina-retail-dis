import { useMemo, useState } from 'react'

import { useAuth } from '../auth/useAuth'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import {
  CHAIN_DEPTH_CAP,
  useQuarantine,
  useQuarantineRow,
  useResubmit,
} from '../lib/dis-ui-server/quarantine'
import type { FailureStage, QuarantineStatus, ResubmitType } from '../lib/dis-ui-server/quarantine'

type TimeWindow = 'all' | '24h' | '7d' | '30d'

const WINDOW_MS: Record<Exclude<TimeWindow, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

function withinWindow(failedAt: string, window: TimeWindow): boolean {
  if (window === 'all') {
    return true
  }
  return Date.now() - new Date(failedAt).getTime() <= WINDOW_MS[window]
}

// Quarantine Console (surface map screen 7), TENANT slice only. Failed-row list
// (demand list 4.1) with filters + a per-row detail (4.2). The detail offers the
// Resubmit action (4.3): a confirm with a resubmit_type choice (replay / fixed_file)
// that posts via the fixture client; a row already at the chain-depth cap (arch 6.5)
// shows the action disabled with the reason. No ops cross-tenant view, no tenant_id
// filter (FM2); resolve / Ithina-side replay are omitted (ops only, scope P).
export function QuarantineConsole() {
  const { snapshot } = useAuth()
  const list = useQuarantine(snapshot)

  const [source, setSource] = useState('all')
  const [stage, setStage] = useState<FailureStage | 'all'>('all')
  const [status, setStatus] = useState<QuarantineStatus | 'all'>('all')
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('all')
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [resubmitType, setResubmitType] = useState<ResubmitType>('replay')
  const resubmit = useResubmit()

  // Select a row's detail and reset any in-progress resubmit confirm.
  function selectTrace(traceId: string) {
    setSelectedTraceId(traceId)
    setConfirming(false)
  }

  const rows = useMemo(() => list.data ?? [], [list.data])
  const sources = useMemo(() => [...new Set(rows.map((r) => r.source))], [rows])

  const filtered = rows.filter(
    (r) =>
      (source === 'all' || r.source === source) &&
      (stage === 'all' || r.failure_stage === stage) &&
      (status === 'all' || r.status === status) &&
      withinWindow(r.failed_at, timeWindow),
  )

  const detail = useQuarantineRow(selectedTraceId)

  if (list.isPending) {
    return <LoadingState label="Loading quarantine..." />
  }
  if (list.isError) {
    return <ErrorState message="Could not load quarantined rows." onRetry={() => void list.refetch()} />
  }
  if (rows.length === 0) {
    return <EmptyState title="No quarantined rows" message="Nothing has been quarantined for this tenant." />
  }

  const openCount = rows.filter((r) => r.status === 'open').length

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Quarantine</h1>
        <span className="text-sm text-gray-500">{openCount} open</span>
      </div>

      <div className="mb-3 flex flex-wrap gap-3 text-sm">
        <label>
          Source{' '}
          <select aria-label="Source filter" value={source} onChange={(e) => setSource(e.target.value)} className="rounded border px-1 py-0.5">
            <option value="all">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Error type{' '}
          <select
            aria-label="Error type filter"
            value={stage}
            onChange={(e) => setStage(e.target.value as FailureStage | 'all')}
            className="rounded border px-1 py-0.5"
          >
            <option value="all">All errors</option>
            <option value="source-shape">source-shape</option>
            <option value="canonical-shape">canonical-shape</option>
            <option value="fk">fk</option>
            <option value="normalization">normalization</option>
          </select>
        </label>
        <label>
          Status{' '}
          <select
            aria-label="Status filter"
            value={status}
            onChange={(e) => setStatus(e.target.value as QuarantineStatus | 'all')}
            className="rounded border px-1 py-0.5"
          >
            <option value="all">All</option>
            <option value="open">open</option>
            <option value="resolved">resolved</option>
          </select>
        </label>
        <label>
          Time{' '}
          <select
            aria-label="Time range filter"
            value={timeWindow}
            onChange={(e) => setTimeWindow(e.target.value as TimeWindow)}
            className="rounded border px-1 py-0.5"
          >
            <option value="all">All time</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No matching rows" message="No quarantined rows match the current filters." />
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-1">Time</th>
              <th>Source</th>
              <th>Error</th>
              <th>Stage</th>
              <th>Trace</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.trace_id} className="border-b">
                <td className="py-1">{row.failed_at}</td>
                <td>{row.source}</td>
                <td>{row.error_reason}</td>
                <td>{row.failure_stage}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => selectTrace(row.trace_id)}
                    className="underline"
                  >
                    {row.trace_id}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedTraceId !== null ? (
        <div className="mt-4 rounded border p-3">
          <h2 className="text-sm font-semibold">Row detail</h2>
          {detail.isPending ? (
            <LoadingState label="Loading detail..." />
          ) : detail.isError || detail.data === undefined ? (
            <ErrorState message="Could not load row detail." />
          ) : (
            <div className="text-sm">
              <p>
                Trace: {detail.data.trace_id} · {detail.data.source} · {detail.data.failed_at} · v
                {detail.data.mapping_version}
              </p>
              <p>Error: {detail.data.error_reason}</p>
              <p>Stage: {detail.data.failure_stage}</p>
              <p>Context: {detail.data.error_context}</p>
              <p className="mt-2 font-medium">Original payload:</p>
              <pre className="mt-1 overflow-x-auto rounded bg-gray-100 p-2 text-xs">
                {JSON.stringify(detail.data.original_payload, null, 2)}
              </pre>

              <p className="mt-2">Chain depth: {detail.data.chain_depth}</p>
              {detail.data.resubmits.length > 0 ? (
                <p className="text-xs text-gray-600">
                  Resubmitted (latest child trace:{' '}
                  {detail.data.resubmits[detail.data.resubmits.length - 1].child_trace_id})
                </p>
              ) : null}

              {detail.data.chain_depth >= CHAIN_DEPTH_CAP ? (
                <div className="mt-3">
                  <button type="button" disabled className="rounded border px-3 py-1 text-gray-400">
                    Resubmit
                  </button>
                  <p className="mt-1 text-xs text-gray-600">
                    Chain depth {CHAIN_DEPTH_CAP} reached; further retries are an ops escalation
                    (architecture 6.5).
                  </p>
                </div>
              ) : confirming ? (
                <div className="mt-3 rounded border p-3">
                  <p className="text-sm font-medium">Resubmit this row?</p>
                  <fieldset className="mt-2 text-sm">
                    <legend className="sr-only">Resubmit type</legend>
                    <label className="block">
                      <input
                        type="radio"
                        name="resubmit_type"
                        value="replay"
                        checked={resubmitType === 'replay'}
                        onChange={() => setResubmitType('replay')}
                      />{' '}
                      Retry as-is (replay)
                    </label>
                    <label className="block">
                      <input
                        type="radio"
                        name="resubmit_type"
                        value="fixed_file"
                        checked={resubmitType === 'fixed_file'}
                        onChange={() => setResubmitType('fixed_file')}
                      />{' '}
                      Corrected file (fixed_file)
                    </label>
                  </fieldset>
                  <div className="mt-2 flex gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        resubmit.mutate(
                          { resubmit_type: resubmitType, parent_trace_id: detail.data.trace_id },
                          { onSuccess: () => setConfirming(false) },
                        )
                      }
                      disabled={resubmit.isPending}
                      className="rounded border px-3 py-1"
                    >
                      Confirm resubmit
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className="rounded border px-3 py-1"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="rounded border px-3 py-1"
                  >
                    Resubmit
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
