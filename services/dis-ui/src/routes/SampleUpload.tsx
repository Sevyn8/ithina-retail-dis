import { Sparkles, UploadCloud } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { DemoDataBanner } from '../components/DemoDataBanner'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { ProgressRail } from '@/components/ui/progress-rail'
import { cn } from '@/lib/utils'
import { createSample, useSample } from '../lib/dis-ui-server/onboarding'
import { deriveSourceId, makeSourceDraft, useSources } from '../lib/dis-ui-server/sources'
import { CSV_JOURNEY_STEPS, CSV_JOURNEY_STEP_INDEX } from './csv-journey'

// Upload (CSV journey step 1; surface map screen 3, onboarding step 1), on the redesign
// visual language behind the shared 4-step rail. Accepts a CSV sample and metadata, calls
// the 2.1 fixture to create a sample, polls 2.2, and on `ready` advances to Review mapping.
// Fixture mode: the file bytes are not sent. The data layer (onboarding.ts) is unchanged
// (R3); only the composition and the rail are new.
export function SampleUpload() {
  const navigate = useNavigate()
  const { snapshot } = useAuth()
  const sources = useSources(snapshot)

  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [sourceKind, setSourceKind] = useState('csv')
  const [attachTo, setAttachTo] = useState<'new' | 'existing'>('new')
  // UI-only: demand list 2.1 has no source-instance field, so this is captured
  // but NOT sent (see onboarding.ts / the prior ambiguity note).
  const [existingSourceId, setExistingSourceId] = useState('')
  const [sampleId, setSampleId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const sample = useSample(sampleId)

  // The new source this attach-to-new flow declares, built via the SHARED SourceDraft
  // builder so onboarding and the Sources CRUD create define a source identically (slice
  // 27, FM2). The 2.1 sample-create wire call is unchanged; this only surfaces the
  // kind-style source_id the flow will mint.
  const newSourceDraft = makeSourceDraft({
    source_id: deriveSourceId(label),
    name: label,
    type: sourceKind,
    store: '',
  })

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
    <section className="max-w-2xl">
      <header className="mb-4">
        <h1 className="text-display">Create Template</h1>
        <p className="text-caption text-muted-foreground">
          Upload a sample of your data; we map it, you review, it goes live as a template.
        </p>
      </header>

      <div className="mb-6">
        <ProgressRail steps={[...CSV_JOURNEY_STEPS]} current={CSV_JOURNEY_STEP_INDEX.upload} />
      </div>

      <div className="mb-4">
        <DemoDataBanner />
      </div>

      <div className="flex flex-col gap-4">
        {/* Styled dropzone. The native input is visually hidden but accessible; the
            file bytes are not sent in fixture mode. */}
        <div>
          <Label htmlFor="csv-file">CSV file</Label>
          <label
            htmlFor="csv-file"
            className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-raised/50 px-4 py-8 text-center transition-colors hover:bg-muted"
          >
            <UploadCloud aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
            <span className="text-body-strong">Drag and drop or browse</span>
            <span className="text-caption text-muted-foreground">CSV up to 10 MB</span>
            <input
              id="csv-file"
              type="file"
              accept=".csv"
              aria-label="CSV file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="sr-only"
            />
          </label>
          {file !== null ? (
            <p className="mt-1 text-caption text-muted-foreground">Selected: {file.name}</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="source-name">Source name</Label>
          <Input
            id="source-name"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="source-kind">Source kind</Label>
          <Select
            id="source-kind"
            value={sourceKind}
            onChange={(e) => setSourceKind(e.target.value)}
            className="mt-1"
          >
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </Select>
        </div>

        <fieldset>
          <legend className="text-label mb-2 text-muted-foreground">Attach to</legend>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              aria-pressed={attachTo === 'new'}
              onClick={() => setAttachTo('new')}
              className={cn(
                'rounded-md border p-3 text-left text-sm transition-colors',
                attachTo === 'new'
                  ? 'border-primary bg-primary/5 font-medium'
                  : 'border-border hover:bg-muted',
              )}
            >
              New source
              <span className="block text-caption text-muted-foreground">Start a fresh source.</span>
            </button>
            <button
              type="button"
              aria-pressed={attachTo === 'existing'}
              onClick={() => setAttachTo('existing')}
              className={cn(
                'rounded-md border p-3 text-left text-sm transition-colors',
                attachTo === 'existing'
                  ? 'border-primary bg-primary/5 font-medium'
                  : 'border-border hover:bg-muted',
              )}
            >
              Existing source
              <span className="block text-caption text-muted-foreground">Attach to a source.</span>
            </button>
          </div>
          {attachTo === 'new' && newSourceDraft.source_id.length > 0 ? (
            <p className="mt-2 text-caption text-muted-foreground">
              New source id: <span className="font-mono">{newSourceDraft.source_id}</span>
            </p>
          ) : null}
          {attachTo === 'existing' ? (
            <Select
              aria-label="Existing source"
              value={existingSourceId}
              onChange={(e) => setExistingSourceId(e.target.value)}
              className="mt-3"
            >
              <option value="">Select a source</option>
              {(sources.data ?? []).map((source) => (
                <option key={source.source_id} value={source.source_id}>
                  {source.name}
                </option>
              ))}
            </Select>
          ) : null}
        </fieldset>

        {submitError !== null ? (
          <p role="alert" className="text-sm text-danger">
            {submitError}
          </p>
        ) : null}

        <div className="flex gap-3">
          <Button type="button" onClick={() => void analyze()}>
            <Sparkles aria-hidden="true" />
            Analyze sample
          </Button>
        </div>
      </div>
    </section>
  )
}
