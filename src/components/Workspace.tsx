import { Box, Circle, Cylinder, FolderOpen, PersonStanding, Wind } from 'lucide-react'
import { byId } from '../commands'
import { useStore, WORKSPACES, type Workspace } from '../store'

export const WS_LABEL: Record<Workspace, string> = { model: 'Model', uv: 'UV', paint: 'Paint', rig: 'Rig', animate: 'Animate', export: 'Export' }

/** The workspace the tabs highlight: Animate mode always means Animate; Model mode never does. */
export const shownWorkspace = (w: Workspace, mode: 'model' | 'animate'): Workspace => (mode === 'animate' ? 'animate' : w === 'animate' ? 'model' : w)

/** Header tabs: one per workspace; switching is free and each keeps its own layout. */
export function WorkspaceTabs() {
  const mode = useStore(s => s.mode)
  const ws = useStore(s => s.workspace)
  const setWorkspace = useStore(s => s.setWorkspace)
  const cur = shownWorkspace(ws, mode)
  return (
    <div className="seg ws-tabs" data-testid="workspaces">
      {WORKSPACES.map(w => (
        <button key={w} className={cur === w ? 'on' : ''} data-testid={`ws-${w}`} title={`${WS_LABEL[w]} workspace`} onClick={() => setWorkspace(w)}>
          {WS_LABEL[w]}
        </button>
      ))}
    </div>
  )
}

/** Shown over the views when there is nothing in the scene yet. */
export function EmptyScene() {
  const empty = useStore(s => s.model.faces.length === 0 && s.model.bones.length === 0 && !s.draw)
  useStore(s => s.version)
  if (!empty) return null
  const add = (k: 'box' | 'sphere' | 'cylinder') => useStore.getState().addPrimitive(k)
  return (
    <div className="empty-scene" data-testid="empty-scene">
      <div className="card">
        <div className="et">Empty scene</div>
        <div className="eb">Start from a primitive, a sample project, or a file (.glb, .gltf, .obj, .ms3d, project .json).</div>
        <div className="row">
          <button data-testid="empty-box" onClick={() => add('box')}><Box size={14} /> Box</button>
          <button data-testid="empty-sphere" onClick={() => add('sphere')}><Circle size={14} /> Sphere</button>
          <button data-testid="empty-cylinder" onClick={() => add('cylinder')}><Cylinder size={14} /> Cylinder</button>
          <button data-testid="empty-open" onClick={() => byId['file.open']?.run()}><FolderOpen size={14} /> Open…</button>
        </div>
        <div className="eb samples-label">Samples</div>
        <div className="row">
          <button className="primary" data-testid="empty-sample-character" onClick={() => useStore.getState().openSample('character')}><PersonStanding size={14} /> Character + walk</button>
          <button className="primary" data-testid="empty-sample-windmill" onClick={() => useStore.getState().openSample('windmill')}><Wind size={14} /> Windmill</button>
        </div>
      </div>
    </div>
  )
}
