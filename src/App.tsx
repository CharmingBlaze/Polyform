import { useEffect, useState } from 'react'
import { Viewport } from './components/Viewport'
import { Header, ToolRail, Palette, StatusBar, Toast, NumericPanel, Popup } from './components/Chrome'
import { Sidebar, Timeline } from './components/Panels'
import { installShortcuts } from './commands'
import { importFile, restoreAutosave, startAutosave } from './io'
import { useStore } from './store'
import { addPrimitive } from './model'
import { sceneManager } from './scene'

let booted = false

export default function App() {
  const [palette, setPalette] = useState(false)
  const [dragging, setDragging] = useState(false)
  const maximized = useStore(s => s.maximized)
  const layout = useStore(s => s.layout)
  useEffect(() => sceneManager.invalidate(), [maximized, layout])

  useEffect(() => installShortcuts(() => setPalette(true)), [])
  useEffect(() => {
    if (booted) return
    booted = true
    restoreAutosave().then(ok => {
      if (!ok) { const s = useStore.getState(); const m = s.model; addPrimitive(m, 'box'); s.loadModel(m) }
      startAutosave()
    })
  }, [])

  return (
    <div className="app"
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={e => { e.preventDefault(); setDragging(false); [...e.dataTransfer.files].forEach(f => importFile(f).catch(err => useStore.getState().notify(String(err.message || err)))) }}>
      <Header onPalette={() => setPalette(true)} />
      <div className="main">
        <ToolRail />
        <div className="center">
          <div className={`views layout-${maximized !== null ? '1' : layout} ${maximized !== null ? 'max' : ''}`} data-testid="views">
            <canvas className="gl" ref={el => { if (el) sceneManager.attach(el) }} />
            {[0, 1, 2, 3].map(i => <Viewport key={i} pane={i} />)}
          </div>
          <Timeline />
        </div>
        <div className="right-col"><NumericPanel /><Sidebar /></div>
      </div>
      <StatusBar />
      <Palette open={palette} onClose={() => setPalette(false)} />
      <Toast />
      <Popup />
      {dragging && <div className="dropzone"><div>Drop a .glb, .obj, project .json, or a PNG / JPEG / WebP image</div></div>}
    </div>
  )
}
