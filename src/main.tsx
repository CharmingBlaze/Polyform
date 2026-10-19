import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

if (import.meta.env.DEV) {
  import('./store').then(m => ((window as unknown as Record<string, unknown>).__polyform = m.useStore))
}
