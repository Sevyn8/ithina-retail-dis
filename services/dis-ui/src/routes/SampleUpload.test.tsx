import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { __resetSampleStore } from '../lib/dis-ui-server/onboarding'
import { renderWithProviders } from '../test/renderWithProviders'
import { AppRoutes } from './AppRoutes'

const tenantSnapshot: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}

const SAMPLE_CSV = 'item_code,qty,txn_date\nA123,12,03-12-2025\nB456,3,04-12-2025\n'

function sampleFile(): File {
  return new File([SAMPLE_CSV], 'sample.csv', { type: 'text/csv' })
}

beforeEach(() => {
  __resetSampleStore()
})

describe('SampleUpload', () => {
  it('renders the honest analysis banner on the upload step', async () => {
    renderWithProviders(<AppRoutes />, { snapshot: tenantSnapshot, initialEntries: ['/upload'] })
    await screen.findByRole('heading', { name: 'Create Template' })
    expect(screen.getByText(/parsed and profiled in your browser/)).toBeInTheDocument()
  })

  it('disables Analyze until a CSV file is selected (no-file empty state)', async () => {
    renderWithProviders(<AppRoutes />, { snapshot: tenantSnapshot, initialEntries: ['/upload'] })
    await screen.findByRole('heading', { name: 'Create Template' })
    expect(screen.getByRole('button', { name: /analyze sample/i })).toBeDisabled()
    expect(screen.getByText(/Select a CSV file to analyze/)).toBeInTheDocument()
  })

  it('parses a real CSV and advances to Review mapping with the real columns', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { snapshot: tenantSnapshot, initialEntries: ['/upload'] })
    expect(await screen.findByRole('heading', { name: 'Create Template' })).toBeInTheDocument()

    await user.upload(screen.getByLabelText('CSV file'), sampleFile())
    await user.type(screen.getByLabelText(/source name/i), 'POS-CSV-Main')
    await user.click(screen.getByRole('button', { name: /analyze sample/i }))

    // Lands on Review mapping with the REAL parsed columns (no demo).
    expect(await screen.findByRole('heading', { name: 'Review mapping' })).toBeInTheDocument()
    expect(screen.getAllByText('item_code').length).toBeGreaterThan(0)
    expect(screen.getAllByText('txn_date').length).toBeGreaterThan(0)
    // Local fixture mode -> mechanical fallback suggestions, honestly labeled.
    expect(screen.getByText('Suggestions: basic match')).toBeInTheDocument()
  })
})
