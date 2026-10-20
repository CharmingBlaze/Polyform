/**
 * File menu actions: unsaved-change tracking, New / Save / Save As / Exit, and file pickers per import kind.
 * "Unsaved" = the history revision moved since the last save / open / new (paint strokes and undo count too).
 */
import { useStore } from './store'
import { emptyModel } from './model'
import { exportGLB, exportGLTF, exportOBJ, importFile, saveProject } from './io'
import { ask } from './dialog'

const S = () => useStore.getState()
export const isDirty = () => S().histRev !== S().savedRev
export const markSaved = () => useStore.setState(s => ({ savedRev: s.histRev }))

/** File name stem for saves and exports: Save As name, else the scene name, else "model". */
export function fileStem() {
  const raw = S().fileName ?? S().model.props?.name ?? ''
  const clean = raw.replace(/\.polyform\.json$|\.json$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim()
  return clean && clean !== 'Untitled' ? clean : 'model'
}

export function saveFile() {
  saveProject(S().model, fileStem())
  markSaved()
  S().notify(`Saved ${fileStem()}.polyform.json`)
}

export async function saveAs(): Promise<boolean> {
  const r = await ask({ title: 'Save As', message: 'Download the project as:', input: { label: 'File name', value: fileStem() }, cancel: 'cancel',
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Save', value: 'save', primary: true }] })
  if (r.value !== 'save' || !r.text.trim()) return false
  useStore.setState({ fileName: r.text.trim() })
  saveFile()
  return true
}

/** If there are unsaved changes: Save / Don't save / Cancel. Resolves true when the caller may go on. */
export async function confirmDiscard(action: string): Promise<boolean> {
  if (!isDirty()) return true
  const r = await ask({ title: 'Unsaved changes', message: `Save changes to “${S().model.props?.name || 'Untitled'}” before you ${action}?`, cancel: 'cancel',
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Don’t save', value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }] })
  if (r.value === 'save') { saveFile(); return true }
  return r.value === 'discard'
}

function resetToEmpty() {
  S().loadModel(emptyModel())
  useStore.setState({ fileName: null })
  S().setWorkspace('model')
}

export async function newScene() {
  if (!(await confirmDiscard('start a new scene'))) return false
  resetToEmpty()
  S().notify('New scene')
  return true
}

/** Exit: save prompt, then close the tab; browsers only let scripts close windows they opened, so fall back to an empty scene. */
export async function exitApp(closeWindow: () => void = () => window.close(), isClosed: () => boolean = () => window.closed) {
  if (!(await confirmDiscard('exit'))) return 'cancelled'
  closeWindow()
  await new Promise(r => setTimeout(r, 250))
  if (isClosed()) return 'closed'
  resetToEmpty()
  S().notify('The browser keeps this tab open (a page may only close windows it opened itself), so the scene was cleared instead. Close the tab to quit.')
  return 'cleared'
}

export type ImportKind = 'any' | 'project' | 'gltf' | 'ms3d' | 'obj' | 'image'
const ACCEPT: Record<ImportKind, string> = {
  any: '.json,.glb,.gltf,.obj,.ms3d,.png,.jpg,.jpeg,.webp', project: '.json', gltf: '.glb,.gltf', ms3d: '.ms3d', obj: '.obj', image: '.png,.jpg,.jpeg,.webp',
}
/** Open the hidden file input with a filter for one kind (Open… = projects and everything importable). */
export function pickFile(kind: ImportKind = 'any') {
  const el = document.getElementById('file-open') as HTMLInputElement | null
  if (!el) return
  el.accept = ACCEPT[kind]
  el.click()
}

const guard = () => { if (!S().model.faces.length && !S().model.bones.length) { S().notify('Nothing to export yet — add a shape or open a sample'); return false } return true }
export async function exportAs(kind: 'glb' | 'gltf' | 'obj') {
  if (!guard()) return
  const name = fileStem()
  if (kind === 'obj') { exportOBJ(S().model, name); return S().notify(`Exported ${name}.obj`) }
  const w = await (kind === 'glb' ? exportGLB(S().model, name) : exportGLTF(S().model, name))
  S().notify(w.length ? `Exported ${name}.${kind} with ${w.length} warning(s): ${w[0]}` : `Exported ${name}.${kind}`)
}

/** A file chosen in the picker: a project replaces the scene (so offer to save first); meshes, rigs and images merge in. */
export async function openPicked(f: File) {
  const project = /\.json$/i.test(f.name)
  if (project && !(await confirmDiscard('open another project'))) return
  try {
    await importFile(f)
    if (project) { useStore.setState({ fileName: f.name.replace(/\.polyform\.json$|\.json$/i, '') }); markSaved() }
  } catch (err) { S().notify(String((err as Error).message || err)) }
}
