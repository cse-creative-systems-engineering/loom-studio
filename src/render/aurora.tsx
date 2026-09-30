/**
 * The aurora page: colour that wanders behind the UI.
 *
 * Glass is only as good as what is behind it: over a flat page a translucent
 * panel is just a slightly lighter panel. This is the thing behind it: a few
 * large, very soft blobs of the theme's colours drifting on long, unrelated
 * paths, so the glass above them always has light moving through it.
 *
 * One component, drawn by every surface that draws the page (the canvas, the
 * docked preview, the preview window, the desktop run and the export), so the
 * page looks the same wherever it is seen. Its motion lives in the shared
 * stylesheet (`auroraCss`), which every one of those surfaces already mounts.
 *
 * Cost: each blob is a radial gradient with a blur, animated by `transform`
 * only, so the compositor moves pre-rendered layers and nothing repaints.
 * People who ask their system for less motion get the same colour, still.
 */

import type { Theme } from './theme'

/** Where each blob starts, how big it is, and which of the four paths it wanders. */
const BLOBS: Array<{ left: string; top: string; size: number; path: number; secs: number; delay: number }> = [
  // One per region (the four corners and the middle), each large enough that
  // wherever it has wandered its neighbours still cover the page: no corner
  // is ever left flat black.
  { left: '-22%', top: '-30%', size: 78, path: 1, secs: 38, delay: 0 },
  { left: '46%', top: '-26%', size: 72, path: 2, secs: 46, delay: -12 },
  { left: '-18%', top: '38%', size: 74, path: 3, secs: 52, delay: -27 },
  { left: '50%', top: '42%', size: 70, path: 4, secs: 43, delay: -8 },
  { left: '18%', top: '8%', size: 56, path: 2, secs: 61, delay: -35 },
]

/**
 * The page behind the UI: the theme's page colour with its colour drifting
 * through it.
 *
 * Drawn LAST in its host at `z-index:-1`, with the host isolated
 * (`isolation:isolate`): it paints above the host's own background and below
 * everything the design draws, without taking the first-child slot every
 * surface reserves for the design's root.
 */
export function AuroraBackdrop({ theme }: { theme: Theme }) {
  const colours = theme.aurora
  return (
    <div
      data-loom-aurora=""
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: -1, background: theme.bg, borderRadius: 'inherit' }}
    >
      {BLOBS.map((b, i) => (
        <span
          key={i}
          data-loom-blob={String(b.path)}
          style={{
            left: b.left,
            top: b.top,
            width: `${b.size}%`,
            background: `radial-gradient(closest-side, ${colours[i % colours.length]}, transparent)`,
            opacity: theme.auroraOpacity,
            mixBlendMode: theme.auroraBlend,
            animationDuration: `${b.secs}s`,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}
    </div>
  )
}

/**
 * The blobs' shape and motion. Four wandering paths, each a long loop
 * through five waypoints; with unrelated durations the blobs never line up
 * the same way twice. Translations are in the blob's own size, so the motion
 * scales with the page.
 */
export function auroraCss(): string {
  const paths = [
    ['0,0', '38%,22%', '12%,48%', '-26%,18%', '-8%,-20%'],
    ['0,0', '-34%,28%', '-12%,58%', '22%,30%', '14%,-16%'],
    ['0,0', '30%,-26%', '56%,6%', '18%,34%', '-20%,12%'],
    ['0,0', '-28%,-30%', '-52%,4%', '-18%,26%', '16%,8%'],
  ]
  const scales = ['1', '1.18', '0.9', '1.1', '0.95']
  // Played `alternate`, so each path runs out and back and needs no closing stop.
  const frames = paths
    .map((pts, p) => `@keyframes loom-wander-${p + 1}{${pts.map((xy, k) => `${k * 25}%{transform:translate(${xy}) scale(${scales[k]})}`).join('')}}`)
    .join('\n')
  return [
    frames,
    '[data-loom-blob]{position:absolute;aspect-ratio:1;border-radius:50%;filter:blur(48px);will-change:transform;animation-timing-function:ease-in-out;animation-iteration-count:infinite;animation-direction:alternate}',
    ...[1, 2, 3, 4].map((p) => `[data-loom-blob="${p}"]{animation-name:loom-wander-${p}}`),
    '@media (prefers-reduced-motion: reduce){[data-loom-blob]{animation:none !important}}',
  ].join('\n')
}
