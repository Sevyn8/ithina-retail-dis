import { Check } from 'lucide-react'
import type { Dispatch } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { CONNECTOR_ORDER, CONNECTOR_SPECS } from '../../lib/dis-ui-server/connectors-catalog'
import type { ConnectorWizardAction, ConnectorWizardState } from './state'

// Step 1 (Source): pick the POS connector. POS only this surface (no CSV tile). Selecting a
// tile records the connector and resets any connector-specific credential state (reducer). The
// per-step heading + description are rendered by the route (shared type scale), so this step is
// just the card grid. Cards are larger and descriptive: a 48px icon tile, a 15px/500 name, and a
// one-line muted description. Selected = a 2px info border + a check indicator (top-right).
export function SourceStep({
  state,
  dispatch,
}: {
  state: ConnectorWizardState
  dispatch: Dispatch<ConnectorWizardAction>
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Connector"
      className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4"
    >
      {CONNECTOR_ORDER.map((key) => {
        const spec = CONNECTOR_SPECS[key]
        const Icon = spec.icon
        const selected = state.connector === key
        return (
          <Card
            key={key}
            role="radio"
            aria-checked={selected}
            tabIndex={0}
            aria-label={spec.label}
            onClick={() => dispatch({ type: 'selectConnector', connector: key })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                dispatch({ type: 'selectConnector', connector: key })
              }
            }}
            className={cn(
              'cursor-pointer p-5 transition-colors',
              selected ? 'border-2 border-info' : 'hover:border-border-strong',
            )}
          >
            <CardContent className="flex flex-col gap-3 p-0">
              <div className="flex items-start justify-between">
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-12 items-center justify-center rounded-xl',
                    spec.iconBgClass,
                    spec.iconClass,
                  )}
                >
                  <Icon className="size-6" />
                </span>
                {selected ? <Check aria-hidden="true" className="size-5 text-info" /> : null}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-medium text-foreground">{spec.label}</span>
                <span className="text-caption leading-relaxed text-muted-foreground">
                  {spec.description}
                </span>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
