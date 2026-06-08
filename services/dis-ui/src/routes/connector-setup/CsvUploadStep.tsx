import type { Dispatch } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FileDropzone } from '../../components/FileDropzone'
import type { ConnectorWizardAction, ConnectorWizardState } from './state'

// CSV branch step 2 (Upload): a source name + a sample file (reusing the shared FileDropzone).
// REAL: the selected File is lifted to the route (onSelectFile) which parses it (papaparse) and
// calls the type-aware /mapping-suggestions endpoint at the mapping step. The reducer still
// records the file NAME (display + the source-name + file gate on Next). Nothing is ingested -
// only the columns are read for mapping.
export function CsvUploadStep({
  state,
  dispatch,
  onSelectFile,
}: {
  state: ConnectorWizardState
  dispatch: Dispatch<ConnectorWizardAction>
  // Lift the real File to the route (kept out of the pure reducer; non-serializable).
  onSelectFile: (file: File | null) => void
}) {
  // Reconstruct a File-like handle for the dropzone's selected card from the recorded name.
  const selected = state.csvFileName.length > 0 ? new File([], state.csvFileName) : null

  function onSelect(file: File | null): void {
    onSelectFile(file)
    if (file === null) {
      dispatch({ type: 'setCsvFile', fileName: '' })
      return
    }
    // Record the file name (display + Next gate). The real parse + suggestions run at the
    // mapping step, once the chosen template_type is known.
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
