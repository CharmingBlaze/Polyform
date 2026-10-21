/** The work area for menus in viewport px: from the header's bottom edge to the footer's top edge (status bar). */
import type { Area } from './geometry'

export function workArea(): Area {
  const W = innerWidth, H = innerHeight
  const head = document.querySelector('header.header')?.getBoundingClientRect()
  const foot = document.querySelector('footer.status')?.getBoundingClientRect()
  const top = head && head.height > 0 ? Math.max(0, head.bottom) : 0
  const bottom = foot && foot.height > 0 ? Math.min(H, foot.top) : H
  return { top, bottom: bottom > top ? bottom : H, left: 0, right: W }
}
