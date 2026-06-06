import { render, screen, within } from '@testing-library/react'

import { ActiveMappingSummary } from './ActiveMappingSummary'
import { CATALOG_FIXTURE } from '../lib/dis-ui-server/mapping-fields'
import type { MappingTemplateVersion } from '../lib/dis-ui-server/mapping-templates'

// A minimal active version touching both concerns: two field mappings, and a format rule
// (normalize + cast) on quantity. Shaped to the real MappingTemplateVersion / raw-D49 rules.
const version: MappingTemplateVersion = {
  mapping_version_id: 1,
  version: 1,
  status: 'active',
  field_count: 2,
  transform_count: 2,
  predecessor_version_id: null,
  created_at: '2026-06-01T09:00:00Z',
  created_by_user_id: null,
  activated_at: '2026-06-01T09:05:00Z',
  deprecated_at: null,
  mapping_rules: {
    version: 1,
    rename: { item_code: 'sku_id', qty: 'quantity' },
    normalize: {
      quantity: [{ op: 'parse_decimal', args: { decimal_separator: '.', thousands_separator: null } }],
    },
    cast: { quantity: { type: 'integer' } },
    derive: {},
  },
}

// T8: the Field mappings + Format rules cards render as compact wrapping lines, NOT wide
// scrolling tables (FM2). This is the reused read-only summary (template detail + recurring
// upload), so the no-scroll guarantee lives here once.
describe('ActiveMappingSummary (T8 compact, no in-card scroll)', () => {
  it('renders the two concerns without any horizontal-scroll container (FM2)', () => {
    const { container } = render(<ActiveMappingSummary version={version} catalog={CATALOG_FIXTURE} />)
    // both concern cards present
    expect(screen.getByText('Field mappings')).toBeInTheDocument()
    expect(screen.getByText('Format rules')).toBeInTheDocument()
    // field mapping content: a source column maps to its catalog field
    expect(screen.getByText('item_code')).toBeInTheDocument()
    expect(screen.getByText('SKU *')).toBeInTheDocument()
    // format rule content: the real normalize op renders
    expect(screen.getByText(/parse_decimal/)).toBeInTheDocument()
    // FM2: no element opts into horizontal scrolling
    expect(container.querySelector('.overflow-x-auto')).toBeNull()
  })

  it('mounts under the dark theme class', () => {
    const { container } = render(
      <div className="dark">
        <ActiveMappingSummary version={version} catalog={CATALOG_FIXTURE} />
      </div>,
    )
    expect(within(container).getByText('Field mappings')).toBeInTheDocument()
    expect(container.querySelector('.overflow-x-auto')).toBeNull()
  })
})
