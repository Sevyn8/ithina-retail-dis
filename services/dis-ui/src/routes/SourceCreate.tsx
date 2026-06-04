import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { makeSourceDraft, SOURCE_TYPES, useCreateSource } from '../lib/dis-ui-server/sources'

// Sources create (slice 27), TENANT slice, on the craft bar. Declares a new source via
// the shared SourceDraft (reconciled with the onboarding attach-to-new path). source_id
// is set once here (kind-style key, immutable thereafter). Adds to the mutable fixture;
// the Sources index reflects it.
export function SourceCreate() {
  const { snapshot } = useAuth()
  const navigate = useNavigate()
  const create = useCreateSource(snapshot)

  const [sourceId, setSourceId] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<string>(SOURCE_TYPES[0])
  const [storeName, setStoreName] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent): void {
    event.preventDefault()
    if (sourceId.trim().length === 0) {
      setError('A source id is required.')
      return
    }
    setError(null)
    const draft = makeSourceDraft({ source_id: sourceId.trim(), name, type, store: storeName })
    create.mutate(draft, { onSuccess: () => navigate('/sources') })
  }

  return (
    <section className="max-w-xl">
      <header className="mb-4">
        <h1 className="text-display">New source</h1>
        <p className="text-caption text-muted-foreground">Declare a data source for this tenant.</p>
      </header>

      <Card>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="source-id">Source id</Label>
              <Input
                id="source-id"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                placeholder="e.g. manual_csv_upload"
                className="mt-1 font-mono"
              />
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

            {error !== null ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}

            <div className="flex gap-3">
              <Button type="submit" disabled={create.isPending}>
                Create source
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
