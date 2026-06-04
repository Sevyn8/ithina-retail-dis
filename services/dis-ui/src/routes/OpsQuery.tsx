import { Play } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CodeEditor } from '../components/CodeEditor'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { SAMPLE_QUERIES, useRunQuery } from '../lib/dis-ui-server/ops-query'

// DuckDB Query Panel (surface map screen 11), OPS slice, on the design-system craft bar.
// A SQL editor (CodeMirror) over the bronze blob with a dynamic-columns result grid
// (demand list 7.4-7.5). Reached only under the ops route-guard (OpsBoundary). EXECUTION
// IS STUBBED (lib/dis-ui-server/ops-query.ts): the query engine, the safety model
// (read-only / row caps / timeouts / sandboxing), and cross-tenant SQL authorization are
// Sanjeev's open contract, not invented or enforced here. The sample-query buttons load
// the canned strings the stub recognizes.
export function OpsQuery() {
  const [sqlText, setSqlText] = useState<string>(SAMPLE_QUERIES.normal)
  const run = useRunQuery()

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-display">DuckDB Query Panel</h1>
        <p className="text-caption text-muted-foreground">
          Cross-tenant SQL over the bronze blob. Execution is stubbed in this build.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label text-muted-foreground">Samples</span>
        <Button type="button" variant="outline" size="xs" onClick={() => setSqlText(SAMPLE_QUERIES.normal)}>
          Sample
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={() => setSqlText(SAMPLE_QUERIES.error)}>
          Error query
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={() => setSqlText(SAMPLE_QUERIES.empty)}>
          Empty
        </Button>
      </div>

      <CodeEditor value={sqlText} onChange={setSqlText} ariaLabel="SQL editor" />

      <div className="flex">
        <Button type="button" onClick={() => run.mutate(sqlText)} disabled={run.isPending}>
          <Play aria-hidden="true" />
          Run
        </Button>
      </div>

      <div>{renderResult()}</div>
    </section>
  )

  function renderResult() {
    if (run.isPending) {
      return <LoadingState label="Running query..." />
    }
    if (run.isError) {
      return <ErrorState message={run.error.message} />
    }
    if (!run.isSuccess) {
      return <p className="text-caption text-muted-foreground">Run a query to see results.</p>
    }
    const result = run.data
    if (result.rows.length === 0) {
      return <EmptyState title="No rows" message="The query returned no rows." />
    }
    return (
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {result.columns.map((col) => (
                  <TableHead key={col.name}>
                    {col.name}
                    <span className="ml-1 text-micro text-muted-foreground">{col.type}</span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <TableCell key={cellIndex} className="font-mono text-xs">
                      {String(cell)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    )
  }
}
