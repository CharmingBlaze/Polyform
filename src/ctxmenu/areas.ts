/**
 * Menus of the 2D areas: Outliner rows, the materials list, the timeline / dope sheet. Rows are registered commands
 * or the area's own existing actions (rename = the row's double-click, the eye button, timeline/edit.ts).
 */
import { useStore } from '../store'
import * as MT from '../materials'
import { deleteTimelineKeys, copyTimelineKeys, pasteTimelineKeys, duplicateTimelineKeys } from '../timeline/edit'
import { cmdItem, type CtxEntry, type CtxItem, type CtxMenu } from './menus'

const S = () => useStore.getState()
const local = (id: string, label: string, run: () => void, x: Partial<CtxItem> = {}): CtxItem => ({ id, label, run, noRepeat: true, ...x })
const items = (...xs: (CtxItem | null | false)[]) => xs.filter((x): x is CtxItem => !!x)
const dbl = (el: Element | null | undefined) => el?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))

/** The row element's menu, or null when it has none. Selects the row first (as a left click would) unless it's already selected. */
export function outlinerMenu(row: HTMLElement): CtxMenu | null {
  const id = row.dataset.testid ?? ''
  let m: RegExpMatchArray | null
  if (!row.classList.contains('on')) row.click()
  const rename = local('ol.rename', 'Rename', () => dbl(row.querySelector('.name')), { keys: 'Dbl-click' })
  if ((m = id.match(/^ol-obj-(\d+)$/))) {
    const i = +m[1], g = S().model.groups[i]
    const eye = row.querySelector<HTMLElement>(`[data-testid="ol-eye-${i}"]`)
    const faces = () => S().model.faces.map((f, fi) => (f.g === i ? fi : -1)).filter(fi => fi >= 0)
    const entries: CtxEntry[] = [
      { sep: true, label: 'Object' },
      ...items(rename, local('ol.visible', g?.visible === false ? 'Show' : 'Hide', () => eye?.click()),
        cmdItem('sel.hideOthers', { label: 'Isolate (hide others)' }),
        local('ol.faces', 'Edit its faces', () => { const st = S(); st.setSelectMode('face'); st.setSelection({ faces: faces() }) }, { hint: 'Face mode with these faces' }),
        cmdItem('view.frame', { label: 'Frame' })),
      { sep: true, label: 'Edit' },
      ...items(cmdItem('op.mul.duplicate', { label: 'Duplicate' }), cmdItem('obj.join', { label: 'Join' }), cmdItem('op.con.mergeGroups', { label: 'Merge objects' }), cmdItem('obj.separate', { label: 'Separate' }), cmdItem('edit.delete', { label: 'Delete' })),
    ]
    return { ctx: 'outliner.object', title: g?.name ?? 'Object', entries, repeat: false, filter: true, testid: 'ctx-menu' }
  }
  if ((m = id.match(/^ol-joint-(\d+)$/))) {
    const b = S().model.bones[+m[1]]
    const entries: CtxEntry[] = [
      { sep: true, label: 'Joint' },
      ...items(rename, cmdItem('joint.children', { label: 'Select children' }), cmdItem('joint.selectBound', { label: 'Select bound points' }), cmdItem('view.frame', { label: 'Frame' })),
      { sep: true, label: 'Rig' },
      ...items(cmdItem('joint.bind', { label: 'Bind selected points' }), cmdItem('joint.unbind', { label: 'Unbind' }), cmdItem('joint.mirror', { label: 'Mirror joints (L/R)' }), cmdItem('joint.symmetrize', { label: 'Symmetrize joints' }), cmdItem('edit.delete', { label: 'Delete' })),
    ]
    return { ctx: 'outliner.joint', title: b?.name ?? 'Joint', entries, repeat: false, filter: true, testid: 'ctx-menu' }
  }
  if ((m = id.match(/^ol-clip-(\d+)$/))) {
    const c = S().model.clips[+m[1]]
    return { ctx: 'outliner.clip', title: c?.name ?? 'Clip', entries: items(rename, local('ol.activate', 'Make active', () => row.click()), cmdItem('anim.play', { label: 'Play / pause' })), repeat: false, filter: false, testid: 'ctx-menu' }
  }
  return null
}

export function materialMenu(row: HTMLElement): CtxMenu | null {
  const m = (row.dataset.testid ?? '').match(/^mat-row-(\d+)$/)
  if (!m) return null
  const i = +m[1]
  useStore.setState({ activeMat: i })
  const st = S(), mats = st.model.materials
  const edit = (label: string, fn: (mm: typeof st.model) => void) => S().edit(fn, label)
  const entries: CtxEntry[] = [
    { sep: true, label: 'Material' },
    local('mat.assign', 'Assign to selection', () => S().assignMaterial(i), { why: st.selFaces.size ? null : 'Select faces first' }),
    local('mat.select', 'Select its faces', () => { const s = S(); const fs = MT.facesUsing(s.model, i); if (s.selectMode === 'object' || s.selectMode === 'joint') s.setSelectMode('face'); s.setSelection({ faces: fs }) }),
    local('mat.rename', 'Rename', () => setTimeout(() => dbl(document.querySelector(`[data-testid="mat-row-${i}"] .name`)), 0), { keys: 'Dbl-click' }),
    { sep: true, label: 'Library' },
    local('mat.new', 'New material', () => { let n = 0; edit('New material', mm => { n = MT.addMaterial(mm) }); useStore.setState({ activeMat: n }) }),
    local('mat.dup', 'Duplicate', () => { let n = 0; edit('Duplicate material', mm => { n = MT.duplicateMaterial(mm, i) }); useStore.setState({ activeMat: n }) }),
    local('mat.del', 'Delete', () => { edit('Delete material', mm => { MT.deleteMaterial(mm, i) }); useStore.setState({ activeMat: Math.max(0, i - 1) }) }, { why: mats.length < 2 ? 'The last material cannot be deleted' : null }),
  ]
  return { ctx: 'materials', title: mats[i]?.name ?? 'Material', entries, repeat: false, filter: false, testid: 'ctx-menu' }
}

const tlKey = (combo: string) => () => window.dispatchEvent(new CustomEvent('timeline-key', { detail: combo }))
export function timelineMenu(): CtxMenu {
  const st = S(), keys = st.animKeys.length
  const need = keys ? null : 'Select keys first'
  const entries: CtxEntry[] = [
    { sep: true, label: 'Keys' },
    ...items(cmdItem('anim.insertKey', { label: 'Insert key' }),
      local('tl.delete', 'Delete keys', deleteTimelineKeys, { keys: 'Del', why: need }),
      local('tl.copy', 'Copy keys', () => { if (!copyTimelineKeys()) S().copyPose() }, { keys: 'Ctrl+C', why: need }),
      local('tl.paste', 'Paste keys', () => pasteTimelineKeys(false), { keys: 'Ctrl+V', why: st.keyClipboard ? null : 'Copy keys first' }),
      local('tl.pasteMirror', 'Paste mirrored', () => pasteTimelineKeys(true), { keys: 'Ctrl+Shift+V', why: st.keyClipboard ? null : 'Copy keys first' }),
      local('tl.dup', 'Duplicate to playhead', duplicateTimelineKeys, { keys: 'Ctrl+D', why: need })),
    { sep: true, label: 'Timing' },
    ...items(local('tl.grab', 'Move keys', tlKey('G'), { keys: 'G', why: need }), local('tl.scale', 'Scale keys', tlKey('S'), { keys: 'S', why: need }),
      local('tl.ease', 'Ease…', tlKey('E'), { keys: 'E', why: need }), cmdItem('anim.scaleKeys', { label: 'Scale timing around playhead' }), local('tl.frame', 'Frame keys', tlKey('F'), { keys: 'F' })),
    { sep: true, label: 'Playback' },
    ...items(cmdItem('anim.play', { label: 'Play / pause' }), cmdItem('anim.toggleCurves', { label: 'Dope sheet / curves' }), cmdItem('anim.setSpeed', { label: 'Cycle speed' }), cmdItem('view.onion', { label: 'Onion skin' })),
  ]
  return { ctx: 'timeline', title: keys ? `Keys · ${keys}` : 'Timeline', entries, repeat: false, filter: true, testid: 'ctx-menu' }
}
