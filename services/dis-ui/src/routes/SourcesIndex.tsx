import { Link } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { useSources } from '../lib/dis-ui-server/sources'

// Read-only Sources index: the Phase-1 navigation backbone. Lists the tenant's
// sources (RLS-scoped via the fixture client) and links each to its mapping
// versions. NOT the Phase 2 Sources CRUD screen: no create / edit / deprecate /
// detail beyond the Mappings link.
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
    <section>
      <h1 className="mb-4 text-xl font-semibold">Sources</h1>
      <ul className="flex flex-col gap-2">
        {data.map((source) => (
          <li key={source.source_id} className="rounded border p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{source.name}</span>
              <span className="text-xs uppercase text-gray-500">{source.status}</span>
            </div>
            <div className="mt-1 text-sm text-gray-500">
              {source.type} · {source.store} · v{source.active_version}
            </div>
            <Link
              to={`/sources/${source.source_id}/mappings`}
              className="mt-2 inline-block text-sm underline"
            >
              Mappings
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
