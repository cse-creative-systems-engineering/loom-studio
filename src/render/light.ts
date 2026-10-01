/**
 * The scene light, as CSS.
 *
 * One directional light (a sun) shines on the whole design. Everything that
 * has height or relief is shaded FROM it, so nothing is drawn by hand:
 *
 *  - ELEVATION. Something `z` px above its surface casts its shadow away from
 *    the light: further the higher it is and the lower the light stands, and
 *    softer and fainter the further it falls. Three layers, as in life: a
 *    tight CONTACT shadow where it nearly touches, a KEY shadow from the
 *    light, and a wide AMBIENT one from the sky.
 *  - RELIEF. A bevel's lit edge faces the light and its shaded edge faces
 *    away; a well pressed into the surface is shadowed on the side nearest
 *    the light. Turn the light and every bevel and well turns with it.
 *  - SHEEN. A gloss highlight sits on the face toward the light.
 *  - DARK THEMES. A shadow on a near-black page all but vanishes, so a raised
 *    surface there also catches more light: the higher it is, the lighter.
 *    One rule covers both themes, which hand-tuned shadow scales never did.
 *
 * Pure functions of (z, light, theme): the canvas, Preview and every export
 * compute exactly the same thing.
 */

import { DEFAULT_LIGHT, type SceneLight } from '../model/look'

const rad = (deg: number) => (deg * Math.PI) / 180
const r1 = (n: number) => Math.round(n * 10) / 10
const a3 = (n: number) => Math.max(0, Math.min(1, Math.round(n * 1000) / 1000))

/** The unit vector a shadow falls along, on screen (y down). */
export function shadowDir(light: SceneLight): { x: number; y: number } {
  return { x: -Math.sin(rad(light.angle)), y: Math.cos(rad(light.angle)) }
}

export interface Shade {
  /** RGB of shadows on this theme ("0 0 0" or a deep blue-grey). */
  shadow: string
  /** RGB of highlights. */
  light: string
  dark: boolean
}

export function shadeFor(colorScheme: string | undefined): Shade {
  const dark = colorScheme === 'dark'
  return { shadow: dark ? '0 0 0' : '15 23 42', light: '255 255 255', dark }
}

/** The light the document is lit by: its own, or the default sun. */
export function lightOf(meta: { light?: SceneLight } | undefined): SceneLight {
  return meta?.light ?? DEFAULT_LIGHT
}

/**
 * The shadows of something `z` px above its surface. Empty for z = 0.
 */
export function elevationShadows(z: number, light: SceneLight, shade: Shade): string[] {
  if (!(z > 0)) return []
  const d = shadowDir(light)
  // How far a shadow falls for each px of height: none from overhead, long
  // from a low light. Capped so a low sun cannot throw a shadow off the page.
  const reach = Math.min(2.6, 1 / Math.tan(rad(Math.max(5, light.height)))) * 0.85
  const soft = light.softness
  // Darker in dark themes, where a shadow has less to darken.
  const k = light.strength * (shade.dark ? 2.2 : 1)
  // Shadows fade as they grow: a high card's shadow is wide and faint.
  const fade = 1 / (1 + z / 36)
  const len = z * reach
  const contact = `${r1(d.x * Math.min(1, z * 0.25))}px ${r1(d.y * Math.min(1, z * 0.25))}px ${r1(1 + z * 0.12)}px 0 rgb(${shade.shadow} / ${a3(k * 0.24 * Math.max(0, 1 - z / 28))})`
  const key = `${r1(d.x * len)}px ${r1(d.y * len)}px ${r1(z * (0.5 + soft * 1.3))}px ${r1(-z * 0.12)}px rgb(${shade.shadow} / ${a3(k * 0.3 * fade)})`
  const ambient = `${r1(d.x * len * 0.3)}px ${r1(d.y * len * 0.3)}px ${r1(2 + z * (1.4 + soft * 2.2))}px ${r1(-z * 0.04)}px rgb(${shade.shadow} / ${a3(k * 0.16 * fade)})`
  // In a dark theme a raised surface's edge toward the light catches it: the
  // cue that reads as height where a shadow cannot. Always present (at zero
  // in a light theme) so every z has the same layers to animate between.
  const rim = `inset ${r1(d.x)}px ${r1(d.y)}px 0 0 rgb(${shade.light} / ${shade.dark ? a3(0.04 + Math.min(0.08, z * 0.006)) : 0})`
  // All always: a state that changes z then interpolates layer by layer.
  return [rim, contact, key, ambient]
}

/** How much a dark-theme surface brightens with height (0..0.12). */
export function liftTint(z: number, shade: Shade): number {
  return shade.dark && z > 0 ? a3(Math.min(0.12, z * 0.0045)) : 0
}

/** A bevel's two edges (and a pillow's soft rounding), lit from the light. */
export function bevelShadows(size: number, strength: number, style: 'raised' | 'sunken' | 'pillow', light: SceneLight, shade: Shade): string[] {
  if (!(size > 0) || !(strength > 0)) return []
  const d = shadowDir(light)
  // An inset shadow offset ALONG the shadow direction lights the edge facing
  // the light (the highlight is drawn on the near side of the offset).
  const hx = r1(d.x * size)
  const hy = r1(d.y * size)
  const hi = (a: number) => `rgb(${shade.light} / ${a3(a)})`
  const lo = (a: number) => `rgb(${shade.shadow} / ${a3(a)})`
  const blur = r1(size * (style === 'pillow' ? 2.2 : 0.6))
  const lit = `inset ${hx}px ${hy}px ${blur}px 0 ${hi(strength * (shade.dark ? 0.22 : 0.55))}`
  const dim = `inset ${-hx}px ${-hy}px ${blur}px 0 ${lo(strength * (shade.dark ? 0.55 : 0.28))}`
  const litRev = `inset ${-hx}px ${-hy}px ${blur}px 0 ${hi(strength * (shade.dark ? 0.16 : 0.45))}`
  const dimRev = `inset ${hx}px ${hy}px ${blur}px 0 ${lo(strength * (shade.dark ? 0.6 : 0.32))}`
  return style === 'sunken' ? [dimRev, litRev] : [lit, dim]
}

/** A well pressed into the surface: shadowed on the side nearest the light. */
export function insetShadows(depth: number, light: SceneLight, shade: Shade): string[] {
  if (!(depth > 0)) return []
  const d = shadowDir(light)
  const k = light.strength * (shade.dark ? 1.4 : 1)
  return [
    `inset ${r1(d.x * depth * 0.6)}px ${r1(d.y * depth * 0.6)}px ${r1(depth * 1.6)}px 0 rgb(${shade.shadow} / ${a3(k * 0.42)})`,
    // The far rim catches the light.
    `inset ${r1(-d.x)}px ${r1(-d.y)}px 0 0 rgb(${shade.light} / ${a3(shade.dark ? 0.05 : 0.5)})`,
  ]
}

/** A gloss highlight on the face toward the light, as a gradient layer. */
export function sheenLayer(amount: number, light: SceneLight): string | null {
  if (!(amount > 0)) return null
  // A CSS gradient angle points where the gradient GOES: from the light side
  // toward the shadow side, brightest first.
  const toward = (light.angle + 180) % 360
  return `linear-gradient(${Math.round(toward)}deg, rgb(255 255 255 / ${a3(amount * 0.32)}) 0%, rgb(255 255 255 / ${a3(amount * 0.08)}) 38%, rgb(255 255 255 / 0) 62%)`
}
