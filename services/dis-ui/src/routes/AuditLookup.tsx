import { useState } from 'react'
import type { FormEvent } from 'react'

import { useAuth } from '../auth/useAuth'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { useAuditTrace } from '../lib/dis-ui-server/audit'
import type { AuditStage } from '../lib/dis-ui-server/audit'

// Audit and Trace Lookup (surface map screen 8), TENANT slice. trace_id direct
// lookup only (demand list 5.1): enter a trace_id, render its ordered per-stage
// lifecycle; a quarantined trace ends at a quarantined stage with an error_code.
// FM2: no cross-tenant search (5.2), no filters, no result list. Own-tenant only.
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
    <section>
      <h1 className="text-xl font-semibold">Audit and Trace Lookup</h1>
      <form onSubmit={submit} className="mt-3 flex items-end gap-2">
        <label className="text-sm">
          Trace ID
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="mt-1 block w-80 rounded border px-2 py-1"
          />
        </label>
        <button type="submit" className="rounded border px-3 py-1">
          Look up
        </button>
      </form>

      <div className="mt-4">{renderResult()}</div>
    </section>
  )

  function renderResult() {
    if (queried === null) {
      return <p className="text-sm text-gray-500">Enter a trace id to look up its lifecycle.</p>
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
      <div className="text-sm">
        <p className="text-gray-500">
          {trace.data.trace_id} · {trace.data.source_id}
        </p>
        <ol className="mt-2 flex flex-col gap-1">
          {trace.data.stages.map((stage) => (
            <li key={stage.stage} className={stage.status === 'ok' ? '' : 'text-red-700'}>
              {renderStage(stage)}
            </li>
          ))}
        </ol>
      </div>
    )
  }
}

function renderStage(stage: AuditStage): string {
  const marker = stage.status === 'ok' ? 'OK' : 'FAIL'
  const parts = [`[${marker}]`, stage.stage, stage.at]
  if (stage.mapping_version_id !== undefined) {
    parts.push(`v${stage.mapping_version_id}`)
  }
  if (stage.error_code !== undefined) {
    parts.push(stage.error_code)
  }
  return parts.join('  ')
}
