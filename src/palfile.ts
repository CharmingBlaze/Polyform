import { formatGpl, parseGpl } from './gpl'
import { useStore } from './store'

/** Download the swatches as a GIMP palette. */
export function saveSwatchFile() {
  const s = useStore.getState()
  const text = formatGpl('Polyform', s.paint.swatches, 5)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  a.download = 'polyform.gpl'
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Open the Paint tab's file picker. The picker lives with the colour area. */
export function openSwatchFile() {
  const input = document.querySelector<HTMLInputElement>('[data-testid="paint-palette-file"]')
  if (!input) { useStore.getState().notify('Open the Paint tab to load a palette'); return }
  input.click()
}

export function applySwatchFile(text: string) {
  const pal = parseGpl(text)
  if (!pal.colors.length) { useStore.getState().notify('That palette has no colours'); return }
  const swatches = [...new Set(pal.colors.map(c => c.hex))].slice(0, 24)
  useStore.getState().setPaint({ swatches, color: swatches[0] })
  useStore.getState().notify(`Loaded ${swatches.length} colours from ${pal.name}`)
}
