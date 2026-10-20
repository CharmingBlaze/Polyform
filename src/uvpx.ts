/**
 * Pixel space for normalized UVs. UVs stay 0..1 (v up, like glTF); the editor shows and snaps them in the pixels of
 * the shown image, top-left origin like every paint program. With no image the "virtual" size is the size the
 * first paint stroke would create (Paint → texture size), so numbers stay meaningful before an image exists.
 */
import type { Vec2 } from './model'

/** One texel in UV units. */
export const texelSize = (tw: number, th: number): Vec2 => [1 / tw, 1 / th]
/** UV (v up) → image pixels (top-left origin). */
export const toPxUV = (u: number, v: number, tw: number, th: number): Vec2 => [u * tw, (1 - v) * th]
/** Image pixels (top-left origin) → UV. */
export const fromPxUV = (x: number, y: number, tw: number, th: number): Vec2 => [x / tw, 1 - y / th]

/** Round to a grid of n cells per unit; tidy float noise so 3/16 stays 0.1875 instead of 0.18750000000000003. */
export function snap1(x: number, n: number) {
  if (!(n > 0)) return x
  const r = Math.round(x * n) / n
  return Math.round(r * 1e12) / 1e12
}
/**
 * Snap a UV point to the pixel grid. `sub` = grid cells per texel: 0 off, 1 whole pixels, 2 half, 4 quarter, 8 eighth.
 * Non-square images snap each axis to its own texel.
 */
export function snapUV(u: number, v: number, tw: number, th: number, sub: number): Vec2 {
  if (!sub) return [u, v]
  return [snap1(u, tw * sub), snap1(v, th * sub)]
}
/** Snap a length (UV units) to whole grid cells, never to zero. */
export function snapLen(len: number, n: number, sub: number) {
  if (!sub || !(n > 0)) return len
  const cell = 1 / (n * sub)
  const s = Math.sign(len) || 1
  return s * Math.max(cell, snap1(Math.abs(len), n * sub))
}
/** "12.5 px" (up to 2 decimals, no trailing zeros). */
export function fmtPx(px: number) {
  const r = Math.round(px * 100) / 100
  return `${Object.is(r, -0) ? 0 : r} px`
}
/** Shown / virtual image size: the image's own size, else the default new-texture size. */
export function pxSize(img: { width: number; height: number } | null | undefined, fallback = 64): [number, number] {
  return img && img.width > 0 && img.height > 0 ? [img.width, img.height] : [fallback, fallback]
}
