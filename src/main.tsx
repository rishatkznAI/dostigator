import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createPwaUpdateController } from './lib/pwa-update'
import { PwaUpdateNotice } from './components/PwaUpdateNotice'
import './styles.css'
import './training.css'
import App from './App.tsx'

const pwaUpdate = createPwaUpdateController()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PwaUpdateNotice controller={pwaUpdate} />
    <App />
  </StrictMode>,
)
