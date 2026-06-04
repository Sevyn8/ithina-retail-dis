import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import type { StatusTone } from '../components/StatusBadge'
import { useFleetSummary, useFleetTenants } from '../lib/dis-ui-server/ops-fleet'
import type { FleetHealth } from '../lib/dis-ui-server/ops-fleet'

function healthTone(health: FleetHealth): StatusTone {
  if (health === 'healthy') {
    return 'success'
  }
  if (health === 'warning') {
    return 'warning'
  }
  return 'danger'
}

// Ops Fleet (surface map screen 10), OPS slice, on the design-system craft bar. The
// cross-tenant tenant-health overview (demand list 7.1 summary as metric cards, 7.2-7.3
// per-tenant health as a carded table). Reached only under the ops route-guard
// (OpsBoundary). The cross-tenant read authorization is Sanjeev's RLS policy (open); the
// fixture returns a multi-tenant fleet. No per-tenant drill-down or notify this slice.
export function OpsFleet() {
  const summary = useFleetSummary()
  const tenants = useFleetTenants()

  if (summary.isPending || tenants.isPending) {
    return <LoadingState label="Loading fleet..." />
  }
  if (summary.isError || tenants.isError || summary.data === undefined || tenants.data === undefined) {
    return <ErrorState message="Could not load the fleet." onRetry={() => void tenants.refetch()} />
  }
  if (tenants.data.length === 0) {
    return <EmptyState title="No tenants" message="No tenants in the fleet yet." />
  }

  const s = summary.data
  const metrics: { label: string; value: string }[] = [
    { label: 'Tenants', value: String(s.tenant_count) },
    { label: 'Healthy', value: String(s.healthy) },
    { label: 'Warning', value: String(s.warning) },
    { label: 'Failing', value: String(s.failing) },
    { label: 'Rows (24h)', value: s.total_rows_24h.toLocaleString() },
    { label: 'Open quarantine', value: String(s.open_quarantine) },
  ]

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-display">Ops Fleet</h1>
        <p className="text-caption text-muted-foreground">Which tenants need attention right now?</p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent>
              <div className="text-label text-muted-foreground">{m.label}</div>
              <div className="text-heading">{m.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Rows (24h)</TableHead>
                <TableHead>Open quarantine</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.data.map((t) => (
                <TableRow key={t.tenant_id}>
                  <TableCell className="font-medium text-foreground">{t.name}</TableCell>
                  <TableCell>
                    <StatusBadge tone={healthTone(t.health)}>{t.health}</StatusBadge>
                  </TableCell>
                  <TableCell>{t.rows_24h.toLocaleString()}</TableCell>
                  <TableCell>{t.open_quarantine}</TableCell>
                  <TableCell className="text-muted-foreground">{t.last_activity_at}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  )
}
