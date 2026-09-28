/**
 * What is behind the UI: nothing, the theme's page colour, or a chosen
 * colour (alpha included), optionally blurring what shows through.
 *
 * Nothing is the default. The preview used to put every design on the
 * theme's page colour inside a framed "screen", so a sidebar meant to float
 * over the desktop could never be seen floating. A background is now
 * something you choose.
 */

import type { PageBackground } from './types'
import { isSafeColor } from '../render/states'

export const MAX_PAGE_BLUR = 60

/** A valid page, or null. Used by the op and by the file loader. */
export function cleanPage(raw: unknown): PageBackground | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.background !== 'none' && r.background !== 'theme' && r.background !== 'color') return null
  const out: PageBackground = { background: r.background }
  if (r.color !== undefined) {
    if (!isSafeColor(r.color)) return null
    out.color = (r.color as string).trim()
  }
  if (r.background === 'color' && out.color === undefined) return null
  if (r.blur !== undefined) {
    if (typeof r.blur !== 'number' || !Number.isFinite(r.blur)) return null
    out.blur = Math.max(0, Math.min(MAX_PAGE_BLUR, Math.round(r.blur)))
  }
  return out
}

/**
 * The page's own fill, as CSS, for every surface that draws the page:
 * `undefined` when there is none (transparent: whatever is behind shows).
 */
export function pageFill(page: PageBackground | undefined, themeBg: string): string | undefined {
  if (!page || page.background === 'none') return undefined
  if (page.background === 'theme') return themeBg
  return page.color
}
