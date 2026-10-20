/**
 * Range sliders fill with the accent colour up to their value. WebKit has no "progress" pseudo-element, so every
 * input[type=range] carries its fraction in a --p custom property, kept current from input events and from React
 * updating the value attribute (undo, presets…). Firefox uses ::-moz-range-progress and ignores --p.
 */
function sync(el: Element) {
  if (!(el instanceof HTMLInputElement) || el.type !== 'range') return
  const lo = parseFloat(el.min || '0'), hi = parseFloat(el.max || '100'), v = parseFloat(el.value)
  const p = hi > lo && Number.isFinite(v) ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0
  el.style.setProperty('--p', `${(p * 100).toFixed(2)}%`)
}
export function installRangeFill(root: Document = document) {
  const all = (n: ParentNode) => n.querySelectorAll('input[type=range]').forEach(sync)
  root.addEventListener('input', e => sync(e.target as Element), true)
  new MutationObserver(recs => {
    for (const r of recs) {
      if (r.type === 'attributes') sync(r.target as Element)
      else r.addedNodes.forEach(n => { if (n instanceof HTMLInputElement) sync(n); else if (n instanceof Element) all(n) })
    }
  }).observe(root.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['value', 'min', 'max'] })
  all(root)
}
