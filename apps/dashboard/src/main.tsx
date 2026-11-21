import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Presentation from './Presentation.tsx'
import { DashboardErrorBoundary } from './DashboardErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DashboardErrorBoundary>{window.location.pathname === '/presentation' ? <Presentation /> : <App />}</DashboardErrorBoundary>
  </StrictMode>,
)
