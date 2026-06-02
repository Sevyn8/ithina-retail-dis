import { Route, Routes } from 'react-router'

import { AuthBoundary } from '../auth/AuthBoundary'
import { AppLayout } from './AppLayout'
import { DevLogin } from './DevLogin'
import { Home } from './Home'

// Router-agnostic route registry. App.tsx wraps this in a BrowserRouter for the
// real app; tests wrap it in a MemoryRouter. /dev/login is public; everything
// under AuthBoundary requires a valid token.
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/dev/login" element={<DevLogin />} />
      <Route element={<AuthBoundary />}>
        <Route element={<AppLayout />}>
          <Route index element={<Home />} />
        </Route>
      </Route>
    </Routes>
  )
}
