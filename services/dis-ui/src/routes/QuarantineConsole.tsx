import { useMemo, useState } from 'react'

import { useAuth } from '../auth/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CopyButton } from '../components/CopyButton'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
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

// Quarantine Console (surface map screen 7), TENANT slice only, on the design-system
// craft bar. Failed-row list (demand list 4.1) with filters + a per-row detail (4.2).
// The detail offers the Resubmit action (4.3) via a confirm Dialog with a resubmit_type
// choice (replay / fixed_file); a row already at the chain-depth cap (arch 6.5) shows
// the action disabled with the reason. No ops cross-tenant view, no tenant_id filter
// (FM2); resolve / Ithina-side replay are omitted (ops only, scope P). Behavior is
// unchanged; only the composition is rebuilt.
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
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-display">Quarantine</h1>
          <p className="text-caption text-muted-foreground">Failed rows and why they failed.</p>
        </div>
        <span className="text-caption text-muted-foreground">{openCount} open</span>
      </header>

      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-1">
          Source
          <Select aria-label="Source filter" value={source} onChange={(e) => setSource(e.target.value)} className="h-7 w-auto">
            <option value="all">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1">
          Error type
          <Select
            aria-label="Error type filter"
            value={stage}
            onChange={(e) => setStage(e.target.value as FailureStage | 'all')}
            className="h-7 w-auto"
          >
            <option value="all">All errors</option>
            <option value="source-shape">source-shape</option>
            <option value="canonical-shape">canonical-shape</option>
            <option value="fk">fk</option>
            <option value="normalization">normalization</option>
          </Select>
        </label>
        <label className="flex items-center gap-1">
          Status
          <Select
            aria-label="Status filter"
            value={status}
            onChange={(e) => setStatus(e.target.value as QuarantineStatus | 'all')}
            className="h-7 w-auto"
          >
            <option value="all">All</option>
            <option value="open">open</option>
            <option value="resolved">resolved</option>
          </Select>
        </label>
        <label className="flex items-center gap-1">
          Time
          <Select
            aria-label="Time range filter"
            value={timeWindow}
            onChange={(e) => setTimeWindow(e.target.value as TimeWindow)}
            className="h-7 w-auto"
          >
            <option value="all">All time</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </Select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No matching rows" message="No quarantined rows match the current filters." />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Trace</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.trace_id}>
                    <TableCell className="text-muted-foreground">{row.failed_at}</TableCell>
                    <TableCell>{row.source}</TableCell>
                    <TableCell>{row.error_reason}</TableCell>
                    <TableCell>
                      <StatusBadge tone="warning">{row.failure_stage}</StatusBadge>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => selectTrace(row.trace_id)}
                          className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                        >
                          {row.trace_id}
                        </button>
                        <CopyButton value={row.trace_id} label="Copy trace id" />
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {selectedTraceId !== null ? (
        <Card>
          <CardHeader>
            <h2 className="text-subheading">Row detail</h2>
          </CardHeader>
          <CardContent>
            {detail.isPending ? (
              <LoadingState label="Loading detail..." />
            ) : detail.isError || detail.data === undefined ? (
              <ErrorState message="Could not load row detail." />
            ) : (
              <div className="text-sm">
                <p className="font-mono text-caption text-muted-foreground">
                  Trace: {detail.data.trace_id} · {detail.data.source} · {detail.data.failed_at} · v
                  {detail.data.mapping_version}
                </p>
                <p className="mt-2">Error: {detail.data.error_reason}</p>
                <p>Stage: {detail.data.failure_stage}</p>
                <p>Context: {detail.data.error_context}</p>
                <p className="mt-2 text-label text-muted-foreground">Original payload</p>
                <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-muted/50 p-2 text-xs">
                  {JSON.stringify(detail.data.original_payload, null, 2)}
                </pre>

                <p className="mt-2">Chain depth: {detail.data.chain_depth}</p>
                {detail.data.resubmits.length > 0 ? (
                  <p className="text-caption text-muted-foreground">
                    Resubmitted (latest child trace:{' '}
                    {detail.data.resubmits[detail.data.resubmits.length - 1].child_trace_id})
                  </p>
                ) : null}

                {detail.data.chain_depth >= CHAIN_DEPTH_CAP ? (
                  <div className="mt-3">
                    <Button type="button" variant="outline" disabled>
                      Resubmit
                    </Button>
                    <p className="mt-1 text-caption text-muted-foreground">
                      Chain depth {CHAIN_DEPTH_CAP} reached; further retries are an ops escalation
                      (architecture 6.5).
                    </p>
                  </div>
                ) : (
                  <Dialog open={confirming} onOpenChange={setConfirming}>
                    <DialogTrigger render={<Button type="button" variant="outline" className="mt-3" />}>
                      Resubmit
                    </DialogTrigger>
                    <DialogContent showCloseButton={false}>
                      <DialogTitle>Resubmit this row?</DialogTitle>
                      <fieldset className="text-sm">
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
                      <div className="flex justify-end gap-3">
                        <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          disabled={resubmit.isPending}
                          onClick={() =>
                            resubmit.mutate(
                              { resubmit_type: resubmitType, parent_trace_id: detail.data.trace_id },
                              { onSuccess: () => setConfirming(false) },
                            )
                          }
                        >
                          Confirm resubmit
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
