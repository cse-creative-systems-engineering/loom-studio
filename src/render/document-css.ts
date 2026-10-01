/**
 * Every stylesheet a document generates, as one string.
 *
 * The editor canvas, the live preview and both exports inject exactly this, so
 * none of them can forget a layer (responsive layout, part styling, interaction
 * states): a surface that shipped the responsive rules
 * but not the interaction states would show a design that does not match what
 * the others show.
 */

import type { Document } from '../model/types'
import type { Theme } from './theme'
import { responsiveCss } from './responsive'
import { stateCss } from './states'
import { partCss } from './parts'
import { lookCss } from './look'

export function documentCss(doc: Document, theme?: Theme): string {
  // Looks come last: they are the most specific intent, and win ties.
  return [responsiveCss(doc), partCss(doc, theme), stateCss(doc, theme), lookCss(doc, theme)].filter(Boolean).join('\n')
}
