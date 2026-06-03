import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { createSample, useSample } from '../lib/dis-ui-server/onboarding'
import { useSources } from '../lib/dis-ui-server/sources'

// Sample Upload (surface map screen 3, onboarding step 1). Accepts a CSV sample
// and metadata, calls the 2.1 fixture to create a sample, polls 2.2, and on
// `ready` navigates to Mapping Review. Fixture mode: the file bytes are not sent.
export function SampleUpload() {
  const navigate = useNavigate()
  const { snapshot } = useAuth()
  const sources = useSources(snapshot)

  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [sourceKind, setSourceKind] = useState('csv')
  const [attachTo, setAttachTo] = useState<'new' | 'existing'>('new')
  // UI-only: demand list 2.1 has no source-instance field, so this is captured
  // but NOT sent (see onboarding.ts / the plan's Ambiguity 1).
  const [existingSourceId, setExistingSourceId] = useState('')
  const [sampleId, setSampleId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const sample = useSample(sampleId)

  useEffect(() => {
    if (sampleId !== null && sample.data?.status === 'ready') {
      navigate(`/upload/${sampleId}/review`)
    }
  }, [sampleId, sample.data?.status, navigate])

  async function analyze(): Promise<void> {
    setSubmitError(null)
    try {
      const result = await createSample({ source_kind: sourceKind, label })
      setSampleId(result.sample_id)
    } catch {
      setSubmitError('Could not start sample analysis.')
    }
  }

  if (sampleId !== null) {
    if (sample.isError || sample.data?.status === 'failed') {
      return (
        <ErrorState
          message="Sample analysis failed. Please try a different sample."
          onRetry={() => setSampleId(null)}
        />
      )
    }
    return <LoadingState label="Analyzing sample..." />
  }

  return (
    <section className="max-w-xl">
      <h1 className="text-xl font-semibold">Sample Upload</h1>
      <p className="mb-4 text-sm text-gray-500">Step 1 of 3: upload a sample of your data.</p>

      <label className="mb-3 block text-sm">
        CSV file (max 10MB, .csv only)
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm"
        />
      </label>
      {file !== null ? <p className="mb-3 text-xs text-gray-500">Selected: {file.name}</p> : null}

      <label className="mb-3 block text-sm">
        Source name
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="mt-1 block w-full rounded border px-2 py-1"
        />
      </label>

      <label className="mb-3 block text-sm">
        Source kind
        <select
          value={sourceKind}
          onChange={(e) => setSourceKind(e.target.value)}
          className="mt-1 block w-full rounded border px-2 py-1"
        >
          <option value="csv">CSV</option>
          <option value="json">JSON</option>
        </select>
      </label>

      <fieldset className="mb-4 text-sm">
        <legend className="mb-1">Attach to</legend>
        <label className="mr-4">
          <input
            type="radio"
            name="attachTo"
            checked={attachTo === 'new'}
            onChange={() => setAttachTo('new')}
          />{' '}
          New source
        </label>
        <label>
          <input
            type="radio"
            name="attachTo"
            checked={attachTo === 'existing'}
            onChange={() => setAttachTo('existing')}
          />{' '}
          Existing source
        </label>
        {attachTo === 'existing' ? (
          <select
            aria-label="Existing source"
            value={existingSourceId}
            onChange={(e) => setExistingSourceId(e.target.value)}
            className="mt-2 block w-full rounded border px-2 py-1"
          >
            <option value="">Select a source</option>
            {(sources.data ?? []).map((source) => (
              <option key={source.source_id} value={source.source_id}>
                {source.name}
              </option>
            ))}
          </select>
        ) : null}
      </fieldset>

      {submitError !== null ? (
        <p role="alert" className="mb-3 text-sm text-red-700">
          {submitError}
        </p>
      ) : null}

      <div className="flex gap-3">
        <button type="button" onClick={() => void analyze()} className="rounded border px-3 py-1">
          Analyze sample
        </button>
      </div>
    </section>
  )
}
