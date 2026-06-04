import { useNavigate, useParams } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { SourceForm } from '../components/SourceForm'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { useSource, useUpdateSource } from '../lib/dis-ui-server/sources'
import type { Source } from '../lib/dis-ui-server/sources'

// Sources edit (slice 27), TENANT slice. Edits the display metadata (name / type / store).
// source_id is the immutable key (FM4): shown READ-ONLY, never re-keyed. Updates the mutable
// fixture; the index reflects it. R4: the fields are the shared SourceForm (dedup with
// SourceCreate); behavior unchanged.
export function SourceEdit() {
  const { sourceId } = useParams()
  const { snapshot } = useAuth()
  const detail = useSource(snapshot, sourceId ?? null)

  if (sourceId === undefined) {
    return <EmptyState title="No source" message="No source id in the URL." />
  }
  if (detail.isPending) {
    return <LoadingState label="Loading source..." />
  }
  if (detail.isError) {
    return <ErrorState message="Could not load the source." onRetry={() => void detail.refetch()} />
  }
  if (detail.data === null) {
    return <EmptyState title="Source not found" message={`No source ${sourceId} for this tenant.`} />
  }

  // Remount the form per source so its fields initialize from the loaded source (the shared
  // SourceForm lazy-inits from `initial`).
  return <SourceEditForm key={detail.data.source_id} source={detail.data} />
}

function SourceEditForm({ source }: { source: Source }) {
  const { snapshot } = useAuth()
  const navigate = useNavigate()
  const update = useUpdateSource(snapshot, source.source_id)

  return (
    <section className="max-w-xl">
      <header className="mb-4">
        <h1 className="text-display">Edit source</h1>
        <p className="text-caption text-muted-foreground">Update this source's display metadata.</p>
      </header>

      <SourceForm
        mode="edit"
        initial={{ source_id: source.source_id, name: source.name, type: source.type, store: source.store }}
        submitting={update.isPending}
        submitLabel="Save changes"
        onSubmit={(values) =>
          update.mutate(
            { name: values.name, type: values.type, store: values.store },
            { onSuccess: () => navigate('/sources') },
          )
        }
        onCancel={() => navigate('/sources')}
      />
    </section>
  )
}
