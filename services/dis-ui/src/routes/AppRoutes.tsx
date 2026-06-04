import { Route, Routes } from 'react-router'

import { AuthBoundary } from '../auth/AuthBoundary'
import { OpsBoundary } from '../auth/OpsBoundary'
import { AppLayout } from './AppLayout'
import { AuditLookup } from './AuditLookup'
import { ConnectorPicker } from './ConnectorPicker'
import { DevLogin } from './DevLogin'
import { IndexRoute } from './IndexRoute'
import { MappingReview } from './MappingReview'
import { MappingVersions } from './MappingVersions'
import { NotFound } from './NotFound'
import { Notifications } from './Notifications'
import { OpsFleet } from './OpsFleet'
import { OpsQuery } from './OpsQuery'
import { QuarantineConsole } from './QuarantineConsole'
import { SampleUpload } from './SampleUpload'
import { Shadow } from './Shadow'
import { SourceCreate } from './SourceCreate'
import { SourceEdit } from './SourceEdit'
import { SourcesIndex } from './SourcesIndex'
import { StyleReference } from '../_style/StyleReference'

// Router-agnostic route registry. App.tsx wraps this in a BrowserRouter; tests
// wrap it in a MemoryRouter. /dev/login is public; everything under AuthBoundary
// requires a valid token. The index `/` branches by persona (IndexRoute): tenant ->
// Tenant Dashboard, ops -> redirect to Ops Fleet. The /ops/* subtree is wrapped in
// OpsBoundary (ops-gated). An unknown path renders the not-found state.
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/dev/login" element={<DevLogin />} />
      {/* Dev-only style reference (redesign R1 de-risk gate). Public like /dev/login, NOT
          in the tenant/ops nav; renders the new visual language for light/dark review. */}
      <Route path="/dev/style" element={<StyleReference />} />
      <Route element={<AuthBoundary />}>
        <Route element={<AppLayout />}>
          <Route index element={<IndexRoute />} />
          {/* Connector picker (redesign R2): the "add a source" surface. Net-new; not in
              nav (the sidebar does not change). Entry points arrive in R4/R6. */}
          <Route path="/connect" element={<ConnectorPicker />} />
          <Route path="/sources" element={<SourcesIndex />} />
          <Route path="/sources/new" element={<SourceCreate />} />
          <Route path="/sources/:sourceId/edit" element={<SourceEdit />} />
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
            {/* Same components in ops mode (isOps branch): fleet-wide + tenant column. */}
            <Route path="quarantine" element={<QuarantineConsole />} />
            <Route path="audit" element={<AuditLookup />} />
            <Route path="query" element={<OpsQuery />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  )
}
