/** GIMP palette text (.gpl). Colours are `#rrggbb`. No canvas, so tests can parse a file without a browser. */

export interface GplColor { hex: string; name: string }
export interface Gpl { name: string; columns: number; colors: GplColor[] }

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
const byte = (n: number) => clamp(n).toString(16).padStart(2, '0')

export function parseGpl(text: string): Gpl {
  let name = 'Palette', columns = 0
  const colors: GplColor[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || /^GIMP Palette/i.test(line)) continue
    const nm = /^Name:\s*(.*)$/i.exec(line)
    if (nm) { name = nm[1].trim() || name; continue }
    const col = /^Columns:\s*(\d+)/i.exec(line)
    if (col) { columns = Number(col[1]); continue }
    const m = /^(-?\d+)\s+(-?\d+)\s+(-?\d+)(?:\s+(.*))?$/.exec(line)
    if (!m) continue
    const r = clamp(Number(m[1])), g = clamp(Number(m[2])), b = clamp(Number(m[3]))
    const hex = `#${byte(r)}${byte(g)}${byte(b)}`
    colors.push({ hex, name: (m[4] || hex).trim() })
  }
  return { name, columns, colors }
}

/** Write a palette the GIMP (and Aseprite) will open. */
export function formatGpl(name: string, hexes: string[], columns = 0): string {
  const rows = hexes.map(h => {
    const n = parseInt(h.replace('#', ''), 16)
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    return `${r} ${g} ${b}\t${h}`
  })
  return `GIMP Palette\nName: ${name}\nColumns: ${columns}\n#\n${rows.join('\n')}\n`
}
