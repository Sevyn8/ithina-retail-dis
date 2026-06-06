import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { renderWithProviders } from '../test/renderWithProviders'
import { AppRoutes } from './AppRoutes'
import { CSV_JOURNEY_STEPS } from './csv-journey'

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}

// R3: the CSV upload-to-go-live flow reads as ONE rail-driven journey (FM4). The rail
// labels are the single shared CSV_JOURNEY_STEPS. Go live is honest mapping activation,
// not a faked ingestion monitor (FM3).
describe('CSV journey (one guided flow)', () => {
  it('renders the four-step journey rail with the shared labels', async () => {
    renderWithProviders(<AppRoutes />, { snapshot: tenant, initialEntries: ['/upload'] })
    await screen.findByRole('heading', { name: 'Create Template' })
    const rail = screen.getByRole('list', { name: 'Progress' })
    for (const label of CSV_JOURNEY_STEPS) {
      expect(within(rail).getByText(label)).toBeInTheDocument()
    }
  })

  it('advances Upload -> Review -> Preview -> Go live as one flow', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { snapshot: tenant, initialEntries: ['/upload'] })

    // Upload: a REAL CSV is parsed client-side (T11), then suggestions come from the
    // mechanical fallback (fixture mode), mapping qty -> quantity (number, decimal rule) and
    // txn_date -> source_sale_timestamp (datetime, format + timezone rule).
    await screen.findByRole('heading', { name: 'Create Template' })
    await user.upload(
      screen.getByLabelText('CSV file'),
      new File(['item_code,qty,txn_date\nA123,12,03-12-2025\nB456,3,04-12-2025\n'], 'sample.csv', {
        type: 'text/csv',
      }),
    )
    await user.type(screen.getByLabelText(/source name/i), 'POS-CSV-Main')
    await user.click(screen.getByRole('button', { name: /analyze sample/i }))

    // Review mapping: declare the mandatory locale rules (T3 gate) before proceeding -
    // qty -> quantity (number) needs a decimal separator; txn_date -> source_sale_timestamp
    // (datetime) needs a format + timezone.
    await screen.findByRole('heading', { name: 'Review mapping' })
    await user.selectOptions(await screen.findByLabelText('Decimal separator for qty'), '.')
    await user.selectOptions(screen.getByLabelText('Date format for txn_date'), '%d-%m-%Y')
    await user.selectOptions(screen.getByLabelText('Timezone for txn_date'), 'UTC')
    await user.click(screen.getByRole('button', { name: /continue to preview/i }))

    // Preview
    await screen.findByRole('heading', { name: 'Preview' })
    await user.click(screen.getByRole('button', { name: /go live/i }))

    // Go live: honest staged-activation state, no ingestion metrics
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/approved to staged \(version 1\)/i)
    expect(status).toHaveTextContent(/manual_csv_upload/)
    expect(screen.queryByText(/rows ingested|ingestion|throughput|events\/day/i)).not.toBeInTheDocument()
  })

  it('renders the journey under the dark theme class (both modes)', async () => {
    const { container } = renderWithProviders(
      <div className="dark">
        <AppRoutes />
      </div>,
      { snapshot: tenant, initialEntries: ['/upload'] },
    )
    expect(await within(container).findByRole('heading', { name: 'Create Template' })).toBeInTheDocument()
  })
})
