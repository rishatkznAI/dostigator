import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createPwaUpdateController } from './lib/pwa-update'
import { PwaUpdateNotice } from './components/PwaUpdateNotice'
import './styles.css'
import './training.css'
import App from './App.tsx'

const pwaUpdate = createPwaUpdateController()
// The network entry already loads the latest UI. Leave the waiting worker alone
// while legacy tabs may still contain unsaved forms; it can activate on close.
const freshEntry = window.location.pathname.endsWith('/auth/v1/open.html')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {!freshEntry && <PwaUpdateNotice controller={pwaUpdate} />}
    <App />
  </StrictMode>,
)
