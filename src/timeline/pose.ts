/**
 * Animation clipboard: copy the pose at the playhead (or a set of keys) and paste it, optionally mirrored.
 * Everything here is pure (model in, plan out) so it can be unit tested; the store and edit.ts wrap a plan in one
 * undo step. Clipboard entries remember joint / object names, so a paste lands on the same-named joint even after
 * joints were added or reordered, or in another project with the same rig; a name that is not there is skipped.
 */
import { sampleBone, sampleObject, skinnedGroups } from '../anim'
import { mirrorName } from '../bones'
import type { Clip, Key, Model, OKey, Vec3 } from '../model'
import type { KeyClip } from '../store'
import { mirrorKey } from './keys'

/** The L/R partner name ("Arm.L" -> "Arm.R", "Left Leg" -> "Right Leg"); null for a name with no side (spine, root). */
export function mirrorPartner(name: string): string | null {
  const out = mirrorName(name)
  return out === `${name}.R` ? null : out
}

const cloneKey = (k: Key): Key => ({ rot: [...k.rot] as Vec3, pos: [...k.pos] as Vec3, ...(k.ease ? { ease: k.ease } : {}) })
const cloneOKey = (k: OKey): OKey => ({ pos: [...k.pos] as Vec3, rot: [...k.rot] as Vec3, scale: [...k.scale] as Vec3, ...(k.ease ? { ease: k.ease } : {}) })

/** Name tables for a clipboard built from `m`. */
export function clipNames(m: Model, kc: Pick<KeyClip, 'bones' | 'objects'>): NonNullable<KeyClip['names']> {
  const bones: Record<number, string> = {}, objects: Record<number, string> = {}
  for (const b of Object.keys(kc.bones)) if (m.bones[+b]) bones[+b] = m.bones[+b].name
  for (const g of Object.keys(kc.objects)) if (m.groups[+g]) objects[+g] = m.groups[+g].name
  return { bones, objects }
}

/**
 * The pose at `frame`: one key per joint in `bones` (the key on that frame when there is one, so its easing is kept,
 * else the interpolated pose, which is the rest pose for a joint with no keys), plus one key per keyed, unskinned
 * object in `groups`. Span 0, so it pastes onto the single frame under the playhead.
 */
export function capturePose(m: Model, clip: Clip, frame: number, bones: number[], groups: number[]): KeyClip {
  const kc: KeyClip = { bones: {}, objects: {}, span: 0 }
  for (const b of bones) {
    if (!m.bones[b]) continue
    const own = clip.keys[b]?.[frame]
    kc.bones[b] = { 0: own ? cloneKey(own) : cloneKey(sampleBone(clip, b, frame).key) }
  }
  const skinned = skinnedGroups(m)
  for (const g of groups) {
    if (!m.groups[g] || skinned.has(g)) continue
    const own = clip.okeys[g]?.[frame]
    const k = own ? cloneOKey(own) : sampleObject(clip, g, frame)
    if (k) kc.objects[g] = { 0: k }
  }
  kc.names = clipNames(m, kc)
  return kc
}

export interface PasteWrite { kind: 'bone' | 'obj'; index: number; frame: number; key: Key | OKey }
export interface PastePlan {
  writes: PasteWrite[]
  /** joints / objects the clipboard names that this model does not have (after the L/R swap when mirrored) */
  missing: string[]
  /** keys that would land past the clip's last frame */
  clipped: number
}

/**
 * Where each clipboard key lands when pasted at `frame`. Mirrored: a sided joint goes to its partner with the
 * transform flipped across X (pos.x, rot.y and rot.z negate; the project's mirror plane is X = 0), and a joint with
 * no side (spine, root) is flipped in place. Joints are matched by name; clipboards without names fall back to the
 * joint index.
 */
export function planPaste(m: Model, clip: Clip, kc: KeyClip, frame: number, mirror: boolean): PastePlan {
  const writes: PasteWrite[] = [], missing: string[] = []
  let clipped = 0
  const resolve = (list: { name: string }[], names: Record<number, string> | undefined, i: number): number | null => {
    const name = names?.[i]
    if (name === undefined) {
      // legacy clipboard (no names): same index, or the index of the partner when mirrored
      if (!list[i]) return null
      if (!mirror) return i
      const want = mirrorPartner(list[i].name)
      if (!want) return i
      const j = list.findIndex(x => x.name === want)
      return j >= 0 ? j : null
    }
    const want = mirror ? (mirrorPartner(name) ?? name) : name
    const j = list.findIndex(x => x.name === want)
    if (j < 0) { missing.push(want); return null }
    return j
  }
  const place = (kind: 'bone' | 'obj', dst: number, ks: Record<number, Key | OKey>) => {
    for (const [off, k] of Object.entries(ks)) {
      const fr = frame + +off
      if (fr < 0 || fr >= clip.frames) { clipped++; continue }
      const c = kind === 'bone' ? cloneKey(k as Key) : cloneOKey(k as OKey)
      writes.push({ kind, index: dst, frame: fr, key: mirror ? mirrorKey(c) : c })
    }
  }
  for (const [b, ks] of Object.entries(kc.bones)) {
    const dst = resolve(m.bones, kc.names?.bones, +b)
    if (dst !== null) place('bone', dst, ks)
  }
  const skinned = skinnedGroups(m)
  for (const [g, ks] of Object.entries(kc.objects)) {
    const dst = resolve(m.groups, kc.names?.objects, +g)
    if (dst !== null && !skinned.has(dst)) place('obj', dst, ks)
  }
  return { writes, missing: [...new Set(missing)], clipped }
}

/** Write a plan into a clip (inside the caller's undo step). */
export function applyPaste(clip: Clip, plan: PastePlan) {
  for (const w of plan.writes) {
    if (w.kind === 'bone') (clip.keys[w.index] ||= {})[w.frame] = w.key as Key
    else (clip.okeys[w.index] ||= {})[w.frame] = w.key as OKey
  }
}

/** Status line after a paste, e.g. "Pasted mirrored pose on 6 joints · skipped Tail.L (not in this rig)". */
export function pasteMessage(plan: PastePlan, kc: KeyClip, mirror: boolean): string {
  const what = kc.span === 0 ? 'pose' : 'keys'
  const targets = new Set(plan.writes.map(w => `${w.kind}:${w.index}`))
  const nb = [...targets].filter(t => t.startsWith('bone:')).length, no = targets.size - nb
  const on = [nb ? `${nb} joint${nb > 1 ? 's' : ''}` : '', no ? `${no} object${no > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ')
  const head = plan.writes.length
    ? kc.span === 0 ? `Pasted ${mirror ? 'mirrored ' : ''}${what} on ${on}` : `Pasted ${plan.writes.length} ${mirror ? 'mirrored ' : ''}key${plan.writes.length > 1 ? 's' : ''} on ${on}`
    : `Nothing pasted`
  const miss = plan.missing.length ? ` · skipped ${plan.missing.slice(0, 3).join(', ')}${plan.missing.length > 3 ? ` +${plan.missing.length - 3}` : ''} (not found)` : ''
  const past = plan.clipped ? ` · ${plan.clipped} past the clip end` : ''
  return head + miss + past
}
