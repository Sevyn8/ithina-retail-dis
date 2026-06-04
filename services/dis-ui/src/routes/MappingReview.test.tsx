import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { renderWithProviders } from '../test/renderWithProviders'
import { AppRoutes } from './AppRoutes'

const tenantSnapshot: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}

function renderReview(sampleId: string) {
  return renderWithProviders(<AppRoutes />, {
    snapshot: tenantSnapshot,
    initialEntries: [`/upload/${sampleId}/review`],
  })
}

// R3 reshaped these screens into the guided journey (Upload -> Review mapping -> Preview ->
// Go live behind the rail). The DATA assertions below are unchanged from before; only the
// step FLOW and the headings (selectors) are updated. The mapping data layer (onboarding.ts)
// is untouched; its own data tests live in lib/dis-ui-server/onboarding.test.ts.
describe('MappingReview (Review mapping / Preview / Go live)', () => {
  it('renders the per-column mapping for a known sample', async () => {
    renderReview('smp_acme0001')
    expect(await screen.findByRole('heading', { name: 'Review mapping' })).toBeInTheDocument()
    expect(screen.getByText('item_code')).toBeInTheDocument()
    expect(screen.getByText('txn_date')).toBeInTheDocument()
  })

  it('flags low-confidence and very-low-confidence columns', async () => {
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    // txn_date 0.62 -> low; pos_terminal 0.41 -> very low.
    expect(screen.getByText(/Low confidence/)).toBeInTheDocument()
    expect(screen.getByText(/Very low confidence/)).toBeInTheDocument()
  })

  it('updates the draft when a canonical override changes', async () => {
    const user = userEvent.setup()
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    const select = screen.getByLabelText('Canonical for pos_terminal')
    await user.selectOptions(select, 'store_id')
    expect((select as HTMLSelectElement).value).toBe('store_id')
    await user.selectOptions(select, 'unit_sale_price')
    expect((select as HTMLSelectElement).value).toBe('unit_sale_price')
  })

  it('renders dry-run preview rows on the Preview step', async () => {
    const user = userEvent.setup()
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    await user.click(screen.getByRole('button', { name: /continue to preview/i }))
    expect(await screen.findByRole('heading', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.getAllByText('A123').length).toBeGreaterThan(0)
  })

  it('approves to staged on Go live', async () => {
    const user = userEvent.setup()
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    await user.click(screen.getByRole('button', { name: /continue to preview/i }))
    await user.click(await screen.findByRole('button', { name: /go live/i }))
    expect(await screen.findByRole('status')).toHaveTextContent(/approved to staged \(version 1\)/i)
  })

  it('shows an error for an unknown sample id', async () => {
    renderReview('smp_unknown')
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the sample analysis/i)
  })

  // R8: the LLM-shaped suggestion fields (reasoning + alternatives), presented as the
  // assistant's view, optional and never fabricated.
  it('shows the assistant reasoning on low-confidence columns', async () => {
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    expect(screen.getByText(/Assistant:.*terminal identifiers/)).toBeInTheDocument()
    expect(screen.getByText(/Assistant:.*day-month-year/)).toBeInTheDocument()
  })

  it('offers the assistant alternatives as quick-picks in the canonical dropdown', async () => {
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    const select = screen.getByLabelText('Canonical for pos_terminal')
    // the alternative target is offered (assistant's alternatives group), e.g. transaction_id at 30%
    expect(within(select).getByRole('group', { name: "Assistant's alternatives" })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: /transaction_id \(30%\)/ })).toBeInTheDocument()
  })

  it('degrades gracefully for a column with no reasoning/alternatives', async () => {
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    // item_code (high confidence) has neither: it renders, with no assistant reasoning and a
    // plain canonical select (no alternatives optgroup)
    expect(screen.getByText('item_code')).toBeInTheDocument()
    const select = screen.getByLabelText('Canonical for item_code')
    expect(within(select).queryByRole('group', { name: "Assistant's alternatives" })).not.toBeInTheDocument()
  })

  it('selecting an alternative reuses the override path (draft updates)', async () => {
    const user = userEvent.setup()
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    const select = screen.getByLabelText('Canonical for pos_terminal')
    await user.selectOptions(select, 'transaction_id')
    expect((select as HTMLSelectElement).value).toBe('transaction_id')
  })

  it('renders the demo-data banner', async () => {
    renderReview('smp_acme0001')
    await screen.findByRole('heading', { name: 'Review mapping' })
    expect(screen.getByText(/Demo data\./)).toBeInTheDocument()
    expect(screen.getByText(/not parsed yet/)).toBeInTheDocument()
  })
})
