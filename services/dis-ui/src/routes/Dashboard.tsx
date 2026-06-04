import { Link } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import type { StatusTone } from '../components/StatusBadge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SOURCE_IDENTITIES, sourceIdentity } from '../components/source-identity'
import type { SourceTypeKey } from '../components/source-identity'
import { useDashboardSummary } from '../lib/dis-ui-server/dashboard'
import type { DashboardSource, SourceHealth } from '../lib/dis-ui-server/dashboard'
import { cn } from '@/lib/utils'

function healthTone(health: SourceHealth): StatusTone {
  if (health === 'healthy') {
    return 'success'
  }
  if (health === 'warning') {
    return 'warning'
  }
  return 'danger'
}

// Tenant Dashboard (surface map screen 1), at `/`, on the redesign visual language. The
// analytical overview (redesign R6): top-line metric cards, a "where your data comes from"
// source-type breakdown (connected types with their identity + volume from the rollup;
// not-connected types as dimmed roadmap rows), and the actionable health-by-source rows
// (the slice 28 deep links, matched on source_id, preserved). All figures come from the
// existing dashboard/summary rollup; no live metrics are invented. Tenant-scoped, read-only.
export function Dashboard() {
  const { snapshot } = useAuth()
  const summary = useDashboardSummary(snapshot)

  if (summary.isPending) {
    return <LoadingState label="Loading dashboard..." />
  }
  if (summary.isError) {
    return <ErrorState message="Could not load the dashboard." onRetry={() => void summary.refetch()} />
  }
  if (summary.data === null || summary.data.sources.length === 0) {
    return <EmptyState title="No dashboard data" message="Nothing has been ingested for this tenant yet." />
  }

  const { sources, latency_1h } = summary.data

  // Metric-card figures, all from the rollup (no invented metrics).
  const rowsIngested = sources.reduce((sum, s) => sum + s.rows_24h, 0)
  const inQuarantine = sources.reduce((sum, s) => sum + s.quarantined_open, 0)
  const connectedTypes = new Set(sources.map((s) => s.source_type))
  const totalTypes = Object.keys(SOURCE_IDENTITIES).length

  const metrics: { label: string; value: string }[] = [
    { label: 'Rows ingested (24h)', value: rowsIngested.toLocaleString() },
    { label: 'Active sources', value: `${connectedTypes.size} of ${totalTypes} types` },
    { label: 'In quarantine', value: inQuarantine.toLocaleString() },
    { label: 'P95 latency', value: `${latency_1h.p95_ms} ms` },
  ]

  // "Where your data comes from": connected types (volume summed from the rollup) and the
  // not-yet-connected types (no rollup data) shown as dimmed roadmap rows.
  const volumeByType = new Map<string, number>()
  for (const s of sources) {
    volumeByType.set(s.source_type, (volumeByType.get(s.source_type) ?? 0) + s.rows_24h)
  }
  const connected = [...volumeByType.entries()].map(([type, volume]) => ({
    identity: sourceIdentity(type),
    volume,
  }))
  const roadmap = (Object.keys(SOURCE_IDENTITIES) as SourceTypeKey[])
    .filter((key) => !connectedTypes.has(key))
    .map((key) => SOURCE_IDENTITIES[key])

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-display">Dashboard</h1>
        <p className="text-caption text-muted-foreground">Is your data flowing right now?</p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardContent>
              <div className="text-label text-muted-foreground">{metric.label}</div>
              <div className="text-display-lg">{metric.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Where your data comes from</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {connected.map(({ identity, volume }) => {
            const Icon = identity.icon
            return (
              <div key={identity.key} className="flex items-center gap-3 rounded-md border border-border p-3">
                <span
                  aria-hidden="true"
                  className={cn('flex size-8 items-center justify-center rounded-lg', identity.bgSoftClass, identity.textClass)}
                >
                  <Icon className="size-4" />
                </span>
                <span className="text-body-strong">{identity.label}</span>
                <span className="ml-auto text-body tabular-nums text-muted-foreground">
                  {volume.toLocaleString()} rows (24h)
                </span>
              </div>
            )
          })}
          {roadmap.map((identity) => {
            const Icon = identity.icon
            return (
              <div
                key={identity.key}
                className="flex items-center gap-3 rounded-md border border-dashed border-border p-3 opacity-60"
              >
                <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="text-body-strong text-muted-foreground">{identity.label}</span>
                <span className="ml-auto text-caption text-muted-foreground">Not connected</span>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Health by source</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Rows (24h)</TableHead>
                <TableHead>Quarantined open</TableHead>
                <TableHead>Last ok</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((source) => (
                <DashboardRow key={source.source_id} source={source} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  )
}

function DashboardRow({ source }: { source: DashboardSource }) {
  const identity = sourceIdentity(source.source_type)
  const Icon = identity.icon
  return (
    <TableRow>
      <TableCell className="font-medium text-foreground">
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn('flex size-6 items-center justify-center rounded-md', identity.bgSoftClass, identity.textClass)}
          >
            <Icon className="size-3.5" />
          </span>
          {/* Source name links to this source's mappings, keyed by source_id (slice 28). */}
          <Link
            to={`/sources/${source.source_id}/mappings`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {source.name}
          </Link>
        </span>
      </TableCell>
      <TableCell>
        <StatusBadge tone={healthTone(source.health)}>{source.health}</StatusBadge>
      </TableCell>
      <TableCell>{source.rows_24h.toLocaleString()}</TableCell>
      <TableCell>
        {/* Open-quarantine count links to the pre-filtered Quarantine console (by source_id)
            when there is anything open; plain text at 0 (slice 28). */}
        {source.quarantined_open > 0 ? (
          <Link
            to={`/quarantine?source=${source.source_id}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {source.quarantined_open}
          </Link>
        ) : (
          source.quarantined_open
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{source.last_ok_at}</TableCell>
    </TableRow>
  )
}
