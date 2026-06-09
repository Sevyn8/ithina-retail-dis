import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useMappingTemplates } from '../lib/dis-ui-server/mapping-templates'
import type { MappingTemplate } from '../lib/dis-ui-server/mapping-templates'
import { useTemplateTypes } from '../lib/dis-ui-server/template-types'

// Tenant-admin Dashboard (/), rebuilt as an HONEST skeleton: real data where an endpoint exists,
// muted "metrics pending" placeholders everywhere else. NO fabricated numbers - a tenant seeing a
// fake 97.7% would be misled. Real today: the pipelines list + count (GET /mapping-templates) and
// the friendly template-type labels (GET /template-types). Everything volume/quality/freshness is
// pending a metrics endpoint and renders as a placeholder.
//
// The earlier fabricated rollup (lib/dis-ui-server/dashboard.ts `useDashboardSummary`, a
// fixture-only stand-in) is deliberately NOT used here; it is left in place as the scaffold for a
// future real /dashboard endpoint (now unused by this component).

// A KPI tile whose metric has no endpoint yet: the label + a clear muted "Metrics pending", never
// a number.
function PendingTile({ label }: { label: string }) {
  return (
    <Card className="border-dashed bg-muted/30">
      <CardContent>
        <div className="text-label text-muted-foreground">{label}</div>
        <div className="text-body text-muted-foreground">Metrics pending</div>
      </CardContent>
    </Card>
  )
}

// A REAL KPI tile (a value backed by an endpoint).
function MetricTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card>
      <CardContent>
        <div className="text-label text-muted-foreground">{label}</div>
        <div className="text-display-lg tabular-nums">{value}</div>
      </CardContent>
    </Card>
  )
}

// A panel for a section that has no data source yet: a muted, visually-distinct "coming soon".
function PendingPanel({ title, message }: { title: string; message: string }) {
  return (
    <Card className="border-dashed bg-muted/30">
      <CardHeader>
        <CardTitle className="text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-caption text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  )
}

export function Dashboard() {
  const { snapshot } = useAuth()
  // The only real tenant-scoped read the dashboard has today: the mapping-template lineages.
  const templates = useMappingTemplates(snapshot, null)
  // Friendly template-type labels (key -> display_name), verbatim from GET /template-types.
  const types = useTemplateTypes()
  const typeLabels = new Map<string, string>()
  for (const t of types.data ?? []) {
    typeLabels.set(t.key, t.display_name)
  }
  function typeLabel(template: MappingTemplate): string | null {
    if (template.template_type === undefined) {
      return null
    }
    return typeLabels.get(template.template_type) ?? null
  }

  const header = (
    <header className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h1 className="text-display">Dashboard</h1>
        <p className="text-caption text-muted-foreground">
          Is your data flowing, and landing clean?
        </p>
      </div>
      <Link to="/connectors/new" className={buttonVariants({ variant: 'default', size: 'sm' })}>
        Add source
      </Link>
    </header>
  )

  if (templates.isPending) {
    return <LoadingState label="Loading dashboard..." />
  }
  if (templates.isError) {
    return (
      <ErrorState
        message="Could not load the dashboard."
        onRetry={() => void templates.refetch()}
      />
    )
  }

  const list = templates.data
  const activePipelines = list.filter((t) => t.active_version !== null).length

  return (
    <section className="flex flex-col gap-6">
      {header}

      {/* KPI strip: one real tile (active pipelines), three honest placeholders. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Active pipelines" value={activePipelines} />
        <PendingTile label="Rows ingested (24h)" />
        <PendingTile label="Quarantine rate (24h)" />
        <PendingTile label="Freshness" />
      </div>

      {/* Needs attention: no data-quality metrics yet, so no fabricated alerts. */}
      <Card className="border-dashed bg-muted/30">
        <CardHeader>
          <CardTitle className="text-muted-foreground">Needs attention</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-caption text-muted-foreground">
            Alerts appear here once data-quality metrics are available.
          </p>
        </CardContent>
      </Card>

      {/* Flow + Quality: both pending an endpoint (no upload-history GET; no DQ metrics). */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <PendingPanel
          title="Flow"
          message="Per-source volume and freshness will appear here once upload history is available. The 7-day trend needs a rollup."
        />
        <PendingPanel
          title="Quality"
          message="Pass rate and rejection reasons will appear here once data-quality metrics are available."
        />
      </div>

      {/* Pipelines: REAL from GET /mapping-templates. Health is neutral (no quality data to color
          it). No "Last received" column - that needs an upload-history endpoint (see Flow). */}
      <Card>
        <CardHeader>
          <CardTitle>Pipelines</CardTitle>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              No pipelines yet. Add a source to create one.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Health</TableHead>
                    <TableHead>Pipeline</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((template) => (
                    <PipelineRow
                      key={template.template_id}
                      template={template}
                      typeLabel={typeLabel(template)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function PipelineRow({
  template,
  typeLabel,
}: {
  template: MappingTemplate
  typeLabel: string | null
}) {
  const noVersions =
    template.active_version === null &&
    template.staged_version === null &&
    template.draft_version === null
  return (
    <TableRow>
      <TableCell>
        {/* Neutral health: no quality/flow data exists yet to make this meaningful. */}
        <span
          aria-hidden="true"
          className="inline-block size-2 rounded-full bg-muted-foreground/40"
        />
        <span className="sr-only">Health data pending</span>
      </TableCell>
      <TableCell className="font-medium text-foreground">
        <Link
          to={`/sources/${template.source_id}/templates/${template.template_id}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          {template.template_name}
        </Link>
      </TableCell>
      <TableCell>
        {typeLabel !== null ? (
          <StatusBadge tone="neutral">{typeLabel}</StatusBadge>
        ) : (
          <span className="text-caption text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          {template.active_version !== null ? (
            <StatusBadge tone="success">Active v{template.active_version}</StatusBadge>
          ) : null}
          {template.staged_version !== null ? (
            <StatusBadge tone="warning">Staged v{template.staged_version}</StatusBadge>
          ) : null}
          {template.draft_version !== null ? (
            <StatusBadge tone="neutral">Draft v{template.draft_version}</StatusBadge>
          ) : null}
          {noVersions ? (
            <span className="text-caption text-muted-foreground">No versions</span>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}
