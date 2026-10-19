import { useEffect, useState } from 'react'
import { Viewport } from './components/Viewport'
import { Header, ToolRail, Palette, StatusBar, Toast, NumericPanel, Popup, DrawPanel } from './components/Chrome'
import { Sidebar, Timeline } from './components/Panels'
import { UVEditor } from './components/UVEditor'
import { EmptyScene, HintBar } from './components/Workspace'
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
  const uvSpace = useStore(s => s.uvSpace)
  const uvSplit = useStore(s => s.uvSplit)
  const uvMax = useStore(s => s.uvMax)
  useEffect(() => sceneManager.invalidate(), [maximized, layout, uvSpace, uvSplit, uvMax])
  const cols = uvMax === '3d' ? 'minmax(0, 1fr) 14px 0px' : uvMax === 'uv' ? '0px 14px minmax(0, 1fr)' : `minmax(0, ${uvSplit}fr) 14px minmax(0, ${1 - uvSplit}fr)`

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
      <HintBar />
      <div className="main">
        <ToolRail />
        <div className="center">
          <div className={`work ${uvSpace ? 'uv-space' : ''}`} style={uvSpace ? { gridTemplateColumns: cols } : undefined}>
            <div className={`views layout-${maximized !== null ? '1' : layout} ${maximized !== null ? 'max' : ''}`} data-testid="views">
              <canvas className="gl" ref={el => { if (el) sceneManager.attach(el) }} />
              {[0, 1, 2, 3].map(i => <Viewport key={i} pane={i} />)}
              <EmptyScene />
            </div>
            {uvSpace && <>
              <UVDivider />
              <div className="uv-pane" data-testid="uv-pane">{uvMax !== '3d' && <UVEditor big />}</div>
            </>}
          </div>
          <Timeline />
        </div>
        <div className="right-col"><DrawPanel /><NumericPanel /><Sidebar /></div>
      </div>
      <StatusBar />
      <Palette open={palette} onClose={() => setPalette(false)} />
      <Toast />
      <Popup />
      {dragging && <div className="dropzone"><div>Drop a .glb, .obj, project .json, or a PNG / JPEG / WebP image</div></div>}
    </div>
  )
}

/** Draggable divider of the UV workspace; double-click resets; the arrows maximize one side / restore. */
function UVDivider() {
  const uvMax = useStore(s => s.uvMax)
  const set = useStore(s => s.set)
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return
    const el = e.currentTarget, work = el.parentElement!.getBoundingClientRect()
    el.setPointerCapture(e.pointerId)
    const mv = (ev: PointerEvent) => set({ uvMax: null, uvSplit: Math.max(0.15, Math.min(0.85, (ev.clientX - work.left) / work.width)) })
    const upFn = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', upFn) }
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', upFn)
  }
  return (
    <div className="uv-divider" data-testid="uv-divider" onPointerDown={drag} onDoubleClick={() => set({ uvSplit: 0.5, uvMax: null })} title="Drag to resize · double-click to reset">
      <button data-testid="uv-max-uv" title={uvMax === 'uv' ? 'Restore' : 'Maximize the UV editor'} onClick={() => set({ uvMax: uvMax === 'uv' ? null : 'uv' })}>{uvMax === 'uv' ? '▸' : '◂'}</button>
      <button data-testid="uv-max-3d" title={uvMax === '3d' ? 'Restore' : 'Maximize the 3D view'} onClick={() => set({ uvMax: uvMax === '3d' ? null : '3d' })}>{uvMax === '3d' ? '◂' : '▸'}</button>
    </div>
  )
}
