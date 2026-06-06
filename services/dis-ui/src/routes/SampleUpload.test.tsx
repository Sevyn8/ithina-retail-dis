import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { __resetSampleStore } from '../lib/dis-ui-server/onboarding'
import * as suggestions from '../lib/dis-ui-server/mapping-suggestions'
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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SampleUpload', () => {
  it('renders the honest analysis banner on the upload step', async () => {
    renderWithProviders(<AppRoutes />, { snapshot: tenantSnapshot, initialEntries: ['/upload'] })
    await screen.findByRole('heading', { name: 'New CSV Template' })
    expect(screen.getByText(/parsed and profiled in your browser/)).toBeInTheDocument()
  })

  it('removes the source-kind dropdown and the New/Existing attach toggle (source-controls simplification)', async () => {
    renderWithProviders(<AppRoutes />, { snapshot: tenantSnapshot, initialEntries: ['/upload'] })
    await screen.findByRole('heading', { name: 'New CSV Template' })
    expect(screen.queryByLabelText('Source kind')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /New source/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Existing source/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Existing source')).not.toBeInTheDocument()
  })

  it('derives the Source id from the Source name, keeps it editable, and validates the pattern', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { snapshot: tenantSnapshot, initialEntries: ['/upload'] })
    await screen.findByRole('heading', { name: 'New CSV Template' })
    const sourceId = screen.getByLabelText('Source id') as HTMLInputElement
    // derived from the source name
    await user.type(screen.getByLabelText(/source name/i), 'POS CSV Main')
    expect(sourceId.value).toBe('pos_csv_main')
    // editable + pattern-validated: an invalid id surfaces an error
    await user.clear(sourceId)
    await user.type(sourceId, 'Bad Id!')
    expect(screen.getByRole('alert')).toHaveTextContent(
      /lowercase letters, digits, and underscores/i,
    )
  })

  it('disables Analyze until a valid file AND a valid source id are present', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { snapshot: tenantSnapshot, initialEntries: ['/upload'] })
    await screen.findByRole('heading', { name: 'New CSV Template' })
    const analyze = screen.getByRole('button', { name: /analyze sample/i })
    expect(analyze).toBeDisabled() // no file, no id
    await user.upload(screen.getByLabelText('CSV file'), sampleFile())
    expect(analyze).toBeDisabled() // file but no source id yet
    await user.type(screen.getByLabelText('Source id'), 'manual_csv_upload')
    expect(analyze).toBeEnabled()
  })

  it('parses a real CSV and advances to Review mapping with the real columns', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { snapshot: tenantSnapshot, initialEntries: ['/upload'] })
    expect(await screen.findByRole('heading', { name: 'New CSV Template' })).toBeInTheDocument()

    await user.upload(screen.getByLabelText('CSV file'), sampleFile())
    await user.type(screen.getByLabelText(/source name/i), 'POS-CSV-Main')
    await user.click(screen.getByRole('button', { name: /analyze sample/i }))

    expect(await screen.findByRole('heading', { name: 'Review mapping' })).toBeInTheDocument()
    expect(screen.getAllByText('item_code').length).toBeGreaterThan(0)
    expect(screen.getAllByText('txn_date').length).toBeGreaterThan(0)
    expect(screen.getByText('Suggestions: basic match')).toBeInTheDocument()
  })

  // on-drop file card: selecting a file replaces the empty prompt with the file card (name).
  it('shows the file card with the filename after a file is selected', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { snapshot: tenantSnapshot, initialEntries: ['/upload'] })
    await screen.findByRole('heading', { name: 'New CSV Template' })
    expect(screen.getByText('Drag and drop or browse')).toBeInTheDocument()
    await user.upload(screen.getByLabelText('CSV file'), sampleFile())
    expect(screen.getByText('sample.csv')).toBeInTheDocument()
    expect(screen.queryByText('Drag and drop or browse')).not.toBeInTheDocument()
  })

  // in-flight: the client-side parse is labelled "Analyzing ...", NEVER "Uploading" (FM3); this
  // step parses in the browser, it does not upload. Freeze the step by hanging the suggestions
  // call so the analyzing state is observable.
  it('labels the in-flight client-side parse as "Analyzing...", not "Uploading"', async () => {
    vi.spyOn(suggestions, 'getMappingSuggestions').mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { snapshot: tenantSnapshot, initialEntries: ['/upload'] })
    await screen.findByRole('heading', { name: 'New CSV Template' })
    await user.upload(screen.getByLabelText('CSV file'), sampleFile())
    await user.type(screen.getByLabelText(/source name/i), 'POS-CSV-Main')
    await user.click(screen.getByRole('button', { name: /analyze sample/i }))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Analyzing sample.csv...')
    expect(status).not.toHaveTextContent(/Uploading/i)
  })
})
