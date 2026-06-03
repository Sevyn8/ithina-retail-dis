import { Route, Routes } from 'react-router'

import { AuthBoundary } from '../auth/AuthBoundary'
import { AppLayout } from './AppLayout'
import { AuditLookup } from './AuditLookup'
import { Dashboard } from './Dashboard'
import { DevLogin } from './DevLogin'
import { MappingReview } from './MappingReview'
import { MappingVersions } from './MappingVersions'
import { NotFound } from './NotFound'
import { QuarantineConsole } from './QuarantineConsole'
import { SampleUpload } from './SampleUpload'
import { SourcesIndex } from './SourcesIndex'

// Router-agnostic route registry. App.tsx wraps this in a BrowserRouter; tests
// wrap it in a MemoryRouter. /dev/login is public; everything under AuthBoundary
// requires a valid token. The index `/` is the Tenant Dashboard (slice 21);
// /sources remains its own route. An unknown path renders the not-found state.
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/dev/login" element={<DevLogin />} />
      <Route element={<AuthBoundary />}>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="/sources" element={<SourcesIndex />} />
          <Route path="/sources/:sourceId/mappings" element={<MappingVersions />} />
          <Route path="/upload" element={<SampleUpload />} />
          <Route path="/upload/:sampleId/review" element={<MappingReview />} />
          <Route path="/quarantine" element={<QuarantineConsole />} />
          <Route path="/audit" element={<AuditLookup />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  )
}
