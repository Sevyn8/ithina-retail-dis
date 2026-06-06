import { Link } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import type { MappingTemplate } from '../lib/dis-ui-server/mapping-templates'
import { useMappingTemplates } from '../lib/dis-ui-server/mapping-templates'

// Ingest Data (T6), at /ingest. Every mapping template across ALL of the tenant's sources,
// GROUPED by source: each template is a reusable mapping a batch can be ingested against, and
// a template belongs to exactly one source. The source is a group heading (context: two
// templates can share a name across sources, FM3), carrying a once-per-source "Manage source"
// link into SourceEdit (edit + deprecate). The per-template "Ingest data" action is gated on
// an active version. Source management lives behind "Manage source" (and Add Source / the
// connector picker), not a separate nav surface.

// Group the flat template list by source_id, preserving first-seen order so the rendered
// grouping is stable and matches the fixture ordering.
function groupBySource(
  templates: MappingTemplate[],
): { sourceId: string; templates: MappingTemplate[] }[] {
  const groups: { sourceId: string; templates: MappingTemplate[] }[] = []
  const index = new Map<string, number>()
  for (const template of templates) {
    const at = index.get(template.source_id)
    if (at === undefined) {
      index.set(template.source_id, groups.length)
      groups.push({ sourceId: template.source_id, templates: [template] })
    } else {
      groups[at].templates.push(template)
    }
  }
  return groups
}

export function IngestData() {
  const { snapshot } = useAuth()
  // null source filter -> all templates across sources.
  const list = useMappingTemplates(snapshot, null)

  const header = (
    <header className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h1 className="text-display">Upload CSV</h1>
        <p className="text-caption text-muted-foreground">
          Every mapping template across your sources. Pick one to upload a new batch of data.
        </p>
      </div>
    </header>
  )

  if (list.isPending) {
    return <LoadingState label="Loading templates..." />
  }
  if (list.isError) {
    return <ErrorState message="Could not load templates." onRetry={() => void list.refetch()} />
  }
  if (list.data.length === 0) {
    return (
      <section className="flex flex-col gap-6">
        {header}
        <EmptyState
          title="No templates yet"
          message="Create a template first, then come back to ingest data against it."
        />
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      {header}

      {groupBySource(list.data).map((group) => (
        <div key={group.sourceId} className="flex flex-col gap-3">
          {/* Source group heading (FM3): the source carries the context for its templates and
              hosts the once-per-source "Manage source" action (edit + deprecate, in SourceEdit). */}
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-mono text-heading text-foreground">{group.sourceId}</h2>
            <Link
              to={`/sources/${group.sourceId}/edit`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Manage source
            </Link>
          </div>

          <Card>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Template</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead>Staged</TableHead>
                      <TableHead>Draft</TableHead>
                      <TableHead>Versions</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.templates.map((template) => (
                      <TableRow key={template.template_id}>
                        <TableCell className="font-medium text-foreground">
                          {template.template_name}
                        </TableCell>
                        <TableCell>
                          {template.active_version !== null ? (
                            <StatusBadge tone="success">v{template.active_version}</StatusBadge>
                          ) : (
                            <span className="text-caption text-muted-foreground">none</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {template.staged_version !== null ? (
                            <StatusBadge tone="warning">v{template.staged_version}</StatusBadge>
                          ) : (
                            <span className="text-caption text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {template.draft_version !== null ? (
                            <StatusBadge tone="neutral">v{template.draft_version}</StatusBadge>
                          ) : (
                            <span className="text-caption text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {template.versions_count}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Link
                              to={`/sources/${template.source_id}/templates/${template.template_id}`}
                              className={buttonVariants({ variant: 'outline', size: 'sm' })}
                            >
                              View
                            </Link>
                            {/* Ingest affordance by ingestion mode (T8). API/connector sources
                                sync automatically: a "Connected / syncing" status, no manual
                                upload. File/CSV sources keep the gated ingest action (enabled
                                only with an active version; the server also rejects a non-active
                                template with 409). */}
                            {template.ingestion_mode === 'api' ? (
                              <StatusBadge tone="info">Connected / syncing</StatusBadge>
                            ) : template.active_version !== null ? (
                              <Link
                                to={`/sources/${template.source_id}/templates/${template.template_id}/upload`}
                                className={buttonVariants({ variant: 'default', size: 'sm' })}
                              >
                                Ingest data
                              </Link>
                            ) : (
                              <button
                                type="button"
                                disabled
                                title="No active version to ingest against yet"
                                className={buttonVariants({ variant: 'default', size: 'sm' })}
                              >
                                Ingest data
                              </button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      ))}
    </section>
  )
}
