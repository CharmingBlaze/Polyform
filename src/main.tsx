import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

if (import.meta.env.DEV) {
  import('./store').then(m => ((window as unknown as Record<string, unknown>).__polyform = m.useStore))
  // per-pane cameras, for e2e checks of the viewport controls
  import('./components/Viewport').then(m => ((window as unknown as Record<string, unknown>).__polyformViews = m.viewCtx))
  import('./paint').then(m => ((window as unknown as Record<string, unknown>).__polyformPaint = m.paintDebug))
  import('./store').then(m => ((window as unknown as Record<string, unknown>).__polyformHistory = m.history))
  import('./scene').then(m => ((window as unknown as Record<string, unknown>).__polyformScene = m.sceneManager))
}
