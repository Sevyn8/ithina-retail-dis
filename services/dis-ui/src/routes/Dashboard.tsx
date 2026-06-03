import { useAuth } from '../auth/useAuth'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { useDashboardSummary } from '../lib/dis-ui-server/dashboard'
import type { SourceHealth } from '../lib/dis-ui-server/dashboard'

function healthClass(health: SourceHealth): string {
  if (health === 'healthy') {
    return 'text-green-700'
  }
  if (health === 'warning') {
    return 'text-yellow-700'
  }
  return 'text-red-700'
}

// Tenant Dashboard (surface map screen 1), at `/`. Reads dashboard/summary
// (demand list 1.2) and renders the per-source health rollup + the latency
// snapshot. Tenant-scoped; read-only. No notifications widget (Checkpoint 2), no
// action buttons, no ops widgets (FM1).
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

  return (
    <section>
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <h2 className="mt-4 text-sm font-semibold">Health by source</h2>
      <table className="mt-1 w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-1">Source</th>
            <th>Health</th>
            <th>Rows (24h)</th>
            <th>Quarantined open</th>
            <th>Last ok</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => (
            <tr key={source.source_id} className="border-b">
              <td className="py-1">{source.name}</td>
              <td className={healthClass(source.health)}>{source.health}</td>
              <td>{source.rows_24h.toLocaleString()}</td>
              <td>{source.quarantined_open}</td>
              <td>{source.last_ok_at}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-4 text-sm font-semibold">Latency last 1h</h2>
      <p className="text-sm">
        p50: {latency_1h.p50_ms} ms · p95: {latency_1h.p95_ms} ms · p99: {latency_1h.p99_ms} ms
      </p>
    </section>
  )
}
