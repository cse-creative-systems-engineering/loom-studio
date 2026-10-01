/**
 * The shared vocabulary, drawn (see `model/prop-vocab.ts`): one function per
 * family, so a `ghost` button and a `ghost` icon button, or an `underline`
 * Input and an `underline` Select, can never drift apart again. Before this,
 * three copies of the field styles and three of the button styles lived in
 * the renderer, already disagreeing in small ways.
 */

import type React from 'react'
import type { Theme } from './theme'

/** primary / secondary / outline / ghost / danger: background, ink and edge. */
export function emphasisStyle(t: Theme, variant: string): Pick<React.CSSProperties, 'background' | 'color' | 'border'> {
  switch (variant) {
    case 'primary':
      return { background: t.accent, color: t.textOnAccent, border: `1px solid ${t.accent}` }
    case 'danger':
      return { background: t.danger, color: t.textOnAccent, border: `1px solid ${t.danger}` }
    case 'outline':
      return { background: 'transparent', color: t.textPrimary, border: `1px solid ${t.borderStrong}` }
    case 'ghost':
      return { background: 'transparent', color: t.textSecondary, border: '1px solid transparent' }
    default:
      return { background: t.surface, color: t.textPrimary, border: `1px solid ${t.borderStrong}` }
  }
}

/** filled / outline / soft / underline / ghost: how a text field sits on the page. */
export function fieldSurface(t: Theme, variant: string): Pick<React.CSSProperties, 'background' | 'border' | 'borderBottom' | 'boxShadow' | 'borderRadius'> {
  switch (variant) {
    case 'outline':
      return { background: 'transparent', border: `1px solid ${t.borderStrong}` }
    case 'soft':
      return { background: t.bg, border: '1px solid transparent' }
    case 'underline':
      // A line to write on: no box, and no corners to round.
      return { background: 'transparent', border: '1px solid transparent', borderBottom: `1px solid ${t.borderStrong}`, borderRadius: '0px' }
    case 'ghost':
      return { background: 'transparent', border: '1px solid transparent' }
    default:
      // A well pressed into the surface: soft inner shadow, faint lit lower edge.
      return { background: t.wellFill, border: `1px solid ${t.wellEdge}`, boxShadow: t.wellShadow }
  }
}
