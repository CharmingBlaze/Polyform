/**
 * L/R side names for the symmetry system (spec SYM-1 `names`). One implementation for joints, pose paste, key
 * mirroring and weights; `bones.mirrorName` and `timeline/pose.mirrorPartner` are thin wrappers over it.
 *
 * Recognised sides (Blender 4.2 naming): `.L/.R`, `_L/_R`, `-l/-r`, ` L/ R` suffixes; `L_`, `R.`, `l-` prefixes;
 * `Left/Right`, `left/right`, `LEFT/RIGHT` as words, and (Blender rules, on by default) inside camelCase
 * (`handLeft`, `LeftLeg`). A single-letter side needs a separator (`handL` has no side). Number suffixes such as
 * `.001` are removed before matching (on by default). No imports, so any module can use it without cycles.
 */

export type Side = 'L' | 'R'

export interface NameRules {
  /** strip a Blender number suffix (`.001`) first, and return the partner without it (default true) */
  stripNumber?: boolean
  /** Left/Right inside camelCase words: `handLeft`, `LeftLeg` (default true); false = whole words only (legacy) */
  camelCase?: boolean
}

const SWAP: Record<string, string> = { Left: 'Right', Right: 'Left', left: 'right', right: 'left', LEFT: 'RIGHT', RIGHT: 'LEFT', L: 'R', R: 'L', l: 'r', r: 'l' }
const NUMBER = /\.\d{3,}$/
const WORD_LEGACY = /\b(Left|Right|left|right|LEFT|RIGHT)\b/g
// camelCase-aware: "Left" not after a capital and not followed by a lowercase letter, "left" not inside a word,
// "LEFT" standing alone. So handLeft / LeftLeg / left_arm / ARM_LEFT match; Leftover / bereft / LEFTY do not.
const WORD_CAMEL = /(?<![A-Z])(Left|Right)(?![a-z])|(?<![A-Za-z])(left|right)(?![a-z])|(?<![A-Za-z])(LEFT|RIGHT)(?![A-Za-z])/g
const SUFFIX = /([._\s-])([LRlr])$/
const PREFIX = /^([LRlr])([._\s-])/

/** Strip a trailing `.001` style number. */
export const stripNumber = (name: string) => name.replace(NUMBER, '')

/**
 * The partner name with every side marker swapped in one pass (so a swapped word is never swapped back), or null
 * when the name has no side. `Arm.L ↔ Arm.R`, `hand_l ↔ hand_r`, `L_foot ↔ R_foot`, `LeftLeg ↔ RightLeg`,
 * `Arm.L.001 → Arm.R`, `handL → null`, `Spine → null`.
 */
export function partnerName(name: string, rules: NameRules = {}): string | null {
  const strip = rules.stripNumber ?? true, camel = rules.camelCase ?? true
  const base = strip ? stripNumber(name) : name
  const word = camel ? WORD_CAMEL : WORD_LEGACY
  const out = base
    .replace(word, w => SWAP[w])
    .replace(SUFFIX, (_, sep: string, s: string) => sep + SWAP[s])
    .replace(PREFIX, (_, s: string, sep: string) => SWAP[s] + sep)
  return out === base ? null : out
}

/** Which side a name is on, or null for an unsided name (spine, root). */
export function sideOf(name: string, rules: NameRules = {}): Side | null {
  const strip = rules.stripNumber ?? true, camel = rules.camelCase ?? true
  const base = strip ? stripNumber(name) : name
  const s = base.match(SUFFIX)?.[2] ?? base.match(PREFIX)?.[1]
  if (s) return s.toUpperCase() as Side
  const w = [...base.matchAll(camel ? WORD_CAMEL : WORD_LEGACY)][0]?.[0]
  return w ? (w.toLowerCase() === 'left' ? 'L' : 'R') : null
}

/** Flip Names (Blender Armature › Names › Flip): the partner name, or the name unchanged when it has no side. */
export const flipName = (name: string, rules?: NameRules) => partnerName(name, rules) ?? name

/** Auto-Name Left/Right: a side-free base plus `.L` for +X, `.R` for −X; points on the plane (|x| <= eps) keep the base. */
export function autoName(name: string, x: number, eps = 1e-4): string {
  let base = stripNumber(name)
  if (sideOf(base)) {
    base = base.replace(SUFFIX, '').replace(PREFIX, '').replace(WORD_CAMEL, '').replace(/[._\s-]+$/, '').replace(/^[._\s-]+/, '') || base
  }
  return Math.abs(x) <= eps ? base : `${base}.${x > 0 ? 'L' : 'R'}`
}

/**
 * The legacy `bones.mirrorName` contract, kept exactly: whole-word Left/Right, no number stripping, and names with no
 * side get `.R` appended (used when creating a twin joint).
 */
export const LEGACY_RULES: NameRules = { stripNumber: false, camelCase: false }
export const mirrorNameLegacy = (name: string) => partnerName(name, LEGACY_RULES) ?? `${name}.R`
