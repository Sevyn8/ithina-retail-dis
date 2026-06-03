import { useParams } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import {
  usePromoteShadow,
  useRejectShadow,
  useShadowDiff,
  useShadowStats,
} from '../lib/dis-ui-server/shadow'

// Shadow Rollout Review (surface map screen 5), TENANT slice. Onboarding step 3:
// review a STAGED mapping version's shadow output (demand list 2.6 stats, 2.7 diff)
// and Promote (2.8) or Reject (2.9). Reached only from a source that has a staged
// version (FM4); a source with no staged version renders the empty state. Tenant
// scoped, no ops surface (FM3). "Extend window" is omitted (no endpoint in 2.6-2.9).
export function Shadow() {
  const { sourceId } = useParams()
  const { snapshot } = useAuth()
  const stats = useShadowStats(snapshot, sourceId ?? null)
  const diff = useShadowDiff(snapshot, sourceId ?? null)
  const promote = usePromoteShadow(snapshot, sourceId ?? null)
  const reject = useRejectShadow(snapshot, sourceId ?? null)

  if (sourceId === undefined) {
    return <EmptyState title="No source" message="No source id in the URL." />
  }
  if (stats.isPending) {
    return <LoadingState label="Loading shadow rollout..." />
  }
  if (stats.isError) {
    return <ErrorState message="Could not load the shadow rollout." onRetry={() => void stats.refetch()} />
  }
  if (stats.data === null) {
    return (
      <EmptyState
        title="No staged version"
        message={`${sourceId} has no mapping version under shadow review.`}
      />
    )
  }

  const s = stats.data
  const busy = promote.isPending || reject.isPending

  return (
    <section>
      <h1 className="text-xl font-semibold">
        Shadow review: {sourceId} (v{s.staged_version} staged
        {s.active_version !== null ? ` vs v${s.active_version} active` : ''})
      </h1>

      <div className="mt-3 rounded border p-3 text-sm">
        <h2 className="font-semibold">Shadow stats</h2>
        <p>
          Window: {s.window} · {s.input_chunks} input chunks
        </p>
        <p>Staged output: {s.staged_rows} rows</p>
        <p>
          Validation pass rate: {(s.validation_pass_rate * 100).toFixed(1)}% ({s.validation_fail_count}{' '}
          fails)
        </p>
        {s.active_version !== null ? (
          <p>
            Diff vs active v{s.active_version}: {s.diff_identical} identical, {s.diff_differing} differ in{' '}
            {s.diff_column}
          </p>
        ) : (
          <p>No prior active version (first onboarding); diff not shown.</p>
        )}
      </div>

      <div className="mt-3 rounded border p-3 text-sm">
        <h2 className="font-semibold">Diff samples (staged vs active)</h2>
        {diff.isPending ? (
          <LoadingState label="Loading diff..." />
        ) : diff.isError ? (
          <ErrorState message="Could not load the diff sample." onRetry={() => void diff.refetch()} />
        ) : diff.data.length === 0 ? (
          <p className="text-gray-500">No diff sample (no prior active version).</p>
        ) : (
          <table className="mt-1 w-full text-left">
            <thead>
              <tr className="border-b">
                <th className="py-1">SKU</th>
                <th>Column</th>
                <th>Active</th>
                <th>Staged</th>
              </tr>
            </thead>
            <tbody>
              {diff.data.map((row) => (
                <tr key={row.sku_id} className="border-b">
                  <td className="py-1">{row.sku_id}</td>
                  <td>{row.column}</td>
                  <td>{row.active_value}</td>
                  <td>{row.staged_value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={() => promote.mutate()}
          disabled={busy}
          className="rounded border px-3 py-1"
        >
          Promote to active
        </button>
        <button
          type="button"
          onClick={() => reject.mutate()}
          disabled={busy}
          className="rounded border px-3 py-1"
        >
          Reject, iterate
        </button>
      </div>
    </section>
  )
}
