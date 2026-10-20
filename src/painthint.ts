import type { PaintSettings } from './store'

/** Status-bar copy for the paint tool. The first clause (before " · ") is the short line. */
export function paintStatusHint(p: PaintSettings): string {
  if (p.target === 'weight') {
    if (p.mode === 'erase') return 'Weight: erase subtracts the selected joint · select a joint first · heat map shows its influence'
    if (p.mode === 'fill') return 'Weight: fill sets the selected joint to Strength on the brushed points'
    return 'Weight: brush adds the selected joint · Erase subtracts · heat map = influence · select a joint first'
  }
  const base = p.target === 'vertex' ? 'Vertex colours' : 'Image'
  const where = p.target === 'vertex' ? 'the model' : 'the model or the texture'
  switch (p.mode) {
    case 'erase': return `${base}: erase toward transparent · drag on ${where} · [ ] size`
    case 'fill': return `${base}: click to fill · the scope is on the Brush tab · Alt picks a colour`
    case 'pick': return 'Eyedropper: click to pick a colour · Alt does this from any paint tool'
    case 'line': return `${base}: drag a straight line · Shift locks to 15° · one undo when you release`
    case 'rect': return `${base}: drag a rectangle · Outline or Fill on the Brush tab · one undo when you release`
    case 'ellipse': return `${base}: drag an ellipse · Outline or Fill on the Brush tab · one undo when you release`
    case 'marquee': return `${base}: drag a box to select texels · Shift adds · Ctrl+Shift subtracts`
    case 'lasso': return `${base}: draw around texels to select them · Shift adds · Ctrl+Shift subtracts`
    case 'wand': return `${base}: click a colour to select those texels · Shift adds · Ctrl+Shift subtracts`
    case 'move': return `${base}: drag to move the selected texels · one undo when you release`
    case 'shade': return `${base}: click to step the colour ${p.shadeLight ? 'lighter' : 'darker'} · one step per stroke`
    default: return `${base}: drag on ${where} · [ ] changes size · Hold Alt to pick a colour`
  }
}
