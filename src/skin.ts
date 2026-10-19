/**
 * Up to 4 bone influences per vertex (glTF JOINTS_0 / WEIGHTS_0).
 * `joints[i]` is a bone index or -1; unused slots have weight 0.
 * Unbound verts: all joints -1 / all weights 0 (no skin deform; export maps them to Root).
 * `vbone[i]` stays the primary joint (highest weight, or -1) for selection and older call sites.
 */
import type { Model, Skin, Vec3 } from './model'

export type { Skin }
export const unboundSkin = (): Skin => ({ joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] })
export const singleSkin = (bone: number): Skin => (bone < 0 ? unboundSkin() : { joints: [bone, -1, -1, -1], weights: [1, 0, 0, 0] })

/** Joint with the highest weight, or -1 when unbound. */
export function primaryJoint(s: Skin): number {
  let best = -1, bw = 0
  for (let i = 0; i < 4; i++) if (s.joints[i] >= 0 && s.weights[i] > bw) { bw = s.weights[i]; best = s.joints[i] }
  return best
}

export const isBound = (s: Skin | undefined) => !!s && primaryJoint(s) >= 0

/** Keep `vbone` in sync with `skin` (call after any skin edit). */
export function syncVbone(m: Model) {
  if (!m.skin || m.skin.length !== m.verts.length) ensureSkin(m)
  m.vbone = m.skin.map(primaryJoint)
}

/** Ensure every vertex has a skin entry; heal slots where only vbone was written. */
export function ensureSkin(m: Model) {
  if (!m.skin) m.skin = []
  while (m.skin.length < m.verts.length) m.skin.push(singleSkin(m.vbone[m.skin.length] ?? -1))
  if (m.skin.length > m.verts.length) m.skin.length = m.verts.length
  if (m.vbone.length !== m.verts.length) {
    while (m.vbone.length < m.verts.length) m.vbone.push(-1)
    m.vbone.length = m.verts.length
  }
  for (let i = 0; i < m.verts.length; i++) {
    const vb = m.vbone[i] ?? -1
    if (primaryJoint(m.skin[i]) < 0 && vb >= 0) m.skin[i] = singleSkin(vb)
  }
}

/** Bind a vertex 100% to one joint (or unbind when bone < 0). */
export function setVertBone(m: Model, v: number, bone: number) {
  ensureSkin(m)
  m.skin[v] = singleSkin(bone)
  m.vbone[v] = bone < 0 ? -1 : bone
}

/** Copy skin of `src` onto a newly pushed vertex (caller already pushed verts/vbone). */
export function pushSkinCopy(m: Model, src: number) {
  ensureSkin(m)
  const s = m.skin[src] ?? singleSkin(m.vbone[src] ?? -1)
  m.skin.push({ joints: [...s.joints] as Skin['joints'], weights: [...s.weights] as Skin['weights'] })
}

/** Normalize positive weights to sum 1; drop tiny weights; compact into the first slots. */
export function normalizeSkin(s: Skin): Skin {
  const items: { j: number; w: number }[] = []
  for (let i = 0; i < 4; i++) if (s.joints[i] >= 0 && s.weights[i] > 1e-6) items.push({ j: s.joints[i], w: s.weights[i] })
  // merge duplicate joints
  const merged = new Map<number, number>()
  for (const it of items) merged.set(it.j, (merged.get(it.j) ?? 0) + it.w)
  const sorted = [...merged.entries()].map(([j, w]) => ({ j, w })).sort((a, b) => b.w - a.w).slice(0, 4)
  const sum = sorted.reduce((a, x) => a + x.w, 0)
  const out = unboundSkin()
  if (sum <= 1e-6) return out
  sorted.forEach((x, i) => { out.joints[i] = x.j; out.weights[i] = x.w / sum })
  return out
}

/**
 * Lerp two skins (for topology splits). Combines influences, keeps top 4 by weight.
 */
export function lerpSkin(a: Skin, b: Skin, t: number): Skin {
  const w = new Map<number, number>()
  const add = (s: Skin, k: number) => {
    for (let i = 0; i < 4; i++) if (s.joints[i] >= 0 && s.weights[i] > 0) w.set(s.joints[i], (w.get(s.joints[i]) ?? 0) + s.weights[i] * k)
  }
  add(a, 1 - t); add(b, t)
  const sorted = [...w.entries()].map(([j, ww]) => ({ j, w: ww })).sort((x, y) => y.w - x.w).slice(0, 4)
  const sum = sorted.reduce((a, x) => a + x.w, 0)
  const out = unboundSkin()
  if (sum <= 1e-6) return out
  sorted.forEach((x, i) => { out.joints[i] = x.j; out.weights[i] = x.w / sum })
  return out
}

/**
 * Weight-paint a vertex toward `bone`.
 * - add: raise bone's weight by `strength` (0..1), renormalize
 * - subtract: lower bone's weight, renormalize (may unbind if all gone)
 * - replace: set bone to `strength`, scale others to fill the rest
 */
export function paintVertWeight(s: Skin, bone: number, strength: number, mode: 'add' | 'subtract' | 'replace'): Skin {
  if (bone < 0) return s
  const a = Math.max(0, Math.min(1, strength))
  const cur = new Map<number, number>()
  for (let i = 0; i < 4; i++) if (s.joints[i] >= 0 && s.weights[i] > 0) cur.set(s.joints[i], (cur.get(s.joints[i]) ?? 0) + s.weights[i])
  const have = cur.get(bone) ?? 0
  if (mode === 'add') cur.set(bone, Math.min(1, have + a))
  else if (mode === 'subtract') {
    const next = Math.max(0, have - a)
    if (next <= 1e-6) cur.delete(bone); else cur.set(bone, next)
  } else {
    // replace: bone gets `a`, others share (1-a) in their previous proportions
    const others = [...cur.entries()].filter(([j]) => j !== bone)
    const oSum = others.reduce((t, [, w]) => t + w, 0)
    cur.clear()
    if (a > 1e-6) cur.set(bone, a)
    const rem = 1 - a
    if (rem > 1e-6 && oSum > 1e-6) others.forEach(([j, w]) => cur.set(j, (w / oSum) * rem))
  }
  const sorted = [...cur.entries()].map(([j, w]) => ({ j, w })).sort((x, y) => y.w - x.w).slice(0, 4)
  const sum = sorted.reduce((t, x) => t + x.w, 0)
  const out = unboundSkin()
  if (sum <= 1e-6) return out
  sorted.forEach((x, i) => { out.joints[i] = x.j; out.weights[i] = x.w / sum })
  return out
}

/** Weight of `bone` on a vertex (0 if absent). */
export function weightOf(s: Skin, bone: number): number {
  let w = 0
  for (let i = 0; i < 4; i++) if (s.joints[i] === bone) w += s.weights[i]
  return w
}

/** Remap joint indices after bone reorder/delete (`map[old] = new`, missing => drop). */
export function remapSkin(s: Skin, map: (old: number) => number): Skin {
  const cur = new Map<number, number>()
  for (let i = 0; i < 4; i++) {
    if (s.joints[i] < 0 || s.weights[i] <= 0) continue
    const n = map(s.joints[i])
    if (n < 0) continue
    cur.set(n, (cur.get(n) ?? 0) + s.weights[i])
  }
  const sorted = [...cur.entries()].map(([j, w]) => ({ j, w })).sort((a, b) => b.w - a.w).slice(0, 4)
  const sum = sorted.reduce((t, x) => t + x.w, 0)
  const out = unboundSkin()
  if (sum <= 1e-6) return out
  sorted.forEach((x, i) => { out.joints[i] = x.j; out.weights[i] = x.w / sum })
  return out
}


/** Append a vertex with a single-bone binding (or unbound). Returns the new index. */
export function appendVert(m: Model, p: Vec3, bone = -1): number {
  ensureSkin(m)
  m.verts.push([p[0], p[1], p[2]])
  m.skin.push(singleSkin(bone))
  m.vbone.push(bone < 0 ? -1 : bone)
  return m.verts.length - 1
}

/** Append a copy of vertex `src` (position + full skin). */
export function appendVertCopy(m: Model, src: number): number {
  ensureSkin(m)
  const sk = m.skin[src] ?? singleSkin(m.vbone[src] ?? -1)
  m.verts.push([m.verts[src][0], m.verts[src][1], m.verts[src][2]])
  m.skin.push({ joints: [sk.joints[0], sk.joints[1], sk.joints[2], sk.joints[3]], weights: [sk.weights[0], sk.weights[1], sk.weights[2], sk.weights[3]] })
  m.vbone.push(primaryJoint(sk))
  return m.verts.length - 1
}

/** Append a midpoint between a and b, lerping skin. */
export function appendVertLerp(m: Model, a: number, b: number, t: number): number {
  ensureSkin(m)
  const pa = m.verts[a], pb = m.verts[b]
  const sk = lerpSkin(m.skin[a] ?? singleSkin(m.vbone[a]), m.skin[b] ?? singleSkin(m.vbone[b]), t)
  m.verts.push([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t])
  m.skin.push(sk)
  m.vbone.push(primaryJoint(sk))
  return m.verts.length - 1
}
