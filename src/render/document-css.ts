/**
 * Every stylesheet a document generates, as one string.
 *
 * The editor canvas, the live preview and both exports inject exactly this, so
 * none of them can forget a layer: a surface that shipped the responsive rules
 * but not the interaction states would show a design that does not match what
 * the others show.
 */

import type { Document } from '../model/types'
import type { Theme } from './theme'
import { responsiveCss } from './responsive'
import { stateCss } from './states'

export function documentCss(doc: Document, theme?: Theme): string {
  return [responsiveCss(doc), stateCss(doc, theme)].filter(Boolean).join('\n')
}
