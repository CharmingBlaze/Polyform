import { mirrorName } from '../bones'
import type { Clip, Ease, Key, OKey, Vec3 } from '../model'

/** One whole-pose key. Channel rows share it; the file still stores rot and pos together. */
export interface AnimKeyRef { kind: 'bone' | 'obj'; index: number; frame: number }

export const keyId = (k: AnimKeyRef) => `${k.kind}:${k.index}:${k.frame}`

export interface KeyMove { kind: 'bone' | 'obj'; index: number; from: number; to: number }

const cloneKey = (k: Key): Key => ({ rot: [...k.rot] as Vec3, pos: [...k.pos] as Vec3, ...(k.ease ? { ease: k.ease } : {}) })
const cloneOKey = (k: OKey): OKey => ({ pos: [...k.pos] as Vec3, rot: [...k.rot] as Vec3, scale: [...k.scale] as Vec3, ...(k.ease ? { ease: k.ease } : {}) })

/** Move whole-pose keys. Sources are copied first so a chain of moves cannot eat a key that has not been written yet. */
export function retimeKeys(clip: Clip, moves: KeyMove[], max: number) {
  type Slot = { kind: 'bone' | 'obj'; index: number; to: number; key: Key | OKey }
  const slots: Slot[] = []
  const seen = new Set<string>()
  for (const mv of moves) {
    const id = `${mv.kind}:${mv.index}:${mv.from}`
    if (seen.has(id)) continue
    seen.add(id)
    const to = Math.max(0, Math.min(max, Math.round(mv.to)))
    if (mv.kind === 'bone') {
      const k = clip.keys[mv.index]?.[mv.from]
      if (!k) continue
      slots.push({ kind: 'bone', index: mv.index, to, key: cloneKey(k) })
    } else {
      const k = clip.okeys[mv.index]?.[mv.from]
      if (!k) continue
      slots.push({ kind: 'obj', index: mv.index, to, key: cloneOKey(k) })
    }
  }
  for (const id of seen) {
    const [kind, index, from] = id.split(':')
    const bag = kind === 'bone' ? clip.keys[+index] : clip.okeys[+index]
    if (bag) delete bag[+from]
  }
  for (const s of slots) {
    if (s.kind === 'bone') (clip.keys[s.index] ||= {})[s.to] = s.key as Key
    else (clip.okeys[s.index] ||= {})[s.to] = s.key as OKey
  }
}

/** Scale a frame around the playhead and land on a whole frame. */
export function scaleFrame(frame: number, origin: number, factor: number, max: number) {
  return Math.max(0, Math.min(max, Math.round(origin + (frame - origin) * factor)))
}

/** Mirror a pose across X: position X flips, yaw and roll flip. Scale is unchanged. */
export function mirrorKey<T extends { rot: Vec3; pos: Vec3; scale?: Vec3; ease?: Ease }>(k: T): T {
  const out: T = { ...k, rot: [k.rot[0], -k.rot[1], -k.rot[2]] as Vec3, pos: [-k.pos[0], k.pos[1], k.pos[2]] as Vec3 }
  if (k.scale) out.scale = [...k.scale] as Vec3
  return out
}

/** Partner joint or object by L/R, Left/Right. Names with no side have no partner. */
export function mirrorIndex(names: { name: string }[], index: number): number | null {
  const name = names[index]?.name
  if (!name) return null
  const want = mirrorName(name)
  if (want === `${name}.R`) return null
  const i = names.findIndex(n => n.name === want)
  return i >= 0 && i !== index ? i : null
}
