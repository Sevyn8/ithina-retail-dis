import { Navigate } from 'react-router'

import { isOps } from '../auth/AuthSnapshot'
import { useAuth } from '../auth/useAuth'
import { Dashboard } from './Dashboard'

// The index route (`/`). A tenant persona lands on the Tenant Dashboard (unchanged).
// An ops persona is cross-tenant with a null tenant_id, so the tenant-scoped Dashboard
// is empty for them; they are redirected to Ops Fleet, their real landing (slice 24).
export function IndexRoute() {
  const { snapshot } = useAuth()
  if (snapshot !== null && isOps(snapshot)) {
    return <Navigate to="/ops/fleet" replace />
  }
  return <Dashboard />
}
