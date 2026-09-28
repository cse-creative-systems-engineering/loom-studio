/**
 * The output typeface, carried with the design.
 *
 * A design that names a font it does not ship is a design that looks
 * different on every machine: `ui-sans-serif` is SF on macOS, Segoe on
 * Windows and DejaVu Sans on most Linux desktops, and the last of those is
 * a large part of why the output read as "home made". So the faces travel
 * WITH the output: every surface that shows a design (preview, desktop run,
 * the exported page) registers them from here, as data URLs, needing no
 * network and no install.
 *
 * Latin only, upright and italic, on the variable optical-size axis: that
 * covers U+0000-00FF plus typographic punctuation. Characters outside it fall
 * through `unicode-range` to the next family in the theme's stack, which is
 * the browser's own resolution, not a Loom fallback.
 */

import interLatin from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2'
import interLatinItalic from '@fontsource-variable/inter/files/inter-latin-opsz-italic.woff2'

/** The family the faces register under, and the one the themes ask for first. */
export const OUTPUT_FAMILY = 'Inter Variable'

const LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'

function face(src: string, style: 'normal' | 'italic'): string {
  // Both bundlers are configured to hand these over as data URLs (see
  // vite.config.ts and the esbuild `--loader:.woff2=dataurl`). A path here
  // would make an export that silently loses its font the moment it leaves
  // this machine, so anything else is a build error, not something to paper
  // over.
  if (!src.startsWith('data:')) throw new Error(`output font was not inlined: ${src.slice(0, 60)}`)
  return `@font-face{font-family:'${OUTPUT_FAMILY}';font-style:${style};font-weight:100 900;font-display:block;src:url(${src}) format('woff2');unicode-range:${LATIN_RANGE}}`
}

let cached: string | null = null

/** The `@font-face` rules for the output typeface. */
export function fontFaceCss(): string {
  return (cached ??= face(interLatin, 'normal') + face(interLatinItalic, 'italic'))
}
