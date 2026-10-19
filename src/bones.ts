/** Joint operations. All keep the invariant parent < index (re-sorting and remapping when needed). */
import * as THREE from 'three'
import type { Clip, Model, Vec3 } from './model'

export function descendants(m: Model, b: number): number[] {
  const out: number[] = []
  m.bones.forEach((x, i) => { let p = x.parent; while (p >= 0) { if (p === b) { out.push(i); break } p = m.bones[p].parent } })
  return out
}

/** Reorder joints so every parent precedes its children; remaps parents, vertex bindings and keys. */
export function sortBones(m: Model) {
  const order: number[] = [], done = new Set<number>()
  const visit = (i: number, depth = 0) => { if (done.has(i) || depth > 1024) return; const p = m.bones[i].parent; if (p >= 0) visit(p, depth + 1); if (!done.has(i)) { done.add(i); order.push(i) } }
  m.bones.forEach((_, i) => visit(i))
  if (order.every((o, i) => o === i)) return
  const map: number[] = []
  order.forEach((o, i) => (map[o] = i))
  m.bones = order.map(o => ({ ...m.bones[o], parent: m.bones[o].parent >= 0 ? map[m.bones[o].parent] : -1 }))
  m.vbone = m.vbone.map(b => (b >= 0 ? map[b] : -1))
  for (const c of m.clips) { const k: Clip['keys'] = {}; Object.entries(c.keys).forEach(([b, v]) => (k[map[Number(b)]] = v)); c.keys = k }
}

/** Set a new parent (-1 = root). Refuses to parent a joint under itself or its own descendant. */
export function reparentBone(m: Model, b: number, parent: number): boolean {
  if (parent === b || (parent >= 0 && descendants(m, b).includes(parent))) return false
  m.bones[b].parent = parent
  sortBones(m)
  return true
}

const PAIRS: Record<string, string> = { Left: 'Right', Right: 'Left', left: 'right', right: 'left', LEFT: 'RIGHT', RIGHT: 'LEFT', L: 'R', R: 'L', l: 'r', r: 'l' }
/** "Arm.L" -> "Arm.R", "Left Leg" -> "Right Leg", "hand_r" -> "hand_l"; names without a side get ".R". */
export function mirrorName(name: string): string {
  // one pass so a swapped word is never swapped back
  const out = name
    .replace(/\b(Left|Right|left|right|LEFT|RIGHT)\b/g, w => PAIRS[w])
    .replace(/([._\s-])([LRlr])$/, (_, sep, s) => sep + PAIRS[s])
    .replace(/^([LRlr])([._\s-])/, (_, s, sep) => PAIRS[s] + sep)
  return out === name ? `${name}.R` : out
}

/**
 * Mirror joints across X = 0 (L/R naming). Each selected joint gets a mirrored twin; a twin's parent is the twin
 * of its parent when that was mirrored too, otherwise the same parent. Points bound to an original joint that lie
 * on the opposite side of X are rebound to its twin. Returns the new joint indices.
 */
export function mirrorJoints(m: Model, sel: number[]): number[] {
  const set = [...new Set(sel)].sort((a, b) => a - b)
  const twin = new Map<number, number>()
  for (const b of set) {
    const src = m.bones[b]
    const p = src.parent >= 0 && twin.has(src.parent) ? twin.get(src.parent)! : src.parent
    twin.set(b, m.bones.length)
    m.bones.push({ name: mirrorName(src.name), parent: p, pos: [-src.pos[0], src.pos[1], src.pos[2]] })
  }
  // originals without a side marker become .L so the pair reads Arm.L / Arm.R
  for (const b of set) if (mirrorName(m.bones[b].name) === `${m.bones[b].name}.R`) m.bones[b].name = `${m.bones[b].name}.L`
  m.vbone = m.vbone.map((b, i) => {
    const t = twin.get(b)
    if (t === undefined) return b
    const side = Math.sign(m.bones[b].pos[0]) || 1
    return Math.sign(m.verts[i][0]) === -side && Math.abs(m.verts[i][0]) > 1e-4 ? t : b
  })
  return set.map(b => twin.get(b)!)
}

function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const ab = b.clone().sub(a), t = ab.lengthSq() > 0 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1) : 0
  return p.distanceTo(a.clone().addScaledVector(ab, t))
}

/**
 * Auto-bind: each point goes to the joint whose bone (segment from the joint to its child, or the joint itself
 * for leaves) is nearest. A bone segment belongs to the parent joint, so the upper arm segment moves with the
 * shoulder joint. Weight 1, MilkShape-style. Only `verts` are changed.
 */
export function autoBind(m: Model, verts: number[]): number {
  if (!m.bones.length) return 0
  const segs: { j: number; a: THREE.Vector3; b: THREE.Vector3 }[] = []
  m.bones.forEach((bn, i) => {
    const kids = m.bones.map((c, ci) => ({ c, ci })).filter(x => x.c.parent === i)
    const a = new THREE.Vector3(...bn.pos)
    if (!kids.length) segs.push({ j: i, a, b: a.clone() })
    kids.forEach(k => segs.push({ j: i, a, b: new THREE.Vector3(...k.c.pos) }))
  })
  const p = new THREE.Vector3()
  for (const v of verts) {
    p.set(...(m.verts[v] as Vec3))
    let best = 0, bd = Infinity
    for (const s of segs) { const d = distToSegment(p, s.a, s.b); if (d < bd - 1e-9) { bd = d; best = s.j } }
    m.vbone[v] = best
  }
  return verts.length
}
