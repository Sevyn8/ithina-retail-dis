import { useState } from 'react'
import { useParams } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { useMappingVersion, useMappingVersions } from '../lib/dis-ui-server/mappings'

// Mapping Versions (surface map screen 6), TENANT slice, READ-ONLY. Version list
// (demand list 3.1) with status badges + a per-version full immutable definition
// (3.2). FM2: no edit / create / deprecate / promote (New version is disabled;
// the rest are omitted); no Audit-by-mapping_version_id link (needs 5.2 search).
export function MappingVersions() {
  const { sourceId } = useParams()
  const { snapshot } = useAuth()
  const list = useMappingVersions(snapshot, sourceId ?? null)
  const [selected, setSelected] = useState<number | null>(null)
  const detail = useMappingVersion(snapshot, sourceId ?? null, selected)

  if (sourceId === undefined) {
    return <EmptyState title="No source" message="No source id in the URL." />
  }
  if (list.isPending) {
    return <LoadingState label="Loading mappings..." />
  }
  if (list.isError) {
    return <ErrorState message="Could not load mapping versions." onRetry={() => void list.refetch()} />
  }
  if (list.data.length === 0) {
    return <EmptyState title="No mappings for this source" message={`No mapping versions for ${sourceId}.`} />
  }

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Mappings: {sourceId}</h1>
        {/* FM2: read-only. Creating a new version is a Phase 2 affordance. */}
        <button type="button" disabled className="rounded border px-3 py-1 text-gray-400">
          New version (Phase 2)
        </button>
      </div>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-1">Version</th>
            <th>Status</th>
            <th>Created</th>
            <th>By</th>
            <th>Fields</th>
            <th>Transforms</th>
            <th>Suite</th>
            <th>Active window</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {list.data.map((row) => (
            <tr key={row.version} className="border-b">
              <td className="py-1">v{row.version}</td>
              <td>
                <span
                  className={
                    row.status === 'active'
                      ? 'font-semibold text-green-700'
                      : row.status === 'staged'
                        ? 'text-yellow-700'
                        : 'text-gray-500'
                  }
                >
                  {row.status.toUpperCase()}
                </span>
              </td>
              <td>{row.created_at}</td>
              <td>{row.created_by}</td>
              <td>{row.field_count}</td>
              <td>{row.transform_count}</td>
              <td>v{row.suite_version}</td>
              <td>
                {row.active_from === null
                  ? '-'
                  : `${row.active_from} to ${row.active_to ?? 'current'}`}
              </td>
              <td>
                <button type="button" onClick={() => setSelected(row.version)} className="underline">
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected !== null ? (
        <div className="mt-4 rounded border p-3">
          <h2 className="text-sm font-semibold">Definition (v{selected}, immutable)</h2>
          {detail.isPending ? (
            <LoadingState label="Loading definition..." />
          ) : detail.isError || detail.data === null || detail.data === undefined ? (
            <ErrorState message="Could not load the mapping definition." />
          ) : (
            <pre className="mt-1 overflow-x-auto rounded bg-gray-100 p-2 text-xs">
              {JSON.stringify(detail.data.mapping_rules, null, 2)}
            </pre>
          )}
        </div>
      ) : null}
    </section>
  )
}
