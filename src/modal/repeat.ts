/**
 * MOD-2 Repeat Last for modal transforms: replays a confirmed G / R / S from its last-op record. Kept apart from
 * `./transform.ts` because it needs the scene (commands.ts imports `./transform.ts`, and unit tests import commands).
 */
import * as THREE from 'three'
import { useStore } from '../store'
import { applyXf, collectTargets, identityXf } from '../transform'
import { flipFaces } from '../model'
import { flipsWinding } from './numinput'

const XF_IDS = new Set(['xf.grab', 'xf.rotateModal', 'xf.scaleModal'])
/**
 * Repeat Last for G / R / S: re-apply a confirmed transform's recorded `opts` (from `endModal`) to the current
 * selection, as one undo step, without a modal. Returns false when the id is not a transform or nothing is selected.
 *
 *   const last = getLastOp(); if (last) repeatTransform(last.id, last.opts)
 */
export function repeatTransform(id: string, opts: Record<string, unknown>): boolean {
  if (!XF_IDS.has(id)) return false
  const st = useStore.getState()
  const T = collectTargets(st, opts.space === 'local' ? 'local' : 'global')
  if (!T) return false
  const x = identityXf()
  const vec = (v: unknown) => (Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number') ? (v as [number, number, number]) : null)
  if (id === 'xf.grab') { const t = vec(opts.translate); if (!t) return false; x.t.set(t[0], t[1], t[2]) }
  else if (id === 'xf.rotateModal') {
    const a = vec(opts.axisVec), ang = Number(opts.angle)
    if (!a || !Number.isFinite(ang)) return false
    x.q.setFromAxisAngle(new THREE.Vector3(a[0], a[1], a[2]).normalize(), THREE.MathUtils.degToRad(ang))
  } else {
    const sc = vec(opts.scale); if (!sc) return false
    x.s.set(sc[0], sc[1], sc[2])
  }
  st.checkpoint(id === 'xf.grab' ? 'Move' : id === 'xf.rotateModal' ? 'Rotate' : 'Scale')
  applyXf(T, x)
  if (id === 'xf.scaleModal' && flipsWinding([x.s.x, x.s.y, x.s.z]) && T.verts.size) {
    const m = useStore.getState().model
    const faces = m.faces.map((f, i) => (f.v.every(v => T.verts.has(v)) ? i : -1)).filter(i => i >= 0)
    if (faces.length) flipFaces(m, faces)
  }
  st.touch()
  st.commit()
  return true
}
