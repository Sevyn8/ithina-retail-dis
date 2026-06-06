import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DemoDataBanner } from '../components/DemoDataBanner'
import { FileDropzone } from '../components/FileDropzone'
import { ProgressRail } from '@/components/ui/progress-rail'
import { parseCsvFile } from '../lib/onboarding/analyze-csv'
import { getMappingSuggestions } from '../lib/dis-ui-server/mapping-suggestions'
import { useTemplateMappingFields } from '../lib/dis-ui-server/mapping-fields'
import { assembleAnalysis, nextSampleId, putSampleAnalysis } from '../lib/dis-ui-server/onboarding'
import { deriveSourceId } from '../lib/dis-ui-server/sources'
import { CSV_JOURNEY_STEPS, CSV_JOURNEY_STEP_INDEX } from './csv-journey'

// The server-validated source_id shape (createMappingTemplate / MappingTemplateCreate). The id
// is load-bearing: it is the template's source_id, set here and carried to Go-live. There is no
// source registry to pick from yet, so the operator supplies it (derived from the source name,
// editable). Attach-to-existing and the source-kind dropdown were removed: no registry exists,
// and this is the CSV journey (kind is implicitly CSV; the connector picker owns source type).
const SOURCE_ID_RE = /^[a-z0-9_]{1,128}$/

// Upload (CSV journey step 1), on the shared 4-step rail. The uploaded CSV is parsed
// CLIENT-SIDE (Papa Parse) into a real column profile; per-column suggestions come from the
// mapping-suggestions endpoint (real) or the mechanical stand-in (fixture); the assembled
// analysis is stored for the Review step. An upload AND a valid source id are required.
export function SampleUpload() {
  const navigate = useNavigate()
  const fields = useTemplateMappingFields()

  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [sourceIdEdited, setSourceIdEdited] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  // The source id tracks the source name (deriveSourceId) until the operator edits it directly.
  function onLabelChange(next: string): void {
    setLabel(next)
    if (!sourceIdEdited) {
      setSourceId(deriveSourceId(next))
    }
  }
  function onSourceIdChange(next: string): void {
    setSourceId(next)
    setSourceIdEdited(true)
  }

  const sourceIdValid = SOURCE_ID_RE.test(sourceId)
  const sourceIdError = sourceId.length > 0 && !sourceIdValid

  async function analyze(): Promise<void> {
    setSubmitError(null)
    if (file === null) {
      setSubmitError('Select a CSV file to analyze.')
      return
    }
    if (!sourceIdValid) {
      setSubmitError('Enter a valid source id (lowercase letters, digits, underscores).')
      return
    }
    setAnalyzing(true)
    try {
      // 1) real client-side parse -> column profile + sample rows + true row count.
      const parsed = await parseCsvFile(file)
      // 2) per-column suggestions: endpoint (real) or mechanical stand-in (fixture).
      const response = await getMappingSuggestions(
        { columns: parsed.columns, source_id: sourceId, template_name: label || null },
        fields.data ?? [],
      )
      // 3) assemble (carrying source_id + template_name for Go-live) + hand off to Review.
      const sampleId = nextSampleId()
      putSampleAnalysis(assembleAnalysis(parsed, response, sampleId, sourceId, label || sourceId))
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
        <h1 className="text-display">New CSV Template</h1>
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
        {/* Shared dropzone. The file is parsed in the browser on Analyze (the bytes are not
            uploaded at this step), so the in-flight label is "Analyzing ...", never "Uploading"
            (FM3). Success here is the navigation to Review, not an "Uploaded" message. */}
        <FileDropzone
          id="csv-file"
          label="CSV file"
          file={file}
          onSelect={setFile}
          accept=".csv"
          hint="CSV up to 10 MB"
          busy={analyzing}
          busyLabel={file !== null ? `Analyzing ${file.name}...` : undefined}
        />

        <div>
          <Label htmlFor="source-name">Source name</Label>
          <Input
            id="source-name"
            type="text"
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="source-id">Source id</Label>
          <Input
            id="source-id"
            type="text"
            value={sourceId}
            onChange={(e) => onSourceIdChange(e.target.value)}
            placeholder="e.g. manual_csv_upload"
            aria-invalid={sourceIdError}
            className="mt-1 font-mono"
          />
          {sourceIdError ? (
            <p role="alert" className="mt-1 text-caption text-danger">
              Lowercase letters, digits, and underscores only (1 to 128 characters).
            </p>
          ) : (
            <p className="mt-1 text-caption text-muted-foreground">
              The template's source id. Derived from the source name; edit if needed.
            </p>
          )}
        </div>

        {submitError !== null ? (
          <p role="alert" className="text-sm text-danger">
            {submitError}
          </p>
        ) : null}

        <div className="flex gap-3">
          <Button
            type="button"
            onClick={() => void analyze()}
            disabled={file === null || !sourceIdValid || analyzing}
          >
            <Sparkles aria-hidden="true" />
            {analyzing ? 'Analyzing sample...' : 'Analyze sample'}
          </Button>
        </div>
      </div>
    </section>
  )
}
