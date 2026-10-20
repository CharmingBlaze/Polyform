import { useEffect, useRef, useState } from 'react'
import { Viewport } from './components/Viewport'
import { Header, ToolRail, Palette, StatusBar, Toast, NumericPanel, Popup, DrawPanel, HelpPopover } from './components/Chrome'
import { SideIcons, Sidebar, Timeline } from './components/Panels'
import { panelKey, sideHandle, useSides } from './useLayout'
import { DialogHost } from './components/Modal'
import { PropertiesDialog } from './components/Properties'
import { UVEditor } from './components/UVEditor'
import { PaintCanvas, PaintDivider } from './components/PaintCanvas'
import { usePaintView } from './paintview'
import { EmptyScene } from './components/Workspace'
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
  const workspace = useStore(s => s.workspace)
  const animate = useStore(s => s.mode === 'animate')
  const paintView = usePaintView()
  const paintSpace = workspace === 'paint' && !uvSpace && !animate
  const timelineH = useStore(s => s.ui.timelineH)
  const showTimeline = useStore(s => !s.ui.timelineHidden) && animate
  const sides = useSides()
  useEffect(() => sceneManager.invalidate(), [maximized, layout, uvSpace, uvSplit, uvSwap, uvMax, showTimeline, timelineH, sides.leftW, sides.rightW, paintSpace, paintView.split, paintView.swap, paintView.max])
  // UV workspace: [3D preview | divider | UV editor], or mirrored with Swap; the UV editor gets ~2/3 by default
  const v3 = uvMax === '3d' ? 'minmax(0, 1fr)' : uvMax === 'uv' ? '0px' : `minmax(0, ${uvSplit}fr)`
  const vu = uvMax === 'uv' ? 'minmax(0, 1fr)' : uvMax === '3d' ? '0px' : `minmax(0, ${1 - uvSplit}fr)`
  const cols = uvSwap ? `${vu} 10px ${v3}` : `${v3} 10px ${vu}`
  const p3 = paintView.max === 'tex' ? '0px' : paintView.max === '3d' ? 'minmax(0, 1fr)' : `minmax(0, ${paintView.split}fr)`
  const pt = paintView.max === '3d' ? '0px' : paintView.max === 'tex' ? 'minmax(0, 1fr)' : `minmax(0, ${1 - paintView.split}fr)`
  const paintCols = paintView.swap ? `${pt} 10px ${p3}` : `${p3} 10px ${pt}`
  const swapped = (uvSpace && uvSwap) || (paintSpace && paintView.swap)

  // collapse / expand slides the columns (~120 ms, none with prefers-reduced-motion); drags resize instantly
  const [anim, setAnim] = useState(false)
  // only a toggle within one workspace slides; switching workspaces snaps to that workspace's layout
  const pk = panelKey({ uvSpace, workspace, mode: animate ? 'animate' : 'model' })
  const flags = `${pk}:${sides.leftCollapsed}${sides.rightCollapsed}`
  const [prevFlags, setPrevFlags] = useState(flags)
  if (prevFlags !== flags) { setPrevFlags(flags); if (prevFlags.split(':')[0] === pk) setAnim(true) }
  useEffect(() => { if (!anim) return; const t = setTimeout(() => setAnim(false), 180); return () => clearTimeout(t) }, [anim])
  // the views follow every size change (the slide, the window, the timeline)
  const viewsRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = viewsRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => sceneManager.invalidate())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
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
      <div className={`main ${anim ? 'anim' : ''}`} data-left={sides.leftCollapsed ? 'icons' : 'open'} data-right={sides.rightCollapsed ? 'icons' : 'open'} style={{ gridTemplateColumns: `${sides.leftW}px minmax(0, 1fr) ${sides.rightW}px` }}>
        <ToolRail />
        <div className="center" style={{ gridTemplateRows: showTimeline ? `minmax(0, 1fr) ${clampTimeline(timelineH)}px` : 'minmax(0, 1fr)' }}>
          <div className={`work ${uvSpace ? 'uv-space' : ''} ${paintSpace ? 'paint-space' : ''} ${swapped ? 'swap' : ''}`} style={uvSpace ? { gridTemplateColumns: cols } : paintSpace ? { gridTemplateColumns: paintCols } : undefined}>
            <div ref={viewsRef} className={`views layout-${maximized !== null ? '1' : layout} ${maximized !== null ? 'max' : ''}`} data-testid="views">
              <canvas className="gl" ref={el => { if (el) sceneManager.attach(el) }} />
              {[0, 1, 2, 3].map(i => <Viewport key={i} pane={i} />)}
              <EmptyScene />
            </div>
            {uvSpace && <>
              <UVDivider />
              <div className="uv-pane" data-testid="uv-pane">{uvMax !== '3d' && <UVEditor big />}</div>
            </>}
            {paintSpace && <>
              <PaintDivider />
              <div className="uv-pane paint-pane" data-testid="paint-pane">{paintView.max !== '3d' && <PaintCanvas />}</div>
            </>}
          </div>
          {showTimeline && <Timeline />}
        </div>
        {sides.rightCollapsed ? <div className="right-col collapsed" data-collapsed="true"><SideIcons /></div>
          : <div className="right-col"><div className="side-handle left" data-testid="side-handle" {...sideHandle('right', false)} /><Sidebar><DrawPanel /><NumericPanel /></Sidebar></div>}
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
