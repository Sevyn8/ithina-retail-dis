import { useState } from 'react'
import { useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ProgressRail } from '@/components/ui/progress-rail'
import { EmptyState } from '../components/states/EmptyState'
import { StatusBadge } from '../components/StatusBadge'
import { sourceIdentity } from '../components/source-identity'
import { posConnectorSpec } from '../lib/dis-ui-server/pos-connectors'
import { CSV_JOURNEY_STEPS } from './csv-journey'
import { cn } from '@/lib/utils'

// Thin POS connect step (redesign R5), at /connect/:posType, on the new language. THIN and
// honest: a representative credential shell that is DISABLED, a coming-soon treatment, a
// notify-me action, and a note that once connected this POS feeds the SAME mapping/preview/
// go-live journey as CSV (R3). No working or faked connect, no OAuth, no sync (FM1). The
// credential shapes are UI-proposed, Sanjeev confirms (FM2). The shared-journey handoff is
// framing only; no POS-specific journey is built (FM3). Location-to-store_id is deferred (FM4).
export function PosConnect() {
  const { posType } = useParams()
  const [notified, setNotified] = useState(false)

  const spec = posType !== undefined ? posConnectorSpec(posType) : null
  if (spec === null) {
    return <EmptyState title="Unknown connector" message="No connector to set up for this URL." />
  }

  const identity = sourceIdentity(spec.key)
  const Icon = identity.icon
  // The connect step is step 1 of the SAME journey as CSV: its tail (Review mapping /
  // Preview / Go live) is reused from the shared CSV_JOURNEY_STEPS so it reads as one flow.
  const railSteps = ['Connect', ...CSV_JOURNEY_STEPS.slice(1)]

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-10 items-center justify-center rounded-xl',
              identity.bgSoftClass,
              identity.textClass,
            )}
          >
            <Icon className="size-5" />
          </span>
          <h1 className="text-display">Connect {identity.label}</h1>
          <StatusBadge tone="neutral">Coming soon</StatusBadge>
        </div>
        <p className="text-caption text-muted-foreground">
          Once connected, {identity.label} feeds the same mapping, preview, and go-live journey as CSV.
        </p>
      </header>

      <ProgressRail steps={railSteps} current={0} />

      {/* Representative credential shell, DISABLED (FM1). The fields are the proposed shape,
          not a live integration; the real auth model is a Sanjeev spec (FM2). */}
      <Card>
        <CardContent>
          <form className="flex flex-col gap-4" aria-label={`${identity.label} connection`}>
            {spec.credentialFields.map((field) => (
              <div key={field.name}>
                <Label htmlFor={`pos-${field.name}`}>{field.label}</Label>
                <Input
                  id={`pos-${field.name}`}
                  placeholder={field.placeholder}
                  disabled
                  className="mt-1"
                />
              </div>
            ))}
            <div className="flex flex-wrap gap-3">
              {/* Disabled: connecting is not available yet (no working/faked connect). */}
              <Button type="button" disabled>
                {spec.connectLabel}
              </Button>
              <Button type="button" variant="outline" onClick={() => setNotified(true)}>
                Notify me when ready
              </Button>
            </div>
            {notified ? (
              <p role="status" className="text-caption text-muted-foreground">
                Noted. The {identity.label} connector is coming soon.
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </section>
  )
}
