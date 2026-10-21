/**
 * Rebindable keyboard shortcuts. The command registry (commands.ts) owns what each command does and its default key
 * (`Command.keys`); this module turns those defaults plus the user's overrides into the live keymap, resolves a key
 * press to a command in the current context and finds clashes.
 *
 * Scopes, narrowest wins: a panel while the pointer is over it (`panel:timeline`), then the current workspace
 * (`ws:paint`, … Animate mode counts as the Animate workspace), then `global`. Overrides are per browser
 * (localStorage `polyform.keymap.v1`), never in the project file.
 */
import { create } from 'zustand'
import { byId, commands, comboOf, overTimeline, paintHotkey, TIMELINE_KEYS, UV_CLIP_KEYS, UV_KEYS, type Command } from './commands'
import { deleteTimelineKeys, setTimelineArmed, timelineArmed } from './timeline/edit'
import { isModalActive, overUV } from './interaction'
import { useStore, WORKSPACES, type Workspace } from './store'
import { WS_NAME } from './commands'

export type PanelScope = 'timeline'
export const PANELS: PanelScope[] = ['timeline']
export type Scope = 'global' | `ws:${Workspace}` | `panel:${PanelScope}`
export const SCOPES: Scope[] = ['global', ...WORKSPACES.map(w => `ws:${w}` as Scope), ...PANELS.map(p => `panel:${p}` as Scope)]
const PANEL_NAME: Record<PanelScope, string> = { timeline: 'Timeline' }

export const scopeRank = (s: Scope) => (s === 'global' ? 0 : s.startsWith('ws:') ? 1 : 2)
export function scopeLabel(s: Scope): string {
  if (s === 'global') return 'Global'
  if (s.startsWith('ws:')) return WS_NAME[s.slice(3) as Workspace] ?? s
  return `${PANEL_NAME[s.slice(6) as PanelScope] ?? s} (hovered)`
}
/** Can both scopes be active at once? Global overlaps everything, a hovered panel can be over any workspace. */
export const scopesOverlap = (a: Scope, b: Scope) => a === b || a === 'global' || b === 'global' || a.startsWith('panel:') || b.startsWith('panel:')

/** command id → scope → key combos ('' or [] = unbound in that scope) */
export type KeyMap = Record<string, Partial<Record<Scope, string[]>>>
export interface Binding { id: string; scope: Scope; keys: string }
export interface KeyContext { workspace: Workspace; panel: PanelScope | null }

// ---------------------------------------------------------------------------------------------- combos

const MOD = /^(ctrl|control|cmd|meta|shift|alt|option)\+(?=.)/i
const KEY_ALIAS: Record<string, string> = { ESCAPE: 'Esc', ESC: 'Esc', DELETE: 'Del', DEL: 'Del', BACKSPACE: 'Del', ' ': 'Space', SPACE: 'Space', PLUS: '+' }
/** Canonical spelling: modifiers in Ctrl, Shift, Alt order (what comboOf produces), single characters upper-case. */
export function normCombo(s: string): string {
  let rest = s.trim()
  const mods = new Set<string>()
  for (let m = MOD.exec(rest); m; m = MOD.exec(rest)) {
    const k = m[1].toLowerCase()
    mods.add(k === 'cmd' || k === 'meta' || k === 'control' ? 'Ctrl' : k === 'option' ? 'Alt' : k[0].toUpperCase() + k.slice(1))
    rest = rest.slice(m[0].length)
  }
  let key = KEY_ALIAS[rest.toUpperCase()] ?? rest
  if (key.length === 1) key = key.toUpperCase()
  return [...['Ctrl', 'Shift', 'Alt'].filter(m => mods.has(m)), key].join('+')
}
/** Case-insensitive identity of a combo. */
export const comboKey = (s: string) => normCombo(s).toUpperCase()

/** Keys a Chrome tab never passes to the page (or that switch tabs): warn before binding them. */
export function reservedReason(combo: string): string | null {
  const k = comboKey(combo)
  if (/^CTRL\+(SHIFT\+)?(T|W|N|TAB)$/.test(k) || /^CTRL\+(PAGEUP|PAGEDOWN)$/.test(k)) return `Chrome keeps ${normCombo(combo)} for its tabs and windows, so it never reaches Polyform in a browser tab`
  if (/^(CTRL|ALT)\+[1-9]$/.test(k)) return `${normCombo(combo)} switches browser tabs in Chrome, so it never reaches Polyform in a browser tab`
  if (k === 'ALT+F4' || /^ALT\+(ARROWLEFT|ARROWRIGHT|HOME)$/.test(k)) return `${normCombo(combo)} belongs to the browser (back / forward / home / close)`
  return null
}
export const isBrowserReserved = (combo: string) => reservedReason(combo) !== null

// ---------------------------------------------------------------------------------------------- defaults

/** Lead's Apply-transform command takes Ctrl+A once it is registered under this id; until then Ctrl+A selects all. */
export const APPLY_TRANSFORM_ID = 'xf.apply'

/**
 * Default keymap: every `Command.keys` in global scope, plus the scoped rules the team agreed on:
 * Shift+D and Ctrl+D duplicate, except Ctrl+D clears the pixel selection in Paint; Ctrl+A is Apply transform
 * (Select all while that command does not exist yet), except Select all pixels in Paint; S over the Timeline scales keys;
 * Ctrl+D duplicates keys in Animate and over the Timeline.
 */
export function defaultKeyMap(list: readonly Command[] = commands): KeyMap {
  const ids = new Set(list.map(c => c.id))
  const km: KeyMap = {}
  const add = (id: string, scope: Scope, keys: string) => {
    if (!ids.has(id)) return
    const arr = ((km[id] ??= {})[scope] ??= [])
    if (!arr.some(k => comboKey(k) === comboKey(keys))) arr.push(keys)
  }
  for (const c of list) if (c.keys) add(c.id, 'global', c.keys)
  add('op.mul.duplicate', 'global', 'Shift+D')
  add('op.mul.duplicate', 'global', 'Ctrl+D')
  add('paint.deselect', 'ws:paint', 'Ctrl+D')
  if (ids.has(APPLY_TRANSFORM_ID)) add(APPLY_TRANSFORM_ID, 'global', 'Ctrl+A')
  else add('sel.all2', 'global', 'Ctrl+A')
  add('paint.selectAll', 'ws:paint', 'Ctrl+A')
  add('anim.scaleKeys', 'panel:timeline', 'S')
  // Ctrl+D duplicates keys in Animate (viewport) and over the Timeline in any mode; mesh Duplicate everywhere else
  add('anim.duplicateKeys', 'ws:animate', 'Ctrl+D')
  add('anim.duplicateKeys', 'panel:timeline', 'Ctrl+D')
  return km
}

/** Defaults with overrides applied: an override replaces that command's keys in that scope. */
export function effectiveKeyMap(defaults: KeyMap, overrides: KeyMap): KeyMap {
  const out: KeyMap = {}
  for (const id of new Set([...Object.keys(defaults), ...Object.keys(overrides)])) {
    const d = defaults[id] ?? {}, o = overrides[id] ?? {}
    const row: Partial<Record<Scope, string[]>> = {}
    for (const s of SCOPES) { const v = o[s] ?? d[s]; if (v?.length) row[s] = [...v] }
    if (Object.keys(row).length) out[id] = row
  }
  return out
}

/** Flat binding list in registry order (then scope order), only for registered commands. */
export function bindingsOf(km: KeyMap, list: readonly Command[] = commands): Binding[] {
  const out: Binding[] = []
  for (const c of list) {
    const row = km[c.id]
    if (!row) continue
    for (const s of SCOPES) for (const keys of row[s] ?? []) out.push({ id: c.id, scope: s, keys })
  }
  return out
}

// ---------------------------------------------------------------------------------------------- resolution + clashes

const activeScopes = (ctx: KeyContext): Scope[] => ['global', `ws:${ctx.workspace}`, ...(ctx.panel ? [`panel:${ctx.panel}` as Scope] : [])]

/** The binding a combo runs in this context: the narrowest active scope wins, then the first registered. */
export function resolveKey(combo: string, ctx: KeyContext, bindings: readonly Binding[]): Binding | null {
  const k = comboKey(combo), act = activeScopes(ctx)
  let best: Binding | null = null
  for (const b of bindings) {
    if (!act.includes(b.scope) || comboKey(b.keys) !== k) continue
    if (!best || scopeRank(b.scope) > scopeRank(best.scope)) best = b
  }
  return best
}

export interface Clash {
  a: Binding
  b: Binding
  /** 'conflict': same scope, only the first registered runs; 'shadow': the narrower scope wins where both apply */
  kind: 'conflict' | 'shadow'
  /** the binding that runs where both apply */
  winner: Binding
}

/** Every pair of different commands on the same keys in scopes that can be active together. */
export function findClashes(bindings: readonly Binding[]): Clash[] {
  const byCombo = new Map<string, Binding[]>()
  for (const b of bindings) { const k = comboKey(b.keys); byCombo.set(k, [...(byCombo.get(k) ?? []), b]) }
  const out: Clash[] = []
  for (const list of byCombo.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]
      if (a.id === b.id || !scopesOverlap(a.scope, b.scope)) continue
      const kind = a.scope === b.scope ? 'conflict' : 'shadow'
      out.push({ a, b, kind, winner: kind === 'conflict' ? a : scopeRank(a.scope) > scopeRank(b.scope) ? a : b })
    }
  }
  return out
}
export const sameBinding = (x: Binding, y: Binding) => x.id === y.id && x.scope === y.scope && comboKey(x.keys) === comboKey(y.keys)
export const clashesFor = (b: Binding, clashes: readonly Clash[]) => clashes.filter(c => sameBinding(c.a, b) || sameBinding(c.b, b))

// ---------------------------------------------------------------------------------------------- presets

export interface Preset { id: string; label: string; map: KeyMap }
/** Blender-flavoured layout on top of the defaults (which already follow Blender for G/R/S, E, Tab, X, H, A…). */
export const PRESETS: Preset[] = [
  { id: 'polyform', label: 'Polyform (default)', map: {} },
  { id: 'blender', label: 'Blender', map: {
    'sel.objectMode': { global: [] },
    'sel.vertex': { global: ['1'] }, 'sel.edge': { global: ['2'] }, 'sel.face': { global: ['3'] }, 'sel.joint': { global: ['4'] },
    'sel.vertex.add': { global: ['Shift+1'] }, 'sel.edge.add': { global: ['Shift+2'] }, 'sel.face.add': { global: ['Shift+3'] },
    'view.max': { global: ['Ctrl+Space'] },
    'view.toolPanel': { global: ['T'] }, 'view.sidePanel': { global: ['N'] }, 'edit.numeric': { global: ['F9'] },
    'anim.prev': { global: ['ArrowLeft'] }, 'anim.next': { global: ['ArrowRight'] },
    'view.frame': { global: ['.'] },
  } },
]

// ---------------------------------------------------------------------------------------------- live state

const KEY = 'polyform.keymap.v1'

function cleanKeyMap(raw: unknown): KeyMap {
  const out: KeyMap = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [id, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    for (const [s, keys] of Object.entries(row as Record<string, unknown>)) {
      if (!SCOPES.includes(s as Scope) || !Array.isArray(keys)) continue
      (out[id] ??= {})[s as Scope] = keys.filter((k): k is string => typeof k === 'string' && k.trim() !== '').map(normCombo)
    }
  }
  return out
}
export function loadOverrides(): KeyMap {
  try { return cleanKeyMap(JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}')?.overrides) } catch { return {} }
}
function saveOverrides(o: KeyMap) {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify({ v: 1, overrides: o })) } catch { /* storage blocked: bindings last this session */ }
}

interface KeymapState { overrides: KeyMap; dialog: boolean }
export const useKeymap = create<KeymapState>(() => ({ overrides: loadOverrides(), dialog: false }))

let cache: { o: KeyMap; list: readonly Command[]; b: Binding[]; c: Clash[]; d: KeyMap } | null = null
function live() {
  const o = useKeymap.getState().overrides
  if (!cache || cache.o !== o || cache.list !== commands) {
    const d = defaultKeyMap(commands)
    const b = bindingsOf(effectiveKeyMap(d, o), commands)
    cache = { o, list: commands, b, c: findClashes(b), d }
  }
  return cache
}
export const currentBindings = () => live().b
export const currentClashes = () => live().c
export const currentDefaults = () => live().d

const same = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && a.every((k, i) => comboKey(k) === comboKey(b[i]))
const keysIn = (id: string, scope: Scope) => effectiveKeyMap(live().d, useKeymap.getState().overrides)[id]?.[scope] ?? []

/** Set a command's keys in one scope (an override; dropped again when it equals the default). */
export function setBinding(id: string, scope: Scope, keys: readonly string[]) {
  const o = structuredClone(useKeymap.getState().overrides)
  const norm = keys.map(normCombo).filter((k, i, a) => a.findIndex(x => comboKey(x) === comboKey(k)) === i)
  if (same(norm, live().d[id]?.[scope])) { if (o[id]) delete o[id][scope] }
  else (o[id] ??= {})[scope] = norm
  if (o[id] && !Object.keys(o[id]).length) delete o[id]
  useKeymap.setState({ overrides: o }); saveOverrides(o)
}
export const addBinding = (id: string, scope: Scope, keys: string) => setBinding(id, scope, [...keysIn(id, scope), keys])
export const removeBinding = (id: string, scope: Scope, keys: string) => setBinding(id, scope, keysIn(id, scope).filter(k => comboKey(k) !== comboKey(keys)))
export const replaceBinding = (id: string, scope: Scope, old: string, keys: string) => setBinding(id, scope, keysIn(id, scope).map(k => (comboKey(k) === comboKey(old) ? keys : k)))
/** Back to the default keys: one scope, or every scope of the command. */
export function resetBinding(id: string, scope?: Scope) {
  const o = structuredClone(useKeymap.getState().overrides)
  if (!o[id]) return
  if (scope) delete o[id][scope]; else delete o[id]
  if (o[id] && !Object.keys(o[id]).length) delete o[id]
  useKeymap.setState({ overrides: o }); saveOverrides(o)
}
export function resetAllBindings() { useKeymap.setState({ overrides: {} }); saveOverrides({}) }
export const isOverridden = (id: string, scope?: Scope) => { const r = useKeymap.getState().overrides[id]; return !!r && (scope ? r[scope] !== undefined : Object.keys(r).length > 0) }
export function applyPreset(presetId: string) {
  const p = PRESETS.find(x => x.id === presetId)
  if (!p) return
  const o = cleanKeyMap(Object.fromEntries(Object.entries(p.map).filter(([id]) => byId[id])))
  useKeymap.setState({ overrides: o }); saveOverrides(o)
}
/** The preset the overrides equal, or null (custom). */
export function currentPreset(): string | null {
  const o = JSON.stringify(useKeymap.getState().overrides)
  return PRESETS.find(p => JSON.stringify(cleanKeyMap(Object.fromEntries(Object.entries(p.map).filter(([id]) => byId[id])))) === o)?.id ?? null
}
export const openKeymapDialog = () => useKeymap.setState({ dialog: true })
export const closeKeymapDialog = () => useKeymap.setState({ dialog: false })

/** Hovered panel with its own key scope (elements carry data-key-scope). */
export function hoveredPanel(): PanelScope | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector('[data-key-scope]:hover') as HTMLElement | null
  const p = el?.dataset.keyScope as PanelScope | undefined
  return p && PANELS.includes(p) ? p : null
}
export function keyContext(panel: PanelScope | null = hoveredPanel()): KeyContext {
  const s = useStore.getState()
  return { workspace: s.mode === 'animate' ? 'animate' : s.workspace, panel }
}

/**
 * Every usable key of a command, best first: keys that run it here and now (current workspace and hovered panel, or
 * `panel` when given), then its other keys; browser-reserved keys are skipped.
 */
export function bindingLabels(commandId: string, panel: PanelScope | null = hoveredPanel()): string[] {
  const bs = currentBindings()
  const mine = bs.filter(b => b.id === commandId && !isBrowserReserved(b.keys))
  const ctx = keyContext(panel)
  // keys that run it here, the narrowest scope first (Paint's Ctrl+A before the global Alt+Shift+A)
  const here = mine.filter(b => resolveKey(b.keys, ctx, bs)?.id === commandId).sort((a, b) => scopeRank(b.scope) - scopeRank(a.scope))
  return [...new Set([...here, ...mine.filter(b => !here.includes(b))].map(b => b.keys))]
}
/**
 * The live shortcut of a command for tooltips and menus, e.g. "Ctrl+K"; '' when unbound. Resolved for the current
 * workspace and the hovered panel scope: a key that runs this command right now comes first.
 */
export function getBindingLabel(commandId: string): string {
  return bindingLabels(commandId)[0] ?? ''
}
/** Re-render on keymap changes (any rebind / reset / preset). */
export const useKeymapVersion = () => useKeymap(s => s.overrides)
/** React hook: getBindingLabel(commandId), re-rendered on rebind and on workspace / mode changes. */
export function useBinding(commandId: string): string {
  useKeymapVersion()
  useStore(s => `${s.workspace}:${s.mode}`)
  return getBindingLabel(commandId)
}

// ---------------------------------------------------------------------------------------------- the keyboard

export function installShortcuts(openPalette: () => void) {
  const onPalette = () => openPalette()
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    // typing goes to text fields; sliders, checkboxes and colour swatches keep the shortcuts (Ctrl+Z right after a drag)
    const passive = t?.tagName === 'INPUT' && ['range', 'checkbox', 'radio', 'color', 'button'].includes((t as HTMLInputElement).type)
    if (t && !passive && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    if (isModalActive()) return // a running transform owns the keyboard (axis keys, typed values, Enter, Esc)
    if (document.querySelector('[data-modal-open], [data-menu-open]')) return // dialogs and open menus own the keyboard
    const combo = comboOf(e)
    if (!combo) return
    const hit = resolveKey(combo, keyContext(), currentBindings())
    const run = (b: Binding) => { e.preventDefault(); byId[b.id]?.run() }
    // armed dope-sheet key edits (G/S after picking keys) own the keyboard until confirmed, ahead of the
    // hovered panel's own keys (S, Ctrl+D) so nothing else fires mid-gesture; undo cancels them
    if (timelineArmed()) {
      if (combo === 'Ctrl+Z' || combo === 'Ctrl+Shift+Z' || combo === 'Ctrl+Y') {
        setTimelineArmed(false)
        window.dispatchEvent(new CustomEvent('timeline-key', { detail: 'Esc' }))
      } else {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('timeline-key', { detail: combo }))
        return
      }
    }
    if (hit && hit.scope.startsWith('panel:')) return run(hit) // a hovered panel's own keys come first
    if (paintHotkey(e)) return
    if (overUV() && (UV_KEYS.includes(combo) || (UV_CLIP_KEYS.includes(combo) && useStore.getState().mode !== 'animate'))) { e.preventDefault(); window.dispatchEvent(new CustomEvent('uv-key', { detail: combo })); return }
    if (overTimeline() && TIMELINE_KEYS.includes(combo)) {
      e.preventDefault()
      if (combo === 'Space') { byId['anim.play']?.run(); return }
      if (combo === 'I') { byId['anim.insertKey']?.run(); return }
      if (combo === 'Del') { deleteTimelineKeys(); return }
      window.dispatchEvent(new CustomEvent('timeline-key', { detail: combo }))
      return
    }
    if (hit) run(hit)
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('open-palette', onPalette)
  return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('open-palette', onPalette) }
}
