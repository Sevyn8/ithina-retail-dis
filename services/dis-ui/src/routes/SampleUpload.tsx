import { Sparkles, UploadCloud } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { DemoDataBanner } from '../components/DemoDataBanner'
import { ProgressRail } from '@/components/ui/progress-rail'
import { cn } from '@/lib/utils'
import { parseCsvFile } from '../lib/onboarding/analyze-csv'
import { getMappingSuggestions } from '../lib/dis-ui-server/mapping-suggestions'
import { useTemplateMappingFields } from '../lib/dis-ui-server/mapping-fields'
import { assembleAnalysis, nextSampleId, putSampleAnalysis } from '../lib/dis-ui-server/onboarding'
import { deriveSourceId, makeSourceDraft, useSources } from '../lib/dis-ui-server/sources'
import { CSV_JOURNEY_STEPS, CSV_JOURNEY_STEP_INDEX } from './csv-journey'

// Upload (CSV journey step 1), on the shared 4-step rail. T11: the uploaded CSV is parsed
// CLIENT-SIDE (Papa Parse) into a real column profile, per-column suggestions come from the
// mapping-suggestions endpoint (real mode) or the mechanical stand-in (fixture mode), and the
// assembled analysis is stored for the Review step. No demo data: an upload is required.
export function SampleUpload() {
  const navigate = useNavigate()
  const { snapshot } = useAuth()
  const sources = useSources(snapshot)
  const fields = useTemplateMappingFields()

  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [sourceKind, setSourceKind] = useState('csv')
  const [attachTo, setAttachTo] = useState<'new' | 'existing'>('new')
  // UI-only: the source-instance choice is captured but not part of the analyze profile.
  const [existingSourceId, setExistingSourceId] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  // The new source this attach-to-new flow declares, built via the SHARED SourceDraft builder.
  const newSourceDraft = makeSourceDraft({
    source_id: deriveSourceId(label),
    name: label,
    type: sourceKind,
    store: '',
  })

  async function analyze(): Promise<void> {
    setSubmitError(null)
    if (file === null) {
      setSubmitError('Select a CSV file to analyze.')
      return
    }
    setAnalyzing(true)
    try {
      // 1) real client-side parse -> column profile + sample rows + true row count.
      const parsed = await parseCsvFile(file)
      // 2) per-column suggestions: endpoint (real) or mechanical stand-in (fixture).
      const sourceId = attachTo === 'existing' ? existingSourceId || null : newSourceDraft.source_id || null
      const response = await getMappingSuggestions(
        { columns: parsed.columns, source_id: sourceId, template_name: label || null },
        fields.data ?? [],
      )
      // 3) assemble + hand off to Review.
      const sampleId = nextSampleId()
      putSampleAnalysis(assembleAnalysis(parsed, response, sampleId))
      navigate(`/upload/${sampleId}/review`)
    } catch {
      setSubmitError('Could not analyze the CSV. Please check the file and try again.')
    } finally {
      setAnalyzing(false)
    }
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
        {/* Styled dropzone. The native input is visually hidden but accessible. The file is
            parsed in the browser on Analyze (the bytes are not uploaded at this step). */}
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
          ) : (
            <p className="mt-1 text-caption text-muted-foreground">
              Select a CSV file to analyze its columns.
            </p>
          )}
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
          <Button type="button" onClick={() => void analyze()} disabled={file === null || analyzing}>
            <Sparkles aria-hidden="true" />
            {analyzing ? 'Analyzing sample...' : 'Analyze sample'}
          </Button>
        </div>
      </div>
    </section>
  )
}
