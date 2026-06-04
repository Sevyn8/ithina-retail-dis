import { useState } from 'react'
import { Link } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import type { StatusTone } from '../components/StatusBadge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useDeprecateSource, useSources } from '../lib/dis-ui-server/sources'
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

// Sources index (surface map screen 2), on the design-system craft bar: the tenant's
// sources as a carded table, status as a semantic badge, each row linking to its mapping
// versions. Slice 27 adds the CRUD actions: Create, per-row Edit, and Deprecate (a SOFT
// active -> deprecated transition via a confirm Dialog). There is NO hard delete - a
// source has canonical/audit data behind it (FM1).
export function SourcesIndex() {
  const { snapshot } = useAuth()
  const { data, isPending, isError, refetch } = useSources(snapshot)
  const deprecate = useDeprecateSource(snapshot)
  const [deprecating, setDeprecating] = useState<string | null>(null)

  if (isPending) {
    return <LoadingState label="Loading sources..." />
  }
  if (isError || data === undefined) {
    return <ErrorState message="Could not load sources." onRetry={() => void refetch()} />
  }
  if (data.length === 0) {
    return (
      <section className="flex flex-col gap-6">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-display">Sources</h1>
            <p className="text-caption text-muted-foreground">Your configured data sources.</p>
          </div>
          <Link to="/sources/new" className={buttonVariants({ variant: 'default', size: 'sm' })}>
            New source
          </Link>
        </header>
        <EmptyState title="No sources" message="No configured sources for this tenant yet." />
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-display">Sources</h1>
          <p className="text-caption text-muted-foreground">Your configured data sources.</p>
        </div>
        <Link to="/sources/new" className={buttonVariants({ variant: 'default', size: 'sm' })}>
          New source
        </Link>
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
                    <span className="flex items-center justify-end gap-2">
                      <Link
                        to={`/sources/${source.source_id}/mappings`}
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        Mappings
                      </Link>
                      <Link
                        to={`/sources/${source.source_id}/edit`}
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        Edit
                      </Link>
                      {source.status !== 'deprecated' ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeprecating(source.source_id)}
                        >
                          Deprecate
                        </Button>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Soft deprecate confirm (no hard delete, FM1). */}
      <Dialog open={deprecating !== null} onOpenChange={(open) => !open && setDeprecating(null)}>
        <DialogTrigger render={<span className="sr-only" />} />
        <DialogContent showCloseButton={false}>
          <DialogTitle>Deprecate this source?</DialogTitle>
          <p className="text-sm text-muted-foreground">
            The source moves to deprecated and stops accepting new submissions. Its history is
            retained; this is not a delete.
          </p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setDeprecating(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={deprecate.isPending}
              onClick={() => {
                if (deprecating !== null) {
                  deprecate.mutate(deprecating, { onSuccess: () => setDeprecating(null) })
                }
              }}
            >
              Confirm deprecate
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
