import { Navigate, Route, Routes } from 'react-router'

import { AuthBoundary } from '../auth/AuthBoundary'
import { AppLayout } from './AppLayout'
import { AuditLookup } from './AuditLookup'
import { DevLogin } from './DevLogin'
import { MappingReview } from './MappingReview'
import { NotFound } from './NotFound'
import { Placeholder } from './Placeholder'
import { QuarantineConsole } from './QuarantineConsole'
import { SampleUpload } from './SampleUpload'
import { SourcesIndex } from './SourcesIndex'

// Router-agnostic route registry. App.tsx wraps this in a BrowserRouter; tests
// wrap it in a MemoryRouter. /dev/login is public; everything under AuthBoundary
// requires a valid token. The index redirects to /sources (the Phase-1 entry);
// later screens are placeholders until their checkpoints.
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/dev/login" element={<DevLogin />} />
      <Route element={<AuthBoundary />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/sources" replace />} />
          <Route path="/sources" element={<SourcesIndex />} />
          <Route
            path="/sources/:sourceId/mappings"
            element={<Placeholder title="Mapping Versions (Checkpoint 5)" />}
          />
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
