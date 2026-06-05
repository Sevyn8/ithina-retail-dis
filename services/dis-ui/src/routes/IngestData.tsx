import { Link } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import { useMappingTemplates } from '../lib/dis-ui-server/mapping-templates'

// Ingest Data (T5), at /ingest. A FLAT list of every mapping template across ALL of the
// tenant's sources (not a source-first drill-down): each template is a reusable mapping a
// batch can be ingested against. A template belongs to exactly one source, so the SOURCE is
// shown for context (two templates can share a name across sources). The per-row "Ingest
// data" action is gated on an active version. Source CRUD lives at /sources, reached via the
// "Manage sources" link here (it is not orphaned).
export function IngestData() {
  const { snapshot } = useAuth()
  // null source filter -> all templates across sources.
  const list = useMappingTemplates(snapshot, null)

  const header = (
    <header className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h1 className="text-display">Ingest Data</h1>
        <p className="text-caption text-muted-foreground">
          Every mapping template across your sources. Pick one to ingest a new batch of data.
        </p>
      </div>
      <Link to="/sources" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        Manage sources
      </Link>
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
                {list.data.map((template) => (
                  <TableRow key={template.template_id}>
                    <TableCell className="font-medium text-foreground">
                      {/* Source context (FM5): the source the template belongs to, then the
                          template name, so same-named templates from different sources differ. */}
                      <span className="block font-mono text-caption text-muted-foreground">
                        {template.source_id}
                      </span>
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
                    <TableCell className="text-muted-foreground">{template.versions_count}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Link
                          to={`/sources/${template.source_id}/templates/${template.template_id}`}
                          className={buttonVariants({ variant: 'outline', size: 'sm' })}
                        >
                          View
                        </Link>
                        {/* Gated ingest (FM4): enabled only with an active version; the
                            server also rejects a non-active template with 409. */}
                        {template.active_version !== null ? (
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
    </section>
  )
}
