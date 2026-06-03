import { Link } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import type { StatusTone } from '../components/StatusBadge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useSources } from '../lib/dis-ui-server/sources'
import type { SourceStatus } from '../lib/dis-ui-server/sources'

function statusTone(status: SourceStatus): StatusTone {
  if (status === 'active') {
    return 'success'
  }
  if (status === 'staged') {
    return 'warning'
  }
  if (status === 'failing') {
    return 'danger'
  }
  return 'neutral'
}

// Read-only Sources index (surface map screen 2), on the design-system craft bar: the
// tenant's sources as a carded table (RLS-scoped via the fixture client), status as a
// semantic badge, each row linking to its mapping versions. NOT the Phase 2 Sources
// CRUD screen: no create / edit / deprecate / detail beyond the Mappings link.
export function SourcesIndex() {
  const { snapshot } = useAuth()
  const { data, isPending, isError, refetch } = useSources(snapshot)

  if (isPending) {
    return <LoadingState label="Loading sources..." />
  }
  if (isError || data === undefined) {
    return <ErrorState message="Could not load sources." onRetry={() => void refetch()} />
  }
  if (data.length === 0) {
    return <EmptyState title="No sources" message="No configured sources for this tenant yet." />
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-display">Sources</h1>
        <p className="text-caption text-muted-foreground">Your configured data sources.</p>
      </header>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((source) => (
                <TableRow key={source.source_id}>
                  <TableCell className="font-medium text-foreground">{source.name}</TableCell>
                  <TableCell className="text-muted-foreground">{source.type}</TableCell>
                  <TableCell className="text-muted-foreground">{source.store}</TableCell>
                  <TableCell>
                    <StatusBadge tone={statusTone(source.status)}>{source.status}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">v{source.active_version}</TableCell>
                  <TableCell>
                    <Link
                      to={`/sources/${source.source_id}/mappings`}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      Mappings
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  )
}
