import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AuthSnapshot } from '../auth/AuthSnapshot'
import { renderWithProviders } from '../test/renderWithProviders'
import { AppRoutes } from './AppRoutes'

const ops: AuthSnapshot = {
  userId: 'u_opsdev0001',
  tenantId: null,
  storeId: null,
  roles: ['dis:ops', 'dis:read', 'dis:mapping_admin'],
}

function renderQuery() {
  return renderWithProviders(<AppRoutes />, { snapshot: ops, initialEntries: ['/ops/query'] })
}

describe('Ops DuckDB Query Panel (stubbed execution)', () => {
  it('renders the SQL editor and a Run action', async () => {
    const { container } = renderQuery()
    expect(await screen.findByRole('heading', { name: 'DuckDB Query Panel' })).toBeInTheDocument()
    expect(container.querySelector('.cm-editor')).not.toBeNull()
    expect(screen.getByRole('button', { name: /run/i })).toBeInTheDocument()
  })

  it('runs the sample query and renders a dynamic-columns grid', async () => {
    const user = userEvent.setup()
    renderQuery()
    await screen.findByRole('heading', { name: 'DuckDB Query Panel' })
    await user.click(screen.getByRole('button', { name: 'Sample' }))
    await user.click(screen.getByRole('button', { name: /run/i }))
    expect(await screen.findByRole('columnheader', { name: /tenant_id/ })).toBeInTheDocument()
    expect(screen.getByText('t_acme9k2l1mn4')).toBeInTheDocument()
  })

  it('renders the error state for the error query', async () => {
    const user = userEvent.setup()
    renderQuery()
    await screen.findByRole('heading', { name: 'DuckDB Query Panel' })
    await user.click(screen.getByRole('button', { name: 'Error query' }))
    await user.click(screen.getByRole('button', { name: /run/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Catalog Error/)
  })

  it('renders the empty state for the empty-result query', async () => {
    const user = userEvent.setup()
    renderQuery()
    await screen.findByRole('heading', { name: 'DuckDB Query Panel' })
    await user.click(screen.getByRole('button', { name: 'Empty' }))
    await user.click(screen.getByRole('button', { name: /run/i }))
    expect(await screen.findByRole('heading', { name: 'No rows' })).toBeInTheDocument()
  })
})
