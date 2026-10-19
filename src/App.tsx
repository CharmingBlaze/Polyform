import { useEffect, useState } from 'react'
import { Viewport } from './components/Viewport'
import { Header, ToolRail, Palette, StatusBar, Toast } from './components/Chrome'
import { Sidebar, Timeline } from './components/Panels'
import { installShortcuts } from './commands'
import { importFile, restoreAutosave, startAutosave } from './io'
import { useStore } from './store'
import { addPrimitive } from './model'

let booted = false

export default function App() {
  const [palette, setPalette] = useState(false)
  const [dragging, setDragging] = useState(false)
  const maximized = useStore(s => s.maximized)

  useEffect(() => installShortcuts(() => setPalette(true)), [])
  useEffect(() => {
    if (booted) return
    booted = true
    restoreAutosave().then(ok => {
      if (!ok) { const s = useStore.getState(); addPrimitive(s.model, 'box'); s.touch() }
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
          <div className={`views ${maximized ? 'max' : ''}`}>
            <Viewport view="top" />
            <Viewport view="persp" />
            <Viewport view="front" />
            <Viewport view="side" />
          </div>
          <Timeline />
        </div>
        <Sidebar />
      </div>
      <StatusBar />
      <Palette open={palette} onClose={() => setPalette(false)} />
      <Toast />
      {dragging && <div className="dropzone"><div>Drop a .glb, .obj, project .json, or texture image</div></div>}
    </div>
  )
}
