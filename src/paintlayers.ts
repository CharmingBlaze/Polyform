// Layer-stack and swatch edits for the Paint tab. One undo step each; pixel strokes stay in paint.ts.
import { BLENDS, type Blend } from './layers'
import { faceMat } from './model'
import { getMask, invertMask, setMask } from './selection'
import { history, useStore } from './store'
import { textures, type LayerSnap } from './textures'

let focused = ''
export const focusedPaintTex = () => focused
export const focusPaintTex = (id: string) => { focused = id }

const bump = () => useStore.setState(st => ({ histRev: st.histRev + 1, texRev: st.texRev + 1 }))
const touchView = () => useStore.setState(st => ({ texRev: st.texRev + 1 }))

function pushStack(id: string, before: LayerSnap, label: string) {
  history.pushTexture(useStore.getState().model, [{ id, x: 0, y: 0, data: new ImageData(new Uint8ClampedArray(4), 1, 1), stack: before }], label)
  bump()
}

export function addPaintLayer(id: string) {
  const before = textures.captureStack(id, false)
  if (!before) return
  const lid = textures.addLayer(id)
  if (!lid) { useStore.getState().notify(textures.layerCount(id) >= 16 ? '16 layers is the limit' : 'No image to add a layer to'); return }
  focusPaintTex(id)
  pushStack(id, before, 'Add layer')
}

export function deletePaintLayer(id: string, layerId: string) {
  if (textures.layerCount(id) < 2) { useStore.getState().notify('The last layer stays'); return }
  const before = textures.captureStack(id, true)
  if (!before || !textures.deleteLayer(id, layerId)) return
  focusPaintTex(id)
  pushStack(id, before, 'Delete layer')
}

export function duplicatePaintLayer(id: string) {
  const before = textures.captureStack(id, true)
  if (!before) return
  const lid = textures.duplicateLayer(id)
  if (!lid) { useStore.getState().notify(textures.layerCount(id) >= 16 ? '16 layers is the limit' : 'No image to duplicate'); return }
  focusPaintTex(id)
  pushStack(id, before, 'Duplicate layer')
}

export function placePaintLayer(id: string, layerId: string, to: number) {
  const before = textures.captureStack(id, false)
  if (!before || !textures.placeLayer(id, layerId, to)) return
  focusPaintTex(id)
  pushStack(id, before, 'Reorder layer')
}

export function movePaintLayer(id: string, layerId: string, dir: 1 | -1) {
  const before = textures.captureStack(id, false)
  if (!before || !textures.moveLayer(id, layerId, dir)) return
  focusPaintTex(id)
  pushStack(id, before, 'Reorder layer')
}

export function mergePaintLayer(id: string, layerId: string) {
  const before = textures.captureStack(id, true)
  if (!before || !textures.mergeDown(id, layerId)) { useStore.getState().notify('Merge needs a layer underneath'); return }
  focusPaintTex(id)
  pushStack(id, before, 'Merge down')
}

export function flattenPaintLayers(id: string) {
  if (textures.layerCount(id) < 2) return
  const before = textures.captureStack(id, true)
  if (!before || !textures.flatten(id)) return
  focusPaintTex(id)
  pushStack(id, before, 'Flatten layers')
}

export function togglePaintLayer(id: string, layerId: string) {
  const L = textures.layersOf(id).find(l => l.id === layerId)
  if (!L) return
  const before = textures.captureStack(id, false)
  if (!before || !textures.setLayer(id, layerId, { visible: !L.visible })) return
  focusPaintTex(id)
  pushStack(id, before, L.visible ? 'Hide layer' : 'Show layer')
}

export function renamePaintLayer(id: string, layerId: string, name: string) {
  const L = textures.layersOf(id).find(l => l.id === layerId)
  const next = name.trim().slice(0, 40)
  if (!L || !next || next === L.name) return
  const before = textures.captureStack(id, false)
  if (!before || !textures.setLayer(id, layerId, { name: next })) return
  pushStack(id, before, 'Rename layer')
}

export function activatePaintLayer(id: string, layerId: string) {
  if (!textures.setActive(id, layerId)) return
  focusPaintTex(id)
  touchView()
}

let armed: { id: string; snap: LayerSnap } | null = null
export function armLayerEdit(id: string) {
  const snap = textures.captureStack(id, false)
  if (snap) armed = { id, snap }
}
export function previewLayer(id: string, layerId: string, patch: { opacity?: number; blend?: Blend }) {
  if (!armed || armed.id !== id) armLayerEdit(id)
  textures.setLayer(id, layerId, patch)
  touchView()
}
export function endLayerEdit(label: string) {
  const a = armed
  armed = null
  if (!a) return
  const now = textures.captureStack(a.id, false)
  if (!now || JSON.stringify(now.layers.map(l => [l.id, l.name, l.visible, l.opacity, l.blend])) === JSON.stringify(a.snap.layers.map(l => [l.id, l.name, l.visible, l.opacity, l.blend])) && now.active === a.snap.active) return
  pushStack(a.id, a.snap, label)
}

export function clearPaintSelection(id: string) {
  setMask(id, null)
  touchView()
}
export function selectAllPaint(id: string) {
  const sz = textures.size(id)
  if (!sz) return
  setMask(id, new Uint8Array(sz.w * sz.h).fill(1))
  focusPaintTex(id)
  touchView()
}
export function invertPaintSelection(id: string) {
  const sz = textures.size(id)
  if (!sz) return
  const cur = getMask(id)
  const base = cur && cur.length === sz.w * sz.h ? cur : new Uint8Array(sz.w * sz.h)
  setMask(id, invertMask(base))
  focusPaintTex(id)
  touchView()
}

/** Options disclosure. Remembered for the session so a pen user is not sent back to the short panel. */
let optionsOpen = false
export const paintOptionsOpen = () => optionsOpen
export function setPaintOptionsOpen(on: boolean) {
  optionsOpen = on
  window.dispatchEvent(new Event('paint-options'))
}
export function togglePaintOptions() { setPaintOptionsOpen(!optionsOpen) }

/** The image the Paint tab is talking about: last painted, else the selected face, else the active material. */
export function shownPaintTex(): string | null {
  if (focused && textures.canvas(focused)) return focused
  const s = useStore.getState()
  const fi = [...s.selFaces].pop()
  if (fi !== undefined) {
    const f = s.model.faces[fi]
    const id = f ? s.model.materials[faceMat(s.model, f)]?.texture : undefined
    if (id && textures.canvas(id)) return id
  }
  const id = s.model.materials[s.activeMat]?.texture
  return id && textures.canvas(id) ? id : null
}

function withTex(fn: (id: string) => void) {
  const id = shownPaintTex()
  if (!id) { useStore.getState().notify('Paint on the model once to create an image'); return }
  fn(id)
}
const activeId = (id: string) => textures.layersOf(id).find(l => l.active)?.id ?? null

export const addPaintLayerHere = () => withTex(addPaintLayer)
export const flattenPaintLayersHere = () => withTex(flattenPaintLayers)
export const clearPaintSelectionHere = () => withTex(clearPaintSelection)
export const selectAllPaintHere = () => withTex(selectAllPaint)
export const invertPaintSelectionHere = () => withTex(invertPaintSelection)
export const deleteActivePaintLayer = () => withTex(id => { const lid = activeId(id); if (lid) deletePaintLayer(id, lid) })
export const mergeActivePaintLayer = () => withTex(id => { const lid = activeId(id); if (lid) mergePaintLayer(id, lid) })
export const moveActivePaintLayer = (dir: 1 | -1) => withTex(id => { const lid = activeId(id); if (lid) movePaintLayer(id, lid, dir) })
export const duplicateActivePaintLayer = () => withTex(duplicatePaintLayer)
export const toggleActivePaintLayer = () => withTex(id => { const lid = activeId(id); if (lid) togglePaintLayer(id, lid) })

/** Set the active layer's blend in one undo step. Reads the active layer at call time. */
export function setPaintBlend(id: string, blend: Blend) {
  const L = textures.layersOf(id).find(l => l.active)
  if (!L || L.blend === blend) return
  const before = textures.captureStack(id, false)
  if (!before || !textures.setLayer(id, L.id, { blend })) return
  focusPaintTex(id)
  pushStack(id, before, 'Layer blend')
}

/** One step through the short blend list. The bottom layer still shows its own pixels until something is under it. */
export function cyclePaintBlend(id?: string) {
  const tex = id ?? shownPaintTex()
  if (!tex) { useStore.getState().notify('Paint on the model once to create an image'); return }
  const L = textures.layersOf(tex).find(l => l.active)
  if (!L) return
  const next = BLENDS[(BLENDS.indexOf(L.blend) + 1) % BLENDS.length]
  const before = textures.captureStack(tex, false)
  if (!before || !textures.setLayer(tex, L.id, { blend: next })) return
  focusPaintTex(tex)
  pushStack(tex, before, 'Layer blend')
}

export function savePaintSwatch() {
  const s = useStore.getState(), c = s.paint.color
  if (s.paint.swatches.includes(c)) { s.notify('That colour is already a swatch'); return }
  if (s.paint.swatches.length >= 24) { s.notify('24 swatches is the limit'); return }
  s.setPaint({ swatches: [...s.paint.swatches, c] })
}
