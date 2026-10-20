// Unwrap / projection operators shared by the UV editor, its menus and the U menu of the 3D views. They work on
// the selected faces only (all visible faces when nothing is selected): the other faces keep their UVs, and the
// result keeps its place (or goes to free space) unless everything was unwrapped (then it is packed).
import { faceMat, type Vec2 } from './model'
import { useStore } from './store'
import * as U from './uvops'
import { unwrapSeams } from './lscm'
import { smartProject } from './uvblender'
import { placeUnwrapped, type PlaceResult } from './uvplace'

export type ProjKind = 'front' | 'top' | 'side' | 'box' | 'cyl' | 'sphere'
export type UnwrapKind = 'unwrap' | 'smart' | ProjKind | 'view'

/** faces to work on, whether that is all of them, and the other faces sharing their images */
export function unwrapTargets() {
  const st = useStore.getState(), vis = st.uvFaces()
  const sel = st.activeFaces().filter(fi => st.model.faces[fi] && !st.model.faces[fi].hidden)
  const faces = sel.length ? sel : vis
  const mats = new Set(faces.map(fi => faceMat(st.model, st.model.faces[fi])))
  const inSel = new Set(faces)
  const others = vis.filter(fi => !inSel.has(fi) && mats.has(faceMat(st.model, st.model.faces[fi])))
  return { faces, all: !sel.length || !others.length, others }
}

const where = (r: PlaceResult) => (r.mode === 'in place' ? ' · kept in place' : r.mode === 'free space' ? ' · moved to free space' : r.mode === 'overlaps' ? ' · no free space: overlaps other UVs' : '') + (r.shrunk ? ' · scaled down to fit' : '')

/** run an unwrap or projection as one undo step; `proj` projects points for 'view' */
export function runUnwrap(kind: UnwrapKind, proj?: (p: readonly number[]) => Vec2): boolean {
  const st = useStore.getState()
  const { faces, all, others } = unwrapTargets()
  if (!faces.length) { st.notify('Nothing to unwrap'); return false }
  const o = st.ui.uvUnwrap
  const img = st.imageSizeOf(faces), dens = st.model.props.texelDensity
  const place = { margin: o.margin, img: img ? { tw: img.w, th: img.h, density: dens } : undefined }
  let msg = ''
  const label = kind === 'smart' ? 'Smart UV Project' : kind === 'unwrap' ? `Unwrap (${o.method === 'angle' ? 'angle based' : 'conformal'})` : kind === 'view' ? 'UV project from view' : 'UV project'
  st.edit(m => {
    const before = faces.map(fi => m.faces[fi].uv.map(p => [p[0], p[1]] as Vec2))
    if (kind === 'unwrap') {
      const r = unwrapSeams(m, faces, o.method)
      const pinned = new Set(r.pinnedFaces), free = faces.filter(fi => !pinned.has(fi))
      const pr = placeUnwrapped(m, free, others, before.filter((_, k) => !pinned.has(faces[k])), all, place)
      msg = `Unwrapped ${faces.length} face${faces.length === 1 ? '' : 's'} (${o.method === 'angle' ? 'angle based' : 'conformal'}): ${r.charts} island${r.charts === 1 ? '' : 's'}${pinned.size ? ' · pinned islands stay on their pins' : ''}${r.failed ? ` · ${r.failed} failed` : ''}${where(pr)}`
      return
    }
    if (kind === 'smart') {
      U.keepPins(m, faces, () => {
        const g = smartProject(m, faces, o.smartAngle, o.smartArea)
        const pr = placeUnwrapped(m, faces, others, before, all, { ...place, margin: o.smartMargin })
        msg = `Smart UV Project: ${g.length} island${g.length === 1 ? '' : 's'} (angle limit ${o.smartAngle}°)${where(pr)}`
      })
      return
    }
    U.keepPins(m, faces, () => {
      if (kind === 'view') { if (proj) U.projectView(m, faces, proj) }
      else if (kind === 'cyl') U.projectCylinder(m, faces)
      else if (kind === 'sphere') U.projectSphere(m, faces)
      else U.project(m, faces, kind === 'front' ? 'z' : kind === 'top' ? 'y' : kind === 'side' ? 'x' : 'box')
      const pr = placeUnwrapped(m, faces, others, before, all, { ...place, block: true })
      msg = `Projected ${faces.length} face${faces.length === 1 ? '' : 's'}${where(pr)}`
    })
  }, label)
  st.notify(msg)
  return true
}

