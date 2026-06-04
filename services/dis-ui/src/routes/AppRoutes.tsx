import { Route, Routes } from 'react-router'

import { AuthBoundary } from '../auth/AuthBoundary'
import { OpsBoundary } from '../auth/OpsBoundary'
import { AppLayout } from './AppLayout'
import { AuditLookup } from './AuditLookup'
import { DevLogin } from './DevLogin'
import { IndexRoute } from './IndexRoute'
import { MappingReview } from './MappingReview'
import { MappingVersions } from './MappingVersions'
import { NotFound } from './NotFound'
import { Notifications } from './Notifications'
import { OpsFleet } from './OpsFleet'
import { QuarantineConsole } from './QuarantineConsole'
import { SampleUpload } from './SampleUpload'
import { Shadow } from './Shadow'
import { SourcesIndex } from './SourcesIndex'

// Router-agnostic route registry. App.tsx wraps this in a BrowserRouter; tests
// wrap it in a MemoryRouter. /dev/login is public; everything under AuthBoundary
// requires a valid token. The index `/` branches by persona (IndexRoute): tenant ->
// Tenant Dashboard, ops -> redirect to Ops Fleet. The /ops/* subtree is wrapped in
// OpsBoundary (ops-gated). An unknown path renders the not-found state.
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/dev/login" element={<DevLogin />} />
      <Route element={<AuthBoundary />}>
        <Route element={<AppLayout />}>
          <Route index element={<IndexRoute />} />
          <Route path="/sources" element={<SourcesIndex />} />
          <Route path="/sources/:sourceId/mappings" element={<MappingVersions />} />
          <Route path="/sources/:sourceId/shadow" element={<Shadow />} />
          <Route path="/upload" element={<SampleUpload />} />
          <Route path="/upload/:sampleId/review" element={<MappingReview />} />
          <Route path="/quarantine" element={<QuarantineConsole />} />
          <Route path="/audit" element={<AuditLookup />} />
          <Route path="/notifications" element={<Notifications />} />
          {/* Ops subtree: OpsBoundary gates ALL /ops/* (non-ops -> PermissionDenied). */}
          <Route path="/ops" element={<OpsBoundary />}>
            <Route path="fleet" element={<OpsFleet />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  )
}
