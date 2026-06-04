import { Link } from 'react-router'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { HeroCard } from '@/components/ui/hero-card'
import { StatusBadge } from '../components/StatusBadge'
import { SOURCE_IDENTITIES, sourceIdentity } from '../components/source-identity'
import type { SourceTypeKey } from '../components/source-identity'
import { cn } from '@/lib/utils'

// Connector picker (redesign R2), the "add a source" surface, at /connect, on the new
// visual language. CSV upload is the full-width LIVE hero (routes toward the existing CSV
// journey entry, /upload); the POS/ERP connectors are honestly COMING-SOON (disabled, no
// faked connect). All four identities come from the single source-identity helper (FM3).
// Net-new: it changes no existing screen. The thin POS connect step is R5; the in-app
// entry points to this screen are R4 (manage sources) and R6 (Dashboard).

// The coming-soon POS/ERP connectors, in display order.
const POS_TYPES: SourceTypeKey[] = ['shopify_pos', 'square', 'other']

export function ConnectorPicker() {
  const csv = sourceIdentity('csv')
  return (
    <section className="flex flex-col gap-8">
      <header>
        <h1 className="text-display">Add a source</h1>
        <p className="text-caption text-muted-foreground">
          Every source feeds the same canonical sales data. Pick how yours arrives.
        </p>
      </header>

      {/* CSV: the live hero. The CTA routes toward the existing journey entry (/upload). */}
      <HeroCard
        identity={csv}
        title="CSV upload"
        description="Upload a sales export. We map it to the canonical schema, you approve, it goes live."
      >
        <div>
          <Link to="/upload" className={buttonVariants({ variant: 'default' })}>
            Upload a CSV
          </Link>
        </div>
      </HeroCard>

      {/* POS/ERP: coming-soon. No working or faked connect (FM2); the thin connect step is R5. */}
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-heading">Connect a POS or ERP system</h2>
          <p className="text-caption text-muted-foreground">
            Point-of-sale and ERP connectors for in-store sales. Coming soon.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {POS_TYPES.map((key) => {
            const identity = SOURCE_IDENTITIES[key]
            const Icon = identity.icon
            return (
              <Card key={identity.key}>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex size-9 items-center justify-center rounded-lg',
                        identity.bgSoftClass,
                        identity.textClass,
                      )}
                    >
                      <Icon className="size-5" />
                    </span>
                    <StatusBadge tone="neutral">Soon</StatusBadge>
                  </div>
                  <div className="text-body-strong">{identity.label}</div>
                  {/* Routes to the thin, coming-soon connect step (R5); no connect happens
                      here. The honesty (disabled shell) lives on the destination. */}
                  <Link
                    to={`/connect/${identity.key}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    Set up
                  </Link>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </section>
  )
}
