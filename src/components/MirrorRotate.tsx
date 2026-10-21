import { FlipHorizontal2, FlipVertical2, Link2, RotateCcw, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore } from '../store'
import { byId } from '../commands'
import { getBindingLabel, useKeymapVersion } from '../keymap'
import { copy, flip, rotate, viewOp } from '../mirrorCmds'
import type { Axis } from '../mirrorOps'

const AX = ['X', 'Y', 'Z'] as const
/** "Flip X · Ctrl+M X" style tooltip from the live keymap */
/** Ctrl+M menu letters for commands with no key of their own */
const VIA_MENU: Record<string, string> = {
  ...Object.fromEntries(AX.flatMap(a => [[`mesh.flip${a}`, a], [`mesh.copy${a}`, `Shift+${a}`], [`mesh.rotate${a}`, `Alt+${a}`]])),
  'view.flipH': 'H', 'view.flipV': 'V',
}
/** tooltip: label · own key (getBindingLabel), else the Ctrl+M route, else where to bind one */
const tip = (id: string, extra = '') => {
  const own = getBindingLabel(id), menu = getBindingLabel('mesh.mirrorMenu')
  const k = own || (VIA_MENU[id] && menu ? `${menu} ${VIA_MENU[id]}` : 'no key: bind one in Help › Keyboard Shortcuts')
  return `${byId[id]?.label ?? id}${extra}  ·  ${k}`
}

/** Modify tab › Mirror & Rotate: Flip / Copy (+ Weld seam) / Rotate X|Y|Z and the view-relative Flip H|V, Rotate ⟲|⟳. */
export function MirrorRotateSection() {
  useKeymapVersion()
  const weld = useStore(s => s.mirrorWeld)
  const cell = (id: string, title: string, label: ReactNode, run: (e: React.MouseEvent) => void, cls = '') => (
    <button key={id} type="button" className={`mcell ${cls}`} data-testid={`mr-${id}`} title={title} aria-label={title} onClick={run}>{label}</button>
  )
  const axisCells = (verb: 'flip' | 'copy' | 'rotate') => AX.map((a, i) => {
    const id = `mesh.${verb}${a}`
    const run = (e: React.MouseEvent) => (verb === 'flip' ? flip(i as Axis) : verb === 'copy' ? copy(i as Axis) : rotate(i as Axis, e.shiftKey ? -90 : 90))
    return cell(`${verb}-${a.toLowerCase()}`, tip(id, verb === 'rotate' ? ' (Shift+click: −90°)' : ''), a, run, a.toLowerCase())
  })
  return <>
    <h4>Mirror &amp; Rotate</h4>
    <div className="mirror-rotate" data-testid="mirror-rotate">
      <div className="mrow" data-testid="mrow-flip"><span className="mlabel">Flip</span>{axisCells('flip')}<span className="mcell mempty" aria-hidden /></div>
      <div className="mrow" data-testid="mrow-copy"><span className="mlabel">Copy</span>{axisCells('copy')}
        <button type="button" className={`mcell mweld ${weld ? 'on' : ''}`} data-testid="mr-weld" aria-pressed={weld} title={`Weld seam: points on the mirror plane are shared by both halves (${weld ? 'on' : 'off'})`}
          onClick={() => useStore.getState().set({ mirrorWeld: !weld })}><Link2 size={12} /></button>
      </div>
      <div className="mrow" data-testid="mrow-rotate"><span className="mlabel">Rotate</span>{axisCells('rotate')}<span className="mcell mempty" aria-hidden /></div>
      <div className="mrow" data-testid="mrow-view"><span className="mlabel">View</span>
        {cell('flip-h', tip('view.flipH'), <FlipHorizontal2 size={12} />, () => void viewOp('flipH'))}
        {cell('flip-v', tip('view.flipV'), <FlipVertical2 size={12} />, () => void viewOp('flipV'))}
        {cell('rot-ccw', tip('view.rotateCCW'), <RotateCcw size={12} />, () => void viewOp('rotCCW'))}
        {cell('rot-cw', tip('view.rotateCW'), <RotateCw size={12} />, () => void viewOp('rotCW'))}
      </div>
    </div>
  </>
}
