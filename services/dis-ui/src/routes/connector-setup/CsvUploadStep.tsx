import type { Dispatch } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FileDropzone } from '../../components/FileDropzone'
import type { ConnectorWizardAction, ConnectorWizardState } from './state'

// CSV branch step 2 (Upload): a source name + a sample file (reusing the shared FileDropzone).
// STUBBED: selecting a file records its name and marks the (instant) stub analysis ready - no
// real upload/parse happens (the analysis + suggestions come from the connectors-api stub).
// Source name + a read sample gate Next.
export function CsvUploadStep({
  state,
  dispatch,
}: {
  state: ConnectorWizardState
  dispatch: Dispatch<ConnectorWizardAction>
}) {
  // Reconstruct a File-like handle for the dropzone's selected card from the recorded name.
  const selected = state.csvFileName.length > 0 ? new File([], state.csvFileName) : null

  function onSelect(file: File | null): void {
    if (file === null) {
      dispatch({ type: 'setCsvFile', fileName: '' })
      return
    }
    // Record the file, then mark the stubbed analysis ready (instant; the real analysis is a
    // TODO(wire) at the connectors-api seam).
    dispatch({ type: 'setCsvFile', fileName: file.name })
    dispatch({ type: 'setCsvAnalysisReady' })
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="csv-source-name">Source name</Label>
        <Input
          id="csv-source-name"
          placeholder="Weekly sales export"
          value={state.sourceName}
          onChange={(e) => dispatch({ type: 'setSourceName', value: e.target.value })}
        />
      </div>

      <FileDropzone
        id="csv-sample"
        label="Sample file"
        accept=".csv,text/csv"
        hint="We read the columns from a sample. Nothing is ingested yet."
        file={selected}
        onSelect={onSelect}
      />
    </div>
  )
}
