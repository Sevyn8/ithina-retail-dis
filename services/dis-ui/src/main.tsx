import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Geist under Vite (the DIS UI cannot use next/font). Fontsource registers the
// 'Geist Sans' / 'Geist Mono' families the --font-geist-* tokens bind to in index.css.
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-mono/400.css'

import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './theme/ThemeProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
