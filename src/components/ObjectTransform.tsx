/**
 * Scene tab, above the object list: the selected object's Transform (Model mode). Position is where its origin sits
 * in the world (pos + pivot), Rotation in degrees, Scale; each field applies on Enter / leaving it as one undo step.
 * "Origin to geometry" sits right under Position (Set Origin's other entries live in the Edit menu, the viewport
 * right-click and Ctrl+Shift+Alt+C).
 */
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { byId, selectedObjects } from '../commands'
import { getBindingLabel, useKeymapVersion } from '../keymap'
import type { Vec3 } from '../model'

const AX = ['X', 'Y', 'Z'] as const
const fmt = (v: number) => String(Math.round(v * 1000) / 1000)

function Num({ value, onSet, testid }: { value: number; onSet: (v: number) => void; testid: string }) {
  const [t, setT] = useState(fmt(value))
  useEffect(() => setT(fmt(value)), [value])
  const apply = () => { const v = Number(t.replace(',', '.')); if (Number.isFinite(v) && fmt(v) !== fmt(value)) onSet(v); else setT(fmt(value)) }
  return <input className="num ot-num" data-testid={testid} inputMode="decimal" value={t} onChange={e => setT(e.target.value)} onBlur={apply}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply(); (e.target as HTMLInputElement).blur() } else if (e.key === 'Escape') { setT(fmt(value)); (e.target as HTMLInputElement).blur() } }} />
}

export function ObjectTransform() {
  useStore(s => s.version); useStore(s => s.selFaces); useStore(s => s.selVerts)
  const mode = useStore(s => s.mode)
  useKeymapVersion()
  const gs = selectedObjects()
  const m = useStore.getState().model
  if (mode !== 'model' || !gs.length) return null
  const g = gs[gs.length - 1], x = m.groups[g].xf
  const origin: Vec3 = [x.pos[0] + x.pivot[0], x.pos[1] + x.pivot[1], x.pos[2] + x.pivot[2]]
  const setXf = (label: string, f: (xf: typeof x) => void) => useStore.getState().edit(md => f(md.groups[g].xf), label)
  const row = (label: string, key: string, vals: Vec3, set: (i: number, v: number) => void) => (
    <div className="ot-row" data-testid={`ot-${key}`}>
      <span className="ot-lbl">{label}</span>
      {AX.map((a, i) => <Num key={a} value={vals[i]} testid={`ot-${key}-${a.toLowerCase()}`} onSet={v => set(i, v)} />)}
    </div>
  )
  const c = byId['object.originToGeometry'], keys = getBindingLabel('object.originToGeometry')
  const deg = (r: number) => (r * 180) / Math.PI
  return (
    <div className="ot" data-testid="object-transform">
      <div className="ot-head"><span>Transform</span><span className="ot-name" title={m.groups[g].name}>{gs.length > 1 ? `${gs.length} objects · ${m.groups[g].name}` : m.groups[g].name}</span></div>
      {row('Position', 'pos', origin, (i, v) => setXf('Object position', xf => { xf.pos = xf.pos.map((p, k) => (k === i ? v - xf.pivot[k] : p)) as Vec3 }))}
      <button className="ot-origin" data-testid="origin-to-geometry" title={`Origin to geometry: move ${gs.length > 1 ? 'the selected objects\u2019 origins' : 'the origin'} to the centre of the bounding box (nothing moves)${keys ? `  ·  ${keys}` : ''}`}
        onClick={c.run}>Origin to geometry</button>
      {row('Rotation', 'rot', x.rot.map(deg) as Vec3, (i, v) => setXf('Object rotation', xf => { xf.rot = xf.rot.map((r, k) => (k === i ? (v * Math.PI) / 180 : r)) as Vec3 }))}
      {row('Scale', 'scale', x.scale, (i, v) => setXf('Object scale', xf => { xf.scale = xf.scale.map((s, k) => (k === i ? v : s)) as Vec3 }))}
    </div>
  )
}
