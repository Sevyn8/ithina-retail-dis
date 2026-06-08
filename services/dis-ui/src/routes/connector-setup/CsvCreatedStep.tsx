import { CheckCircle2 } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge } from '../../components/StatusBadge'
import type { ConnectorWizardState } from './state'

// CSV branch step 6 (Template created), terminal. STUBBED result from createCsvTemplate. Copy is
// "Created and live" - consistent with D88 (create-as-ACTIVE): the template is active in one
// step, no separate activate. The real create POST is a TODO(wire) at the connectors-api seam.
export function CsvCreatedStep({ state }: { state: ConnectorWizardState }) {
  const created = state.createdTemplate
  if (created === null) {
    return null
  }
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <CheckCircle2 aria-hidden="true" className="size-5 text-success" />
        <span className="text-body-strong text-success" role="status">
          Created and live
        </span>
      </div>

      <Card className="p-5">
        <CardContent className="flex flex-col gap-4 p-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-body-strong">{created.templateName}</span>
            <StatusBadge tone="success">Active v{created.activeVersion}</StatusBadge>
          </div>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-muted-foreground">Template type</dt>
              <dd className="text-body">{created.templateType}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-muted-foreground">Template ID</dt>
              <dd className="font-mono text-sm text-muted-foreground">{created.templateId}</dd>
            </div>
          </dl>
          <p className="text-caption text-muted-foreground">
            New files for this source are now processed through this mapping.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
