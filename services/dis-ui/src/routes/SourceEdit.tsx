import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { SOURCE_TYPES, useSource, useUpdateSource } from '../lib/dis-ui-server/sources'
import type { Source } from '../lib/dis-ui-server/sources'

// Sources edit (slice 27), TENANT slice, on the craft bar. Edits the display metadata
// (name / type / store). source_id is the immutable key (FM4): shown READ-ONLY, never
// re-keyed. Updates the mutable fixture; the index reflects it.
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

  // Remount the form per source so its fields initialize from the loaded source (lazy
  // useState init, no effect).
  return <SourceEditForm key={detail.data.source_id} source={detail.data} />
}

function SourceEditForm({ source }: { source: Source }) {
  const { snapshot } = useAuth()
  const navigate = useNavigate()
  const update = useUpdateSource(snapshot, source.source_id)

  const [name, setName] = useState(source.name)
  const [type, setType] = useState(source.type)
  const [storeName, setStoreName] = useState(source.store)

  function submit(event: FormEvent): void {
    event.preventDefault()
    update.mutate({ name, type, store: storeName }, { onSuccess: () => navigate('/sources') })
  }

  return (
    <section className="max-w-xl">
      <header className="mb-4">
        <h1 className="text-display">Edit source</h1>
        <p className="text-caption text-muted-foreground">Update this source's display metadata.</p>
      </header>

      <Card>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <span className="text-label text-muted-foreground">Source id (immutable)</span>
              <p className="mt-1 font-mono text-sm">{source.source_id}</p>
            </div>
            <div>
              <Label htmlFor="source-name">Name</Label>
              <Input id="source-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="source-type">Type</Label>
              <Select id="source-type" value={type} onChange={(e) => setType(e.target.value)} className="mt-1">
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="source-store">Store</Label>
              <Input id="source-store" value={storeName} onChange={(e) => setStoreName(e.target.value)} className="mt-1" />
            </div>

            <div className="flex gap-3">
              <Button type="submit" disabled={update.isPending}>
                Save changes
              </Button>
              <Button type="button" variant="ghost" onClick={() => navigate('/sources')}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  )
}
