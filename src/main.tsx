import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { getPwaUpdateController } from './lib/pwa-update'
import { PwaUpdateNotice } from './components/PwaUpdateNotice'
import './styles.css'
import './training.css'
import App from './App.tsx'

const pwaUpdate = getPwaUpdateController(registerSW)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PwaUpdateNotice controller={pwaUpdate} />
    <App />
  </StrictMode>,
)
