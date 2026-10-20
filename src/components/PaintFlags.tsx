import type { ReactNode } from 'react'
import { useStore } from '../store'

function Ico({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>{children}</svg>
}

/** Square icon toggles: mirror, pixel, and lock alpha. One copy, either on the texture bar or in the Brush panel. */
export function PaintFlags() {
  const p = useStore(s => s.paint)
  const setPaint = useStore(s => s.setPaint)
  const item = (on: boolean, test: string, title: string, icon: ReactNode, flip: () => void) => (
    <button type="button" className={`paint-opt ${on ? 'on' : ''}`} data-testid={test} title={title} aria-pressed={on} onClick={flip}>{icon}</button>
  )
  return (
    <div className="paint-flags" role="group" aria-label="Stroke options">
      {item(p.mirror, 'paint-mirror', 'Mirror X', <Ico><path d="M8 1.5v13" /><path d="M6.2 5.2 2.2 8l4 2.8zM9.8 5.2 13.8 8l-4 2.8z" fill="currentColor" stroke="none" /></Ico>, () => setPaint({ mirror: !p.mirror }))}
      {item(p.mirrorY, 'paint-mirror-y', 'Mirror Y (Alt+Y)', <Ico><path d="M1.5 8h13" /><path d="M5.2 6.2 8 2.2l2.8 4zM5.2 9.8 8 13.8l2.8-4z" fill="currentColor" stroke="none" /></Ico>, () => setPaint({ mirrorY: !p.mirrorY }))}
      {item(p.pixelPerfect, 'paint-pixel', 'Pixel', <Ico><rect x="2" y="2" width="5" height="5" /><rect x="9" y="2" width="5" height="5" /><rect x="2" y="9" width="5" height="5" /><rect x="9" y="9" width="5" height="5" /></Ico>, () => setPaint({ pixelPerfect: !p.pixelPerfect }))}
      {item(p.lockAlpha, 'paint-lock-alpha', 'Lock alpha', <Ico><rect x="3.5" y="7" width="9" height="6.5" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" /></Ico>, () => setPaint({ lockAlpha: !p.lockAlpha }))}
    </div>
  )
}
