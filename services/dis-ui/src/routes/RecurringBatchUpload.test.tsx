import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { renderWithProviders } from '../test/renderWithProviders'
import { DisUiServerHttpError } from '../lib/dis-ui-server/client'
import type { CsvUploadResult } from '../lib/dis-ui-server/csv-uploads'
import { uploadCsvWithSessionToken } from '../lib/dis-ui-server/csv-uploads'
import { AppRoutes } from './AppRoutes'

// The real upload module is mocked here: the request-shape fidelity is proven in
// csv-uploads.test.ts (mocked fetch). This file drives the SCREEN: store picker, honest copy,
// gating, success and error rendering.
vi.mock('../lib/dis-ui-server/csv-uploads', () => ({
  uploadCsvWithSessionToken: vi.fn(),
}))
const mockUpload = vi.mocked(uploadCsvWithSessionToken)

const tenant: AuthSnapshot = {
  userId: 'u_acmeuser0001',
  tenantId: 't_acme9k2l1mn4',
  storeId: 's_acme0001a4b7',
  roles: ['dis:upload', 'dis:read'],
}
// mapping-templates.ts fixtures.
const SALES = '0190ac10-5a00-7000-8a00-0000000000a1' // active v2
const PRICING = '0190ac10-5a00-7000-8a00-0000000000a3' // draft only, no active version
const TEMPLATES = '/sources/manual_csv_upload/templates'

const RESULT: CsvUploadResult = {
  trace_id: '0190ac30-7c00-7000-8c00-0000000000d1',
  upload_id: 'us_abc123def456',
  tenant_id: 't_acme9k2l1mn4',
  store_id: '0190ac20-6b00-7000-8b00-0000000000c1',
  store_code: 'TX-102',
  source_id: 'manual_csv_upload',
  template_id: SALES,
  gcs_uri: 'gs://dis-bronze/tenant/x/source/manual_csv_upload/yyyy=2026/mm=06/dd=05/x.csv',
  row_count: 42,
  received_ts: '2026-06-05T10:00:00Z',
  status: 'received',
}

function render(path: string, dark = false) {
  return renderWithProviders(dark ? <div className="dark"><AppRoutes /></div> : <AppRoutes />, {
    snapshot: tenant,
    initialEntries: [path],
  })
}

beforeEach(() => {
  mockUpload.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('Ingest data (real csv-uploads wiring)', () => {
  // active-version gating on the surfaces
  it('offers "Ingest data" on the template detail, enabled for an active template', async () => {
    render(`${TEMPLATES}/${SALES}`)
    await screen.findByRole('heading', { name: 'Sales' })
    expect(screen.getByRole('link', { name: 'Ingest data' })).toBeInTheDocument()
  })

  it('disables "Ingest data" with a reason when the template has no active version', async () => {
    render(`${TEMPLATES}/${PRICING}`)
    await screen.findByRole('heading', { name: 'Pricing' })
    expect(screen.getByRole('button', { name: 'Ingest data' })).toBeDisabled()
    expect(screen.getByText(/No active version yet/)).toBeInTheDocument()
  })

  it('shows the action per-template in the templates list, gated by active version', async () => {
    render(TEMPLATES)
    await screen.findByRole('heading', { name: /Templates: manual_csv_upload/ })
    expect(screen.getAllByRole('link', { name: 'Ingest data' }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: 'Ingest data' })).toBeDisabled()
  })

  // honest copy + store picker + read-only context
  it('shows a store picker, the active mapping as context, and honest copy (no version-N claim)', async () => {
    render(`${TEMPLATES}/${SALES}/upload`)
    await screen.findByRole('heading', { name: 'Ingest data' })
    // store picker from stores-onboarded (only the ACTIVE coded store is offered)
    const store = screen.getByLabelText('Store')
    expect(within(store).getByRole('option', { name: /Acme Downtown #1 \(TX-102\)/ })).toBeInTheDocument()
    // honest framing: "uploaded against [template]", and an 8a caveat; NOT "will use ... v2"
    expect(screen.getByText(/uploaded against/i)).toBeInTheDocument()
    expect(screen.getByText(/not yet pinned to a specific template version/i)).toBeInTheDocument()
    expect(screen.queryByText(/will use .*v2/i)).not.toBeInTheDocument()
    // active mapping shown as read-only context (reused display), no editable review
    expect(screen.getByText('Field mappings')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Canonical for/)).not.toBeInTheDocument()
  })

  // confirm -> real call with the contract args; honest success copy
  it('uploads the file against the template for the chosen store, then shows an honest result', async () => {
    mockUpload.mockResolvedValueOnce(RESULT)
    const user = userEvent.setup()
    render(`${TEMPLATES}/${SALES}/upload`)
    await screen.findByRole('heading', { name: 'Ingest data' })

    await user.selectOptions(screen.getByLabelText('Store'), 'TX-102')
    await user.upload(
      screen.getByLabelText('CSV file'),
      new File(['a,b\n1,2\n'], 'batch.csv', { type: 'text/csv' }),
    )
    await user.click(screen.getByRole('button', { name: /upload and ingest/i }))

    expect(mockUpload).toHaveBeenCalledTimes(1)
    const arg = mockUpload.mock.calls[0][0]
    expect(arg.templateId).toBe(SALES)
    expect(arg.storeCode).toBe('TX-102')
    expect(arg.file).toBeInstanceOf(File)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/Uploaded 42 rows against Sales/)
    expect(status).toHaveTextContent(/not yet version-pinned/i)
  })

  it('surfaces a server 409 store-not-active as a clear error', async () => {
    mockUpload.mockRejectedValueOnce(
      new DisUiServerHttpError(409, 'store_state_conflict', 'not active', {}),
    )
    const user = userEvent.setup()
    render(`${TEMPLATES}/${SALES}/upload`)
    await screen.findByRole('heading', { name: 'Ingest data' })
    await user.selectOptions(screen.getByLabelText('Store'), 'TX-102')
    await user.upload(
      screen.getByLabelText('CSV file'),
      new File(['a,b\n1,2\n'], 'batch.csv', { type: 'text/csv' }),
    )
    await user.click(screen.getByRole('button', { name: /upload and ingest/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/store is not active/i)
  })

  it('guards direct navigation when the template has no active version', async () => {
    render(`${TEMPLATES}/${PRICING}/upload`)
    await screen.findByRole('heading', { name: 'Ingest data' })
    expect(screen.getByText(/No active version yet/)).toBeInTheDocument()
    expect(screen.queryByLabelText('CSV file')).not.toBeInTheDocument()
  })

  it('mounts under the dark theme class', async () => {
    const { container } = render(`${TEMPLATES}/${SALES}/upload`, true)
    expect(await within(container).findByRole('heading', { name: 'Ingest data' })).toBeInTheDocument()
  })
})
