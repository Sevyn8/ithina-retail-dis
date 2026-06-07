import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { __resetSampleStore, putSampleAnalysis } from '../lib/dis-ui-server/onboarding'
import type { SampleAnalysis } from '../lib/dis-ui-server/onboarding'
import { renderWithProviders } from '../test/renderWithProviders'
import { AppRoutes } from './AppRoutes'

const tenantSnapshot: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}

// A pre-parsed analysis seeded into the store (the SampleUpload -> MappingReview handoff in
// real use). Mirrors a real-shaped profile + endpoint suggestions; source "llm" so the R8
// fields (reasoning + alternatives) and the AI badge are exercised. alternatives are catalog
// KEYS (server list[str] shape).
const LLM_SEED: SampleAnalysis = {
  sample_id: 'smp_acme0001',
  status: 'ready',
  source: 'llm',
  model: 'gemini-2.5-flash',
  source_id: 'manual_csv_upload',
  template_name: 'Sales',
  row_count: 2,
  sample_rows: [
    { item_code: 'A123', qty: '12', txn_date: '03-12-2025', pos_terminal: 'T-2A' },
    { item_code: 'B456', qty: '3', txn_date: '04-12-2025', pos_terminal: 'T-2B' },
  ],
  columns: [
    {
      source_col: 'item_code',
      inferred_type: 'text',
      sample_values: ['A123'],
      null_pct: 0,
      proposed_canonical: 'sku_id',
      confidence: 0.98,
      transforms: [],
    },
    {
      source_col: 'qty',
      inferred_type: 'integer',
      sample_values: ['12'],
      null_pct: 0,
      proposed_canonical: 'quantity',
      confidence: 0.95,
      transforms: [],
    },
    {
      source_col: 'txn_date',
      inferred_type: 'datetime',
      sample_values: ['03-12-2025'],
      null_pct: 0.01,
      proposed_canonical: 'source_sale_timestamp',
      confidence: 0.62,
      transforms: [{ type: 'date_format', value: 'DD-MM-YYYY' }],
      reasoning:
        'Values look like dates in day-month-year order, so this maps to the sale timestamp.',
      alternatives: ['transaction_id'],
    },
    {
      source_col: 'pos_terminal',
      inferred_type: 'text',
      sample_values: ['T-2A'],
      null_pct: 0,
      proposed_canonical: 'transaction_id',
      confidence: 0.41,
      transforms: [],
      reasoning: 'Values look like terminal or register identifiers; the target is uncertain.',
      alternatives: ['sku_variant'],
    },
  ],
}

beforeEach(() => {
  __resetSampleStore()
  putSampleAnalysis(LLM_SEED)
})

function renderReview(sampleId: string) {
  return renderWithProviders(<AppRoutes />, {
    snapshot: tenantSnapshot,
    initialEntries: [`/upload/${sampleId}/review`],
  })
}

// qty -> quantity (number) needs a decimal_separator; txn_date -> source_sale_timestamp
// (datetime) needs a format + timezone. Declare them to pass the gate.
async function declareRequiredRules(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.selectOptions(await screen.findByLabelText('Decimal separator for qty'), '.')
  await user.selectOptions(screen.getByLabelText('Date format for txn_date'), '%d-%m-%Y')
  await user.selectOptions(screen.getByLabelText('Timezone for txn_date'), 'UTC')
}

describe('MappingReview (Review mapping / Preview / Go live)', () => {
  it('renders the per-column mapping for a seeded sample', async () => {
    renderReview('smp_acme0001')
    expect(await screen.findByRole('heading', { name: 'Review mapping' })).toBeInTheDocument()
    // column names appear in the sample-data preview header AND the cards, so allow multiple.
    expect(screen.getAllByText('item_code').length).toBeGreaterThan(0)
    expect(screen.getAllByText('txn_date').length).toBeGreaterThan(0)
  })

  it('flags low-confidence and very-low-confidence columns', async () => {
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    expect(screen.getByText(/Low confidence/)).toBeInTheDocument()
    expect(screen.getByText(/Very low confidence/)).toBeInTheDocument()
  })

  it('updates the draft when a canonical override changes', async () => {
    const user = userEvent.setup()
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    const select = screen.getByLabelText('Canonical for pos_terminal')
    await user.selectOptions(select, 'quantity')
    expect((select as HTMLSelectElement).value).toBe('quantity')
    await user.selectOptions(select, 'unit_sale_price')
    expect((select as HTMLSelectElement).value).toBe('unit_sale_price')
  })

  it('renders the client-side coercion preview rows on the Preview step', async () => {
    const user = userEvent.setup()
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    await declareRequiredRules(user)
    await user.click(screen.getByRole('button', { name: /continue to preview/i }))
    expect(await screen.findByRole('heading', { name: 'Preview' })).toBeInTheDocument()
    // Canonical-keyed projection: item_code -> sku_id keeps the raw text; txn_date ->
    // source_sale_timestamp coerces 03-12-2025 (%d-%m-%Y) to ISO 2025-12-03 (client-side).
    expect(screen.getAllByText('A123').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2025-12-03').length).toBeGreaterThan(0)
  })

  it('Go-live creates a LIVE template in one step with "Created and live" copy (no activate step)', async () => {
    const user = userEvent.setup()
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    await declareRequiredRules(user)
    await user.click(screen.getByRole('button', { name: /continue to preview/i }))
    await user.click(await screen.findByRole('button', { name: /go live/i }))
    const status = await screen.findByRole('status')
    // Create-as-ACTIVE (D88): live in one step, honest "Created and live" copy, no "(draft)"/"staged".
    expect(status).toHaveTextContent(/Created and live/i)
    expect(status).toHaveTextContent(/Sales/)
    expect(status).not.toHaveTextContent(/draft/i)
    expect(status).not.toHaveTextContent(/staged/i)
    // No draft -> activate ceremony: no Activate/Stage button, and the live confirmation shows.
    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stage' })).not.toBeInTheDocument()
    expect(screen.getByText(/New files for this source are now processed/)).toBeInTheDocument()
  })

  it('shows a clean empty state (not an error) for an unknown sample id', async () => {
    renderReview('smp_unknown')
    expect(await screen.findByRole('heading', { name: 'No analyzed sample' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upload a CSV' })).toHaveAttribute('href', '/upload')
  })

  // R8: the assistant reasoning + alternatives, presented as the assistant's view, optional.
  it('shows the assistant reasoning on low-confidence columns', async () => {
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    expect(screen.getByText(/Assistant:.*terminal or register/)).toBeInTheDocument()
    expect(screen.getByText(/Assistant:.*day-month-year/)).toBeInTheDocument()
  })

  it('offers the assistant alternatives as quick-picks (catalog keys, no fabricated percentage)', async () => {
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    const select = screen.getByLabelText('Canonical for pos_terminal')
    const altGroup = within(select).getByRole('group', { name: "Assistant's alternatives" })
    // The alternative renders as the catalog key EXACTLY (no fabricated "(20%)" the server
    // cannot supply); an exact-name match would fail if a percentage were appended.
    expect(within(altGroup).getByRole('option', { name: 'sku_variant' })).toBeInTheDocument()
  })

  it('degrades gracefully for a column with no reasoning/alternatives', async () => {
    const user = userEvent.setup()
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    expect(screen.getAllByText('item_code').length).toBeGreaterThan(0)
    await user.click(screen.getByLabelText('Change mapping for item_code'))
    const select = screen.getByLabelText('Canonical for item_code')
    expect(
      within(select).queryByRole('group', { name: "Assistant's alternatives" }),
    ).not.toBeInTheDocument()
  })

  it('selecting an alternative reuses the override path (draft updates)', async () => {
    const user = userEvent.setup()
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    const select = screen.getByLabelText('Canonical for pos_terminal')
    await user.selectOptions(select, 'sku_variant')
    expect((select as HTMLSelectElement).value).toBe('sku_variant')
  })

  it('offers canonical targets from the catalog, section-grouped, not the legacy list', async () => {
    const user = userEvent.setup()
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    await user.click(screen.getByLabelText('Change mapping for item_code'))
    const select = screen.getByLabelText('Canonical for item_code')
    expect(within(select).getByRole('group', { name: 'Sale event' })).toBeInTheDocument()
    expect(within(select).getByRole('group', { name: 'Change event' })).toBeInTheDocument()
    const values = within(select)
      .getAllByRole('option')
      .map((o) => o.getAttribute('value'))
    expect(values).toContain('sku_id')
    expect(values).toContain('quantity')
    expect(values).toContain('attribute_name')
    expect(values).not.toContain('store_id')
    expect(
      within(select).getAllByRole('option', { name: /SKU \* \(text\)/ }).length,
    ).toBeGreaterThan(0)
  })

  // T11: honest source labeling.
  it('shows an "AI" suggestions badge when the source is llm', async () => {
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    expect(screen.getByText('Suggestions: AI')).toBeInTheDocument()
  })

  it('shows a "basic match" badge and no AI prose when the source is fallback', async () => {
    const fallback: SampleAnalysis = {
      ...LLM_SEED,
      sample_id: 'smp_fallback',
      source: 'fallback',
      model: null,
      columns: LLM_SEED.columns.map((c) => ({
        ...c,
        reasoning: null, // fallback carries no reasoning
        alternatives: undefined,
      })),
    }
    putSampleAnalysis(fallback)
    renderReview('smp_fallback')
    await screen.findByRole('heading', { name: 'Review mapping' })
    expect(screen.getByText('Suggestions: basic match')).toBeInTheDocument()
    // No fabricated AI reasoning prose on the fallback path.
    expect(screen.queryByText(/Assistant:/)).not.toBeInTheDocument()
  })

  it('shows the sample-data preview (first rows + true row count) from the parse', async () => {
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    expect(screen.getByRole('heading', { name: 'Sample data' })).toBeInTheDocument()
    expect(screen.getByText(/First 2 of 2 rows/)).toBeInTheDocument()
    expect(screen.getAllByText('A123').length).toBeGreaterThan(0)
  })

  it('renders the honest analysis banner (real parse, no over-claim)', async () => {
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    expect(screen.getByText(/parsed and profiled in your browser/)).toBeInTheDocument()
  })

  it('presents both the maps-to-field and the format-rule parts', async () => {
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    expect(screen.getByLabelText('Canonical for qty')).toBeInTheDocument()
    expect(screen.getAllByText('Maps to field').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Format rule').length).toBeGreaterThan(0)
    expect(await screen.findByLabelText('Decimal separator for qty')).toBeInTheDocument()
    expect(screen.getAllByText('No locale rule needed').length).toBeGreaterThan(0)
  })

  // FM3 gate test: the mandatory locale rule blocks Continue until declared.
  it('requires a mandatory locale rule (with a visible example) and blocks Continue until declared', async () => {
    const user = userEvent.setup()
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    expect(await screen.findByLabelText('Decimal separator for qty')).toBeInTheDocument()
    expect(screen.getAllByText(/-> 1299\.50/).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /more examples/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /continue to preview/i })).toBeDisabled()
    await declareRequiredRules(user)
    expect(screen.getByRole('button', { name: /continue to preview/i })).toBeEnabled()
  })

  it('renders needs-review columns as full cards and auto-mapped columns condensed', async () => {
    const user = userEvent.setup()
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    expect(screen.getByText(/Needs your review/)).toBeInTheDocument()
    expect(screen.getByText(/Auto-mapped/)).toBeInTheDocument()
    expect(screen.getByLabelText('Change mapping for item_code')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Change mapping for item_code'))
    expect(screen.getByLabelText('Canonical for item_code')).toBeInTheDocument()
    expect(screen.getAllByText('Maps to field').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Format rule').length).toBeGreaterThan(0)
  })

  it('recomputes the required rule when the field mapping changes datatype', async () => {
    const user = userEvent.setup()
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    expect(screen.queryByLabelText('Decimal separator for pos_terminal')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Canonical for pos_terminal'), 'quantity')
    expect(await screen.findByLabelText('Decimal separator for pos_terminal')).toBeInTheDocument()
  })

  it('mounts under the dark theme class', async () => {
    const { container } = renderWithProviders(
      <div className="dark">
        <AppRoutes />
      </div>,
      { snapshot: tenantSnapshot, initialEntries: ['/upload/smp_acme0001/review'] },
    )
    expect(
      await within(container).findByRole('heading', { name: 'Review mapping' }),
    ).toBeInTheDocument()
  })
})
