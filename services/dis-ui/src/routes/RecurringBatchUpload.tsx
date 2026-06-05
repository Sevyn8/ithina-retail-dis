import { Info, UploadCloud } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ActiveMappingSummary } from '../components/ActiveMappingSummary'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { DisUiServerHttpError } from '../lib/dis-ui-server/client'
import { uploadCsvWithSessionToken } from '../lib/dis-ui-server/csv-uploads'
import type { CsvUploadResult } from '../lib/dis-ui-server/csv-uploads'
import { activeTemplateVersion, useMappingTemplate } from '../lib/dis-ui-server/mapping-templates'
import { useTemplateMappingFields } from '../lib/dis-ui-server/mapping-fields'
import type { TemplateMappingField } from '../lib/dis-ui-server/mapping-fields'
import { useStoresOnboarded } from '../lib/dis-ui-server/stores'

// Ingest data (T5 / T4-real), at /sources/:sourceId/templates/:templateId/upload. A tenant
// set up this template once; a same-shaped CSV now arrives as a new batch. The flow uploads
// the file (REALLY - the bytes are sent) to dis-ui-server's POST /api/v1/csv-uploads against
// this template, for an ACTIVE store. It is gated on the template having an active version.
//
// HONESTY (D71 resolved by slice-8a): the batch is "uploaded against" this template, and the
// consumer is now template-keyed, so it maps the batch through the template's ACTIVE mapping
// version. Two real caveats kept in the copy: the version applied is the one ACTIVE at consume
// time (resolved when the batch is processed, not pinned at upload), and mapping is
// asynchronous (the 201 means received, not mapped). We never claim a specific applied
// mapping_version_id (the upload result returns none).

// Map a dis-ui-server error to a user-facing message (contract 8.1 status + envelope code).
function uploadErrorMessage(err: unknown): string {
  if (err instanceof DisUiServerHttpError) {
    switch (err.status) {
      case 404:
        return 'Template or store not found.'
      case 409:
        if (err.code === 'store_state_conflict') {
          return 'The selected store is not active.'
        }
        return 'This template has no active version yet.'
      case 413:
        return 'File exceeds the 10 MB limit.'
      case 422: {
        const reason = typeof err.details.reason === 'string' ? ` (${err.details.reason})` : ''
        return `The file failed the structural check${reason}.`
      }
      case 503:
        return 'The upload service is temporarily unavailable; please retry.'
      default:
        return 'The upload could not be completed.'
    }
  }
  return 'The upload could not be completed.'
}

export function RecurringBatchUpload() {
  const { templateId } = useParams()
  const { snapshot } = useAuth()
  const detail = useMappingTemplate(snapshot, templateId ?? null)
  const fields = useTemplateMappingFields()
  const stores = useStoresOnboarded(snapshot)

  const [file, setFile] = useState<File | null>(null)
  const [storeCode, setStoreCode] = useState('')
  const [result, setResult] = useState<CsvUploadResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (templateId === undefined) {
    return <EmptyState title="No template" message="No template id in the URL." />
  }
  if (detail.isPending) {
    return <LoadingState label="Loading template..." />
  }
  if (detail.isError || detail.data === undefined) {
    return <ErrorState message="Could not load this template." />
  }

  const template = detail.data
  const active = activeTemplateVersion(template)
  const catalog: TemplateMappingField[] = fields.data ?? []
  // The endpoint requires an ACTIVE store WITH a store_code; offer only those (a non-active or
  // code-less store would be a server 404/409). store_code is nullable at source (D55).
  const uploadableStores = (stores.data ?? []).filter(
    (s) => s.status === 'active' && s.store_code !== null,
  )

  // FM3/FM4: ingest needs an active version. The entry action is gated, but guard direct
  // navigation too - honest, no upload form.
  if (active === null) {
    return (
      <section className="flex flex-col gap-4">
        <header>
          <h1 className="text-display">Ingest data</h1>
          <p className="text-caption text-muted-foreground">{template.template_name}</p>
        </header>
        <EmptyState
          title="No active version yet"
          message="This template has no active version yet. Activate a mapping before ingesting a batch."
        />
      </section>
    )
  }

  async function confirmUpload(): Promise<void> {
    setSubmitError(null)
    if (file === null || storeCode === '') {
      return
    }
    setSubmitting(true)
    try {
      // The real call: a live multipart POST that actually sends the file (D72). The server
      // derives source_id from the template lineage; we send only file + template_id +
      // store_code. The consumer maps the batch through the template's active version (D71).
      const uploaded = await uploadCsvWithSessionToken({
        file,
        templateId: template.template_id,
        storeCode,
      })
      setResult(uploaded)
    } catch (err) {
      setSubmitError(uploadErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <header>
        <h1 className="text-display">Ingest data</h1>
        <p className="text-caption text-muted-foreground">
          This batch will be uploaded against{' '}
          <span className="font-medium text-foreground">{template.template_name}</span>.
        </p>
      </header>

      {/* FM4: honest. The file IS uploaded to DIS; the consumer maps it through the template's
          active version (D71). Two caveats kept: mapping is asynchronous (201 = received, not
          mapped) and the version applied is the one active at consume time. */}
      <div
        role="note"
        className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-caption text-muted-foreground"
      >
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          This uploads the file to DIS. The file is really sent, then ingested asynchronously
          through the active mapping version of {template.template_name}. Mapping happens after
          upload, not instantly.
        </span>
      </div>

      {/* The template's active mapping (read-only): the rules this batch will be mapped through.
          The version number is the template's CURRENT active version (context from
          mapping-templates), not a claim that the upload pinned that version. */}
      <div>
        <h2 className="text-body-strong mb-1">Active mapping</h2>
        <p className="text-caption text-muted-foreground mb-2">
          The rules this batch will be mapped through. The version shown (v{active.version}) is the
          template&apos;s current active version; the version applied is whichever is active when
          the batch is processed.
        </p>
        <ActiveMappingSummary version={active} catalog={catalog} />
      </div>

      {/* Store picker: store_code is required by the endpoint; only ACTIVE, coded stores. */}
      <div>
        <Label htmlFor="ingest-store">Store</Label>
        <Select
          id="ingest-store"
          aria-label="Store"
          value={storeCode}
          onChange={(e) => setStoreCode(e.target.value)}
          className="mt-1"
        >
          <option value="">Select a store</option>
          {uploadableStores.map((s) => (
            <option key={s.store_id} value={s.store_code ?? ''}>
              {s.name} ({s.store_code})
            </option>
          ))}
        </Select>
        {uploadableStores.length === 0 ? (
          <p className="mt-1 text-caption text-muted-foreground">
            No active stores with a store code are available.
          </p>
        ) : null}
      </div>

      {/* Dropzone. The selected file's bytes ARE sent (real upload). */}
      <div>
        <Label htmlFor="batch-csv-file">Batch CSV file</Label>
        <label
          htmlFor="batch-csv-file"
          className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-raised/50 px-4 py-8 text-center transition-colors hover:bg-muted"
        >
          <UploadCloud aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
          <span className="text-body-strong">Drag and drop or browse</span>
          <span className="text-caption text-muted-foreground">CSV up to 10 MB</span>
          <input
            id="batch-csv-file"
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

      {submitError !== null ? (
        <p role="alert" className="text-sm text-danger">
          {submitError}
        </p>
      ) : null}

      {result !== null ? (
        <p role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
          Uploaded {result.row_count} rows against {template.template_name}. They are ingested
          asynchronously through the template&apos;s active mapping version. Trace {result.trace_id}.
        </p>
      ) : (
        <div className="flex gap-3">
          <Button
            type="button"
            disabled={submitting || file === null || storeCode === ''}
            onClick={() => void confirmUpload()}
          >
            <UploadCloud aria-hidden="true" />
            Upload and ingest
          </Button>
        </div>
      )}
    </section>
  )
}
