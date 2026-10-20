import { useState } from 'react'
import { useStore } from '../store'
import { textures } from '../textures'
import type { Anchor } from '../imageops'
import { ModalFrame } from './Modal'
import { isPow2, pow2Up } from '../uvops'

const SIZES = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096]
const clampSize = (n: number) => Math.max(1, Math.min(4096, Math.round(n) || 1))

function SizeFields({ w, h, setW, setH, id }: { w: number; h: number; setW: (n: number) => void; setH: (n: number) => void; id: string }) {
  return (<>
    <div className="img-size">
      <label className="field">Width<input type="number" min={1} max={4096} value={w} data-testid={`${id}-w`} onChange={e => setW(+e.target.value)} /></label>
      <span className="img-x">×</span>
      <label className="field">Height<input type="number" min={1} max={4096} value={h} data-testid={`${id}-h`} onChange={e => setH(+e.target.value)} /></label>
      <label className="field">Preset<select data-testid={`${id}-preset`} value="" onChange={e => { const n = +e.target.value; if (n) { setW(n); setH(n) } }}>
        <option value="">…</option>{SIZES.map(n => <option key={n} value={n}>{n}×{n}</option>)}
      </select></label>
    </div>
    {(!isPow2(w) || !isPow2(h)) && <div className="img-pow2" data-testid={`${id}-pow2`} title="Game engines and mipmaps work best with power-of-two sizes">Not a power of two: {pow2Up(w)}×{pow2Up(h)} is the next one</div>}
  </>)
}

/** Image → New…: blank (colour or transparent) or a UV template of the selected faces (all when none). */
export function NewImageDialog({ close }: { close: () => void }) {
  const [name, setName] = useState('Image')
  const [w, setW] = useState(64), [h, setH] = useState(64)
  const [fill, setFill] = useState('#ffffff'), [clear, setClear] = useState(false)
  const [template, setTemplate] = useState(false), [pack, setPack] = useState(false)
  const sel = useStore(s => s.activeFaces().length)
  const ok = () => { useStore.getState().imageNew({ name, w: clampSize(w), h: clampSize(h), fill: clear ? null : fill, template, pack }); close() }
  return (
    <ModalFrame title="New image" testid="img-new" onCancel={close} onConfirm={ok} width={380}
      footer={<><button onClick={close}>Cancel</button><button className="primary" data-testid="img-new-ok" onClick={ok}>Create</button></>}>
      <div className="img-dlg">
        <label className="field">Name<input value={name} data-testid="img-new-name" onChange={e => setName(e.target.value)} /></label>
        <SizeFields w={w} h={h} setW={setW} setH={setH} id="img-new" />
        <div className="seg" data-testid="img-new-type">
          <button className={!template ? 'on' : ''} data-testid="img-new-blank" onClick={() => setTemplate(false)}>Blank</button>
          <button className={template ? 'on' : ''} data-testid="img-new-template" onClick={() => setTemplate(true)}>UV template</button>
        </div>
        {!template ? <div className="img-row">
          <label className="img-check"><input type="checkbox" checked={clear} data-testid="img-new-clear" onChange={e => setClear(e.target.checked)} />Transparent</label>
          {!clear && <input type="color" value={fill} data-testid="img-new-fill" onChange={e => setFill(e.target.value)} />}
        </div> : <div className="img-row">
          <label className="img-check"><input type="checkbox" checked={pack} data-testid="img-new-pack" onChange={e => setPack(e.target.checked)} />Pack first</label>
        </div>}
        <p className="tip">{template ? `Colours by facing (top white, bottom grey, front blue, back yellow, left pink, right green), 1-px face outlines, 2-px island borders · ${sel ? `${sel} selected faces` : 'all faces'} get the image` : sel ? `The ${sel} selected faces get the image` : 'Added to the Images library (select faces first to assign it)'}</p>
      </div>
    </ModalFrame>
  )
}

/** Image → Resize…: scale pixels (nearest; UVs unchanged) or extend the canvas at an anchor (UVs keep their pixels). */
export function ResizeImageDialog({ mat, close }: { mat: number; close: () => void }) {
  const id = useStore(s => s.model.materials[mat]?.texture)
  const sz = (id && textures.size(id)) || { w: 16, h: 16 }
  const [w, setW] = useState(sz.w), [h, setH] = useState(sz.h)
  const [mode, setMode] = useState<'scale' | 'extend'>('extend')
  const [anchor, setAnchor] = useState<Anchor>([0, 0])
  const ok = () => { useStore.getState().imageResize(mat, clampSize(w), clampSize(h), mode, anchor); close() }
  return (
    <ModalFrame title={`Resize image (${sz.w}×${sz.h})`} testid="img-resize" onCancel={close} onConfirm={ok} width={380}
      footer={<><button onClick={close}>Cancel</button><button className="primary" data-testid="img-resize-ok" onClick={ok}>Resize</button></>}>
      <div className="img-dlg">
        <SizeFields w={w} h={h} setW={setW} setH={setH} id="img-resize" />
        <div className="seg" data-testid="img-resize-mode">
          <button className={mode === 'extend' ? 'on' : ''} data-testid="img-resize-extend" onClick={() => setMode('extend')}>Extend canvas</button>
          <button className={mode === 'scale' ? 'on' : ''} data-testid="img-resize-scale" onClick={() => setMode('scale')}>Scale pixels</button>
        </div>
        {mode === 'extend' && <div className="img-row">
          <div className="img-anchor" data-testid="img-anchor" role="radiogroup" aria-label="Anchor">
            {[0, 1, 2].flatMap(r => [0, 1, 2].map(c => <button key={`${c}${r}`} role="radio" aria-checked={anchor[0] === c && anchor[1] === r} className={anchor[0] === c && anchor[1] === r ? 'on' : ''} data-testid={`img-anchor-${c}${r}`} title="Where the old pixels stay" onClick={() => setAnchor([c, r] as Anchor)} />))}
          </div>
          <span className="tip">Old pixels stay at the anchor; UVs follow so the model looks the same</span>
        </div>}
        {mode === 'scale' && <p className="tip">Nearest neighbour (crisp pixels); UVs stay as they are</p>}
      </div>
    </ModalFrame>
  )
}
