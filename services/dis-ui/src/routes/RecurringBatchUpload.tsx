import { Info, UploadCloud } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ActiveMappingSummary } from '../components/ActiveMappingSummary'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import { activeTemplateVersion, useMappingTemplate } from '../lib/dis-ui-server/mapping-templates'
import { useTemplateMappingFields } from '../lib/dis-ui-server/mapping-fields'
import type { TemplateMappingField } from '../lib/dis-ui-server/mapping-fields'
import {
  createRecurringBatchSession,
  type RecurringBatchSessionResult,
} from '../lib/dis-ui-server/recurring-batch'

// Recurring-batch upload (T4), at /sources/:sourceId/templates/:templateId/upload. A tenant
// set up this template once; a same-shaped CSV now arrives as a new batch. The flow REUSES
// the template's ACTIVE mapping read-only (no re-mapping, no review): it shows which mapping
// will apply, takes the file, and confirms. It is gated on an active version existing.
//
// PROVISIONAL: the create call goes through src/lib/dis-ui-server/recurring-batch.ts, the
// single module coupled to the PROPOSED (not-yet-built) upload-session template-carry shape
// (docs/slices/recurring-batch-upload-seam-contract.md). Fixture only - no file is ingested.
export function RecurringBatchUpload() {
  const { templateId } = useParams()
  const { snapshot } = useAuth()
  const detail = useMappingTemplate(snapshot, templateId ?? null)
  const fields = useTemplateMappingFields()

  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<RecurringBatchSessionResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

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

  // FM3: a recurring batch reuses the active mapping; with none, there is nothing to reuse.
  // The entry action is gated, but guard direct navigation too - honest, no dropzone.
  if (active === null) {
    return (
      <section className="flex flex-col gap-4">
        <header>
          <h1 className="text-display">Upload new batch</h1>
          <p className="text-caption text-muted-foreground">{template.template_name}</p>
        </header>
        <EmptyState
          title="No active version yet"
          message="This template has no active version yet. Activate a mapping before uploading a batch."
        />
      </section>
    )
  }

  async function confirmUpload(): Promise<void> {
    setSubmitError(null)
    if (snapshot === null) {
      setSubmitError('Could not start the batch upload session.')
      return
    }
    try {
      const session = await createRecurringBatchSession(snapshot, {
        source_id: template.source_id,
        template_id: template.template_id,
        intent: 'recurring_batch',
      })
      setResult(session)
    } catch {
      setSubmitError('Could not start the batch upload session.')
    }
  }

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <header>
        <h1 className="text-display">Upload new batch</h1>
        <p className="text-caption text-muted-foreground">
          This batch will use <span className="font-medium text-foreground">{template.template_name} v{active.version}</span>.
          The active mapping below is reused as-is; there is nothing to re-map.
        </p>
      </header>

      {/* FM4: honest, provisional. This path targets an endpoint that is not built yet and no
          file is actually ingested. */}
      <div
        role="note"
        className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-caption text-muted-foreground"
      >
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          Provisional demo. This uses a proposed upload path that dis-ui-server has not built yet,
          so the file is not actually uploaded or ingested. It shows which mapping a recurring
          batch would reuse.
        </span>
      </div>

      {/* The active mapping, read-only (reuse, not re-map - FM2). Same display as the template
          detail; intentionally no editable review. */}
      <ActiveMappingSummary version={active} catalog={catalog} />

      {/* Dropzone (same pattern as the sample upload). Bytes are not sent in fixture mode. */}
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
          Batch upload session created (provisional). This batch will use {template.template_name} v
          {active.version} (mapping_version_id {result.mapping_version_id}). The file is not actually
          ingested - this is a demo against an endpoint not yet built.
        </p>
      ) : (
        <div className="flex gap-3">
          <Button type="button" onClick={() => void confirmUpload()}>
            <UploadCloud aria-hidden="true" />
            Upload batch
          </Button>
        </div>
      )}
    </section>
  )
}
