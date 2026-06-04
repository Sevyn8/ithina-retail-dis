import { Link } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import type { StatusTone } from '../components/StatusBadge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useDashboardSummary } from '../lib/dis-ui-server/dashboard'
import type { SourceHealth } from '../lib/dis-ui-server/dashboard'

function healthTone(health: SourceHealth): StatusTone {
  if (health === 'healthy') {
    return 'success'
  }
  if (health === 'warning') {
    return 'warning'
  }
  return 'danger'
}

// Tenant Dashboard (surface map screen 1), at `/`, on the design-system craft bar.
// Reads dashboard/summary (demand list 1.2) and renders the per-source health rollup
// (carded table, health as semantic badge) + the latency snapshot (metric stat cards).
// Tenant-scoped; read-only. No notifications widget or action buttons (FM4: same data).
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
  const latency: { label: string; value: number }[] = [
    { label: 'p50', value: latency_1h.p50_ms },
    { label: 'p95', value: latency_1h.p95_ms },
    { label: 'p99', value: latency_1h.p99_ms },
  ]

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-display">Dashboard</h1>
        <p className="text-caption text-muted-foreground">Is your data flowing right now?</p>
      </header>

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
                <TableRow key={source.source_id}>
                  <TableCell className="font-medium text-foreground">
                    {/* Source name links to this source's mappings, keyed by source_id. */}
                    <Link
                      to={`/sources/${source.source_id}/mappings`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {source.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={healthTone(source.health)}>{source.health}</StatusBadge>
                  </TableCell>
                  <TableCell>{source.rows_24h.toLocaleString()}</TableCell>
                  <TableCell>
                    {/* Open-quarantine count links to the pre-filtered Quarantine console
                        (by source_id) when there is anything open; plain text at 0 (FM4). */}
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
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <section>
        <h2 className="text-label mb-2 text-muted-foreground">Latency last 1h</h2>
        <div className="grid grid-cols-3 gap-3">
          {latency.map((metric) => (
            <Card key={metric.label}>
              <CardContent>
                <div className="text-label text-muted-foreground">{metric.label}</div>
                <div className="text-heading">{metric.value} ms</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </section>
  )
}
