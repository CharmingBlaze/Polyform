import { ArrowRight, Box, Check, Circle, Cylinder, FolderOpen } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { byId } from '../commands'
import { useStore, WORKSPACES, type Workspace } from '../store'
import { uvArea } from '../uvops'
import type { Model } from '../model'

export const WS_LABEL: Record<Workspace, string> = { model: 'Model', uv: 'UV', paint: 'Paint', rig: 'Rig', animate: 'Animate', export: 'Export' }

/** The workspace the tabs highlight: Animate mode always means Animate; Model mode never does. */
export const shownWorkspace = (w: Workspace, mode: 'model' | 'animate'): Workspace => (mode === 'animate' ? 'animate' : w === 'animate' ? 'model' : w)

/** Facts about the model the hints and the export checklist read. */
export function flowState(m: Model) {
  const faces = m.faces.length
  const noUV = m.faces.filter(f => Math.abs(uvArea(f.uv)) < 1e-9).length
  const images = m.materials.filter(mt => mt.texture).length
  const vcolor = m.faces.some(f => f.vc)
  const joints = m.bones.length
  const used = new Set(m.faces.flatMap(f => f.v))
  const bound = [...used].filter(v => m.vbone[v] >= 0).length
  const keyed = m.clips.filter(c => Object.values(c.keys).some(k => Object.keys(k).length) || Object.values(c.okeys).some(k => Object.keys(k).length)).length
  return { faces, noUV, images, vcolor, painted: images > 0 || vcolor, joints, points: used.size, bound, keyed, clips: m.clips.length }
}

/** Header tabs: Model → UV → Paint → Rig → Animate → Export, numbered to show the order. */
export function WorkspaceTabs() {
  const mode = useStore(s => s.mode)
  const ws = useStore(s => s.workspace)
  const setWorkspace = useStore(s => s.setWorkspace)
  const cur = shownWorkspace(ws, mode)
  return (
    <div className="seg ws-tabs" data-testid="workspaces">
      {WORKSPACES.map((w, i) => (
        <button key={w} className={cur === w ? 'on' : ''} data-testid={`ws-${w}`} title={`${WS_LABEL[w]} workspace`} onClick={() => setWorkspace(w)}>
          <span className="ws-n">{i + 1}</span>{WS_LABEL[w]}
        </button>
      ))}
    </div>
  )
}

const Act = ({ cmd, label, testid, primary, onClick }: { cmd?: string; label: string; testid: string; primary?: boolean; onClick?: () => void }) => (
  <button className={`hint-act ${primary ? 'primary' : ''}`} data-testid={testid} onClick={() => (onClick ? onClick() : cmd && byId[cmd]?.run())}>{label}</button>
)
const Next = ({ to }: { to: Workspace }) => (
  <button className="hint-act next" data-testid="hint-next" onClick={() => useStore.getState().setWorkspace(to)}>Next: {WS_LABEL[to]} <ArrowRight size={13} /></button>
)

/** One line under the header: what to do now in this workspace, with the next step one click away. */
export function HintBar() {
  const mode = useStore(s => s.mode)
  const ws = shownWorkspace(useStore(s => s.workspace), mode)
  const m = useStore(s => s.model)
  const version = useStore(s => s.version)
  const autoKey = useStore(s => s.autoKey)
  const f = useMemo(() => flowState(m), [m, version]) // eslint-disable-line react-hooks/exhaustive-deps
  let text: ReactNode, acts: ReactNode = null
  if (ws === 'model') {
    if (!f.faces) { text = 'Start with a primitive from the Create tab, a sample, or open a file.'; acts = <><Act onClick={() => useStore.getState().addPrimitive('box')} label="Add box" testid="hint-box" primary /><Act cmd="file.open" label="Open…" testid="hint-open" /></> }
    else { text = <>Shape it: <kbd>E</kbd> extrude · <kbd>Ctrl+R</kbd> loop cut · <kbd>K</kbd> knife · <kbd>G</kbd>/<kbd>R</kbd>/<kbd>S</kbd> transform · <kbd>Tab</kbd> cycles point / edge / face.</>; acts = <Next to="uv" /> }
  } else if (ws === 'uv') {
    if (!f.faces) text = 'Nothing to unwrap yet: add a shape in Model first.'
    else if (f.noUV) { text = `${f.noUV} face${f.noUV === 1 ? ' has' : 's have'} no UVs. Auto UV unwraps everything in one click.`; acts = <Act cmd="uv.auto" label="Auto UV" testid="hint-autouv" primary /> }
    else { text = 'UVs ready. Selection is shared with 3D: G/R/S move islands, L picks an island, mark seams and Pack in the toolbar.'; acts = <Next to="paint" /> }
  } else if (ws === 'paint') {
    if (!f.faces) text = 'Nothing to paint yet: add a shape in Model first.'
    else if (f.noUV) { text = 'Paint needs UVs to paint into an image (Vertex painting works without).'; acts = <Act cmd="uv.auto" label="Auto UV" testid="hint-autouv" primary /> }
    else if (!f.painted) text = 'Drag on the model to paint; the first stroke creates the image. Fill makes flat faces, Ctrl+click picks a colour.'
    else { text = 'Painted. Each stroke is one undo step; [ ] resize the brush; Mirror X paints both sides.'; acts = <Next to="rig" /> }
  } else if (ws === 'rig') {
    if (!f.joints) { text = 'Click in a view with the Joint tool to place a root joint; E extrudes a child joint, Shift+A adds one at the 3D cursor.'; acts = <Act cmd="tool.joint" label="Joint tool" testid="hint-joint" primary /> }
    else if (f.bound < f.points) { text = `${f.points - f.bound} of ${f.points} points are not bound to a joint. Auto bind gives each point its nearest bone.`; acts = <Act cmd="joint.autobind" label="Auto bind" testid="hint-autobind" primary /> }
    else { text = `Rigged: ${f.joints} joint${f.joints === 1 ? '' : 's'}, every point bound.`; acts = <Next to="animate" /> }
  } else if (ws === 'animate') {
    if (!f.keyed) { text = <>Pick a joint or object, move to a frame and pose it with <kbd>R</kbd> / <kbd>G</kbd>. {autoKey ? 'Auto-key (●) is on: every pose becomes a key.' : <>Press <kbd>I</kbd> to key, or turn on auto-key (●).</>}</>; acts = !autoKey ? <Act cmd="anim.autokey" label="Turn on auto-key" testid="hint-autokey" primary /> : null }
    else { text = 'Animated. Space plays; drag keys in the timeline; add clips for more actions.'; acts = <Next to="export" /> }
  } else {
    const item = (ok: boolean, label: string, opt = false) => <span className={`chk ${ok ? 'ok' : opt ? 'opt' : 'no'}`}>{ok ? <Check size={12} /> : <Circle size={10} />} {label}</span>
    text = <span className="checklist" data-testid="export-checklist">{item(f.faces > 0, `${f.faces} faces`)}{item(f.faces > 0 && !f.noUV, 'UVs', true)}{item(f.painted, 'painted', true)}{item(f.joints > 0 && f.bound === f.points, 'rigged', true)}{item(f.keyed > 0, `${f.keyed} animated clip${f.keyed === 1 ? '' : 's'}`, true)}</span>
    acts = <><Act cmd="file.glb" label="Export .glb" testid="hint-export" primary /><Act cmd="file.save" label="Save project" testid="hint-save" /></>
  }
  return (
    <div className="hint-bar" data-testid="hint-bar" data-ws={ws}>
      <b className="hint-ws">{WS_LABEL[ws]}</b>
      <span className="hint-text" data-testid="hint-text">{text}</span>
      <span className="grow" />
      {acts}
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
      </div>
    </div>
  )
}
