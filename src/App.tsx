import { useEffect, useState } from 'react'
import { Viewport } from './components/Viewport'
import { Header, ToolRail, Palette, StatusBar, Toast, NumericPanel, Popup, DrawPanel, HelpPopover } from './components/Chrome'
import { SideIcons, Sidebar, Timeline } from './components/Panels'
import { sideHandle, useSides } from './useLayout'
import { DialogHost } from './components/Modal'
import { PropertiesDialog } from './components/Properties'
import { UVEditor } from './components/UVEditor'
import { EmptyScene, HintBar } from './components/Workspace'
import { installShortcuts } from './commands'
import { importFile, restoreAutosave, startAutosave } from './io'
import { useStore } from './store'
import { addPrimitive } from './model'
import { sceneManager } from './scene'
import { clampTimeline, clampView3D, UV_VIEW3D_DEFAULT } from './prefs'

let booted = false

export default function App() {
  const [palette, setPalette] = useState(false)
  const [dragging, setDragging] = useState(false)
  const maximized = useStore(s => s.maximized)
  const layout = useStore(s => s.layout)
  const uvSpace = useStore(s => s.uvSpace)
  const uvSplit = useStore(s => s.ui.uvView3D)
  const uvSwap = useStore(s => s.ui.uvSwap)
  const uvMax = useStore(s => s.uvMax)
  const animate = useStore(s => s.mode === 'animate')
  const timelineH = useStore(s => s.ui.timelineH)
  const showTimeline = useStore(s => !s.ui.timelineHidden) && animate
  const sides = useSides()
  useEffect(() => sceneManager.invalidate(), [maximized, layout, uvSpace, uvSplit, uvSwap, uvMax, showTimeline, timelineH, sides.leftW, sides.rightW])
  // UV workspace: [3D preview | divider | UV editor], or mirrored with Swap; the UV editor gets ~2/3 by default
  const v3 = uvMax === '3d' ? 'minmax(0, 1fr)' : uvMax === 'uv' ? '0px' : `minmax(0, ${uvSplit}fr)`
  const vu = uvMax === 'uv' ? 'minmax(0, 1fr)' : uvMax === '3d' ? '0px' : `minmax(0, ${1 - uvSplit}fr)`
  const cols = uvSwap ? `${vu} 10px ${v3}` : `${v3} 10px ${vu}`

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
      <div className="main" style={{ gridTemplateColumns: `${sides.leftW}px minmax(0, 1fr) ${sides.rightW}px` }}>
        <ToolRail />
        <div className="center" style={{ gridTemplateRows: showTimeline ? `minmax(0, 1fr) ${clampTimeline(timelineH)}px` : 'minmax(0, 1fr)' }}>
          <div className={`work ${uvSpace ? 'uv-space' : ''} ${uvSpace && uvSwap ? 'swap' : ''}`} style={uvSpace ? { gridTemplateColumns: cols } : undefined}>
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
          {showTimeline && <Timeline />}
        </div>
        {sides.rightCollapsed ? <div className="right-col collapsed" data-collapsed="true"><SideIcons /></div>
          : <div className="right-col"><div className="side-handle left" data-testid="side-handle" {...sideHandle('right', false)} /><DrawPanel /><NumericPanel /><Sidebar /></div>}
      </div>
      <StatusBar />
      <Palette open={palette} onClose={() => setPalette(false)} />
      <HelpPopover />
      <PropertiesDialog />
      <DialogHost />
      <Toast />
      <Popup />
      {dragging && <div className="dropzone"><div>Drop a .glb / .gltf / .obj / .ms3d, a project .json, or a PNG / JPEG / WebP image</div></div>}
    </div>
  )
}

/** Draggable divider of the UV workspace (saved); double-click resets; buttons maximize either side and swap them. */
function UVDivider() {
  const uvMax = useStore(s => s.uvMax)
  const swap = useStore(s => s.ui.uvSwap)
  const set = useStore(s => s.set)
  const setUI = useStore(s => s.setUI)
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    const el = e.currentTarget, work = el.parentElement!.getBoundingClientRect()
    el.setPointerCapture(e.pointerId)
    const mv = (ev: PointerEvent) => { const f = (ev.clientX - work.left) / work.width; set({ uvMax: null }); setUI({ uvView3D: clampView3D(useStore.getState().ui.uvSwap ? 1 - f : f) }) }
    const upFn = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', upFn) }
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', upFn)
  }
  // arrows point the way the divider moves: towards the side that shrinks
  const uvSide = swap ? '◂' : '▸', d3Side = swap ? '▸' : '◂'
  return (
    <div className="uv-divider" data-testid="uv-divider" onPointerDown={drag} onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button')) { set({ uvMax: null }); setUI({ uvView3D: UV_VIEW3D_DEFAULT }) } }} title="Drag to resize · double-click to reset">
      <button data-testid="uv-max-uv" title={uvMax === 'uv' ? 'Restore' : 'Maximize the UV editor'} onClick={() => set({ uvMax: uvMax === 'uv' ? null : 'uv' })}>{uvMax === 'uv' ? uvSide : d3Side}</button>
      <button data-testid="uv-swap" title="Swap sides: 3D preview left / right" onClick={() => setUI({ uvSwap: !swap })}>⇄</button>
      <button data-testid="uv-max-3d" title={uvMax === '3d' ? 'Restore' : 'Maximize the 3D view'} onClick={() => set({ uvMax: uvMax === '3d' ? null : '3d' })}>{uvMax === '3d' ? d3Side : uvSide}</button>
    </div>
  )
}
