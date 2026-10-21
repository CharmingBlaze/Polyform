import type { Ease, Key, OKey } from '../model'
import { useStore, type KeyClip } from '../store'
import { duplicateStart, keyId, nextFreeFrame, retimeKeys, type AnimKeyRef, type KeyMove } from './keys'
import { clipNames } from './pose'

let armed = false
/** True while G / S is waiting for a typed offset or Enter. Shortcuts must not reach the viewport. */
export const timelineArmed = () => armed
export function setTimelineArmed(on: boolean) { armed = on }

const read = (c: { keys: Record<number, Record<number, Key>>; okeys: Record<number, Record<number, OKey>> }, r: AnimKeyRef) =>
  r.kind === 'bone' ? c.keys[r.index]?.[r.frame] : c.okeys[r.index]?.[r.frame]

/** Delete the selected keys, or the key under the playhead when nothing is selected. */
export function deleteTimelineKeys() {
  const s = useStore.getState()
  if (!s.animKeys.length) { s.deleteKey(); return }
  const refs = s.animKeys
  s.edit(m => {
    const c = m.clips[s.clip]
    for (const r of refs) {
      const bag = r.kind === 'bone' ? c.keys[r.index] : c.okeys[r.index]
      if (bag) delete bag[r.frame]
    }
  }, 'Delete keys')
  s.set({ animKeys: [] })
}

/** Copy the selected keys, offsets relative to the earliest frame. False when nothing is selected. */
export function copyTimelineKeys(): boolean {
  const s = useStore.getState()
  if (!s.animKeys.length) return false
  const c = s.curClip()
  const lo = Math.min(...s.animKeys.map(k => k.frame))
  const hi = Math.max(...s.animKeys.map(k => k.frame))
  const clip: KeyClip = { bones: {}, objects: {}, span: hi - lo }
  for (const r of s.animKeys) {
    const k = read(c, r)
    if (!k) continue
    if (r.kind === 'bone') (clip.bones[r.index] ||= {})[r.frame - lo] = structuredClone(k)
    else (clip.objects[r.index] ||= {})[r.frame - lo] = structuredClone(k) as OKey
  }
  const n = Object.values(clip.bones).reduce((a, k) => a + Object.keys(k).length, 0) + Object.values(clip.objects).reduce((a, k) => a + Object.keys(k).length, 0)
  if (!n) return false
  clip.names = clipNames(s.model, clip)
  s.set({ keyClipboard: clip })
  s.notify(`Copied ${n} key${n > 1 ? 's' : ''}`)
  return true
}

/** Paste at the playhead, one undo step. Mirrored paste lands on the L/R partner and flips the pose across X. */
export function pasteTimelineKeys(mirror: boolean) {
  useStore.getState().pasteKeys(mirror)
}

/**
 * Duplicate keys, one undo step. With keys selected in the dope sheet: the earliest copy lands on the playhead, or,
 * when the playhead is on or inside the selection, right after its last key (the copy never overwrites its source).
 * With nothing selected: the keys on the playhead of the selected joints (all joints when none; selected objects in
 * Object mode) are copied to the next frame where those tracks have no key. The copies become the selection, and
 * the playhead follows them when they were offset, so pressing Ctrl+D again keeps stepping forward.
 */
export function duplicateTimelineKeys() {
  const s = useStore.getState()
  const c = s.curClip()
  const max = c.frames - 1
  let refs = s.animKeys.filter(r => read(c, r))
  let start: number | null
  if (refs.length) {
    const lo = Math.min(...refs.map(k => k.frame)), hi = Math.max(...refs.map(k => k.frame))
    start = duplicateStart(lo, hi, s.frame, max)
  } else {
    refs = keysAtPlayhead()
    if (!refs.length) { s.notify(`No keys at frame ${s.frame} to duplicate: select keys or key this frame first`); return }
    start = nextFreeFrame(c, refs, s.frame, max)
  }
  if (start === null) { s.notify('No room to duplicate: the copy would start past the last frame'); return }
  const lo = Math.min(...refs.map(k => k.frame))
  const jobs: { r: AnimKeyRef; dest: number; key: Key | OKey }[] = []
  let dropped = 0
  for (const r of refs) {
    const dest = start + (r.frame - lo)
    if (dest > max) { dropped++; continue }
    jobs.push({ r, dest, key: structuredClone(read(c, r)!) })
  }
  const next: AnimKeyRef[] = []
  s.edit(m => {
    const cc = m.clips[s.clip]
    for (const j of jobs) {
      if (j.r.kind === 'bone') (cc.keys[j.r.index] ||= {})[j.dest] = j.key as Key
      else (cc.okeys[j.r.index] ||= {})[j.dest] = j.key as OKey
      next.push({ kind: j.r.kind, index: j.r.index, frame: j.dest })
    }
  }, 'Duplicate keys')
  s.set({ animKeys: dedupe(next), ...(start !== s.frame ? { frame: start } : {}) })
  s.notify(`Duplicated ${jobs.length} key${jobs.length > 1 ? 's' : ''} to frame ${start}${dropped ? ` · ${dropped} past the clip end skipped` : ''}`)
}

/** Keys on the playhead for the current selection: selected joints (all when none), or selected objects. */
function keysAtPlayhead(): AnimKeyRef[] {
  const s = useStore.getState(), m = s.model, c = s.curClip(), f = s.frame
  const objMode = s.selectMode === 'object' && s.selFaces.size > 0
  const groups = objMode ? [...new Set([...s.selFaces].map(i => m.faces[i].g))] : m.bones.length ? [] : m.groups.map((_, i) => i)
  const bones = objMode ? [] : s.selBones.size ? [...s.selBones] : m.bones.map((_, i) => i)
  return [
    ...bones.filter(b => c.keys[b]?.[f]).map(index => ({ kind: 'bone' as const, index, frame: f })),
    ...groups.filter(g => c.okeys[g]?.[f]).map(index => ({ kind: 'obj' as const, index, frame: f })),
  ]
}

/** Ease on every selected key that already exists. Linear is stored by omitting ease. */
export function setKeyEase(refs: AnimKeyRef[], ease: Ease) {
  const s = useStore.getState()
  if (!refs.length) { s.notify('Select a key'); return }
  let n = 0
  s.edit(m => {
    const c = m.clips[s.clip]
    for (const r of refs) {
      if (r.kind === 'bone') {
        const k = c.keys[r.index]?.[r.frame]
        if (!k) continue
        const nk = { ...k, rot: [...k.rot] as typeof k.rot, pos: [...k.pos] as typeof k.pos }
        if (ease === 'linear') delete nk.ease
        else nk.ease = ease
        c.keys[r.index][r.frame] = nk
        n++
      } else {
        const k = c.okeys[r.index]?.[r.frame]
        if (!k) continue
        const nk = { ...k, pos: [...k.pos] as typeof k.pos, rot: [...k.rot] as typeof k.rot, scale: [...k.scale] as typeof k.scale }
        if (ease === 'linear') delete nk.ease
        else nk.ease = ease
        c.okeys[r.index][r.frame] = nk
        n++
      }
    }
  }, 'Key easing')
  if (!n) s.notify('No key on that frame')
}

/** Retime or scale. The whole gesture is one undo step; identical frames are left alone. */
export function commitMoves(moves: KeyMove[], label: string) {
  const s = useStore.getState()
  if (!moves.some(m => m.from !== m.to)) return
  s.edit(m => {
    const c = m.clips[s.clip]
    retimeKeys(c, moves, c.frames - 1)
  }, label)
  const max = s.curClip().frames - 1
  s.set({
    animKeys: dedupe(moves.map(mv => ({
      kind: mv.kind,
      index: mv.index,
      frame: Math.max(0, Math.min(max, Math.round(mv.to))),
    }))),
  })
}

function dedupe(refs: AnimKeyRef[]): AnimKeyRef[] {
  const seen = new Set<string>()
  const out: AnimKeyRef[] = []
  for (const r of refs) {
    const id = keyId(r)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(r)
  }
  return out
}
