import { useState } from 'react'
import type { FormEvent } from 'react'

import { useAuth } from '../auth/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CopyButton } from '../components/CopyButton'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import { useAuditTrace } from '../lib/dis-ui-server/audit'

// Audit and Trace Lookup (surface map screen 8), TENANT slice, on the design-system
// craft bar. trace_id direct lookup only (demand list 5.1): enter a trace_id, render
// its ordered per-stage lifecycle (carded table, outcome as a semantic badge); a
// quarantined trace ends at a quarantined stage with an error_code. FM2: no
// cross-tenant search (5.2), no filters, no result list. Own-tenant only.
export function AuditLookup() {
  const { snapshot } = useAuth()
  const [input, setInput] = useState('')
  const [queried, setQueried] = useState<string | null>(null)

  const trace = useAuditTrace(snapshot, queried)

  function submit(event: FormEvent): void {
    event.preventDefault()
    const trimmed = input.trim()
    setQueried(trimmed.length === 0 ? null : trimmed)
  }

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-display">Audit and Trace Lookup</h1>
        <p className="text-caption text-muted-foreground">Trace a row through its lifecycle.</p>
      </header>

      <form onSubmit={submit} className="flex items-end gap-2">
        <div>
          <Label htmlFor="trace-id">Trace ID</Label>
          <Input
            id="trace-id"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="mt-1 w-80 font-mono"
          />
        </div>
        <Button type="submit">Look up</Button>
      </form>

      <div>{renderResult()}</div>
    </section>
  )

  function renderResult() {
    if (queried === null) {
      return <p className="text-caption text-muted-foreground">Enter a trace id to look up its lifecycle.</p>
    }
    if (trace.isPending) {
      return <LoadingState label="Looking up trace..." />
    }
    if (trace.isError) {
      return <ErrorState message="Could not look up the trace." />
    }
    if (trace.data === null) {
      return <EmptyState title="Trace not found" message={`No trace ${queried} for this tenant.`} />
    }
    return (
      <Card>
        <CardContent>
          <p className="flex items-center gap-1 font-mono text-caption text-muted-foreground">
            {trace.data.trace_id} · {trace.data.source_id}
            <CopyButton value={trace.data.trace_id} label="Copy trace id" />
          </p>
          <Table className="mt-2">
            <TableHeader>
              <TableRow>
                <TableHead>Outcome</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>At</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trace.data.stages.map((stage) => (
                <TableRow key={stage.stage}>
                  <TableCell>
                    <StatusBadge tone={stage.status === 'ok' ? 'success' : 'danger'}>
                      {stage.status === 'ok' ? 'OK' : 'FAIL'}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{stage.stage}</TableCell>
                  <TableCell className="text-muted-foreground">{stage.at}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {stage.mapping_version_id !== undefined ? `v${stage.mapping_version_id}` : ''}
                    {stage.mapping_version_id !== undefined && stage.error_code !== undefined ? ' · ' : ''}
                    {stage.error_code !== undefined ? stage.error_code : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    )
  }
}
