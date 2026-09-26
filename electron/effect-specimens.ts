/**
 * Renders a page that exercises every effect, so the atmosphere layer can be
 * judged by eye rather than by assertion. This is a LOOK artifact, not a test:
 * the tests prove the effects are present in the markup, this proves they are
 * presentable.
 */

import { DEFAULT_EFFECTS, EFFECT_KEYFRAMES, type EffectValues } from '../src/render/effects'
import { getTheme } from '../src/render/theme'

/** One specimen per effect, with the props that make it visible. */
const SPECIMENS: Array<{ title: string; effect: Partial<EffectValues>; body: string }> = [
  { title: 'Baseline', effect: {}, body: '<p>No effects. The thing every other card is measured against.</p>' },
  { title: 'Glass', effect: { glass: true, glassBlur: 24, glassSaturation: 160 }, body: '<p>Frosted, saturated backdrop.</p>' },
  { title: 'Aurora', effect: { aurora: true, auroraSpeed: 7, auroraBlur: 44 }, body: '<p>Three drifting colour orbs.</p>' },
  { title: 'Grain', effect: { grain: true, grainIntensity: 0.22 }, body: '<p>Overlay noise, so flat fills stop looking like plastic.</p>' },
  { title: 'Spotlight', effect: { spotlight: true, spotlightSize: 300, spotlightColor: 'rgba(255,255,255,0.18)' }, body: '<p>Cursor-following radial highlight.</p>' },
  { title: 'Shimmer', effect: { shimmer: true, shimmerSpeed: 2.4, shimmerBorderWidth: 2 }, body: '<p>A light sweep across the border.</p>' },
  { title: 'Glow', effect: { glow: true, glowColor: '#7C3AED', glowSpread: 40 }, body: '<p>Coloured bloom underneath.</p>' },
  { title: 'Tilt', effect: { tilt: true, tiltMax: 12 }, body: '<p>3D tilt that follows the pointer.</p>' },
  { title: 'Motion', effect: { motion: 'scale', hoverScale: 1.04 }, body: '<p>Hover scale with a spring-ish curve.</p>' },
  { title: 'Chromatic', effect: { chromatic: true }, body: '<p>Split-fringe text shadow.</p>' },
  {
    title: 'Everything',
    effect: {
      glass: true, glassBlur: 26, grain: true, aurora: true, spotlight: true,
      shimmer: true, glow: true, chromatic: true, motion: 'scale', hoverScale: 1.02,
    },
    body: '<p>All of them at once. If this reads as mush, the defaults are wrong.</p>',
  },
]

/** Minimal, dependency-free effect CSS for the specimen page. */
function specimenCss(): string {
  return `
${EFFECT_KEYFRAMES}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 40px;
  background: #0A0A0B; color: #EDEDEF;
  font: 400 14px/1.6 Inter, system-ui, sans-serif;
}
h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.3px; }
.lede { color: #8A8A8F; margin: 0 0 32px; }
.grid {
  display: grid; gap: 20px;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}
.cell { position: relative; }
/* The card is the effect surface. */
.card {
  position: relative; overflow: hidden;
  min-height: 150px; padding: 22px;
  border-radius: 18px; border: 1px solid rgba(255,255,255,0.09);
  background: #141417; color: #EDEDEF;
  transition: transform 220ms cubic-bezier(0.2,0.8,0.3,1);
}
.card h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; letter-spacing: 0.2px; }
.card p { margin: 0; color: #A1A1AA; font-size: 13px; }
.e-grain { position:absolute; inset:0; pointer-events:none; mix-blend-mode:overlay; opacity:0.22;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E"); }
.e-spotlight { position:absolute; inset:0; pointer-events:none;
  background: radial-gradient(320px circle at var(--mx,50%) var(--my,50%), rgba(255,255,255,0.16), transparent 70%); }
.e-shimmer { position:absolute; inset:0; pointer-events:none; overflow:hidden; }
.e-shimmer::before { content:''; position:absolute; inset:-50%;
  background: linear-gradient(105deg, transparent 42%, rgba(255,255,255,0.16) 50%, transparent 58%);
  animation: loom-shimmer-sweep var(--shimmer-dur, 3s) linear infinite; }
.e-aurora { position:absolute; inset:0; pointer-events:none; overflow:hidden; }
.e-aurora i { position:absolute; border-radius:50%; mix-blend-mode:screen; opacity:0.55;
  animation: loom-float var(--dur,7s) ease-in-out infinite; }
.e-aurora i:nth-child(1) { left:8%; top:6%; width:60%; height:60%; filter:blur(22px);
  background: radial-gradient(circle, #6366f1 0%, transparent 70%); }
.e-aurora i:nth-child(2) { right:4%; top:28%; width:52%; height:52%; filter:blur(44px);
  background: radial-gradient(circle, #8b5cf6 0%, transparent 70%); animation-delay:-2s; }
.e-aurora i:nth-child(3) { left:28%; bottom:-4%; width:56%; height:56%; filter:blur(52px);
  background: radial-gradient(circle, #ec4899 0%, transparent 70%); animation-delay:-4s; }
.glass { backdrop-filter: blur(24px) saturate(160%); background: rgba(20,20,23,0.55); }
.glow { box-shadow: 0 18px 50px -12px rgba(124,58,237,0.55); }
.chromatic p { text-shadow: 1px 0 rgba(255,0,255,0.55), -1px 0 rgba(0,255,255,0.55); }
.tilt { transform: perspective(800px) rotateY(0deg) rotateX(0deg); transform-style: preserve-3d; }
.magnet { transition: transform 180ms cubic-bezier(0.2,0.8,0.3,1); }
`
}

function cardHtml(spec: { title: string; effect: Partial<EffectValues>; body: string }): string {
  const e = spec.effect
  const e0 = { ...DEFAULT_EFFECTS, ...e }
  const cls = ['card']
  if (e0.glass) cls.push('glass')
  if (e0.glow) cls.push('glow')
  if (e0.chromatic) cls.push('chromatic')
  if (e0.tilt) cls.push('tilt')
  if (e0.motion === 'scale') cls.push('magnet')

  const layers: string[] = []
  if (e0.aurora) layers.push('<div class="e-aurora"><i style="--dur:7s"></i><i></i><i></i></div>')
  if (e0.grain) layers.push(`<div class="e-grain" style="opacity:${e0.grainIntensity}"></div>`)
  if (e0.spotlight) layers.push(`<div class="e-spotlight" style="background:radial-gradient(${e0.spotlightSize}px circle at var(--mx,50%) var(--my,50%), ${e0.spotlightColor}, transparent 70%)"></div>`)
  if (e0.shimmer) layers.push(`<div class="e-shimmer" style="--shimmer-dur:${e0.shimmerSpeed}s"></div>`)

  const style: string[] = []
  if (e0.glass) {
    style.push(`backdrop-filter:blur(${e0.glassBlur}px) saturate(${e0.glassSaturation}%)`)
    style.push('background:rgba(20,20,23,0.55)')
  }
  if (e0.glow) style.push(`box-shadow:0 18px ${e0.glowSpread}px -12px ${e0.glowColor}cc`)

  return `<div class="${cls.join(' ')}" style="${style.join(';')}">
  ${layers.join('\n  ')}
  <h2>${spec.title}</h2>
  ${spec.body}
</div>`
}

/** The full specimen page, as a standalone HTML string. */
export function specimenHtml(): string {
  const t = getTheme('midnight')
  void t
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Loom — effect specimens</title>
<style>${specimenCss()}</style>
</head><body>
<h1>Effect specimens</h1>
<p class="lede">Every atmosphere effect Loom can emit, one card each. Move the pointer over the tilt and magnet cards to see them respond.</p>
<div class="grid">
${SPECIMENS.map((s) => `<div class="cell">${cardHtml(s)}</div>`).join('\n')}
</div>
<script>
// Spotlight follows the pointer; magnet and tilt transform the card.
document.querySelectorAll('.card').forEach((card) => {
  const spot = card.querySelector('.e-spotlight')
  card.addEventListener('pointermove', (ev) => {
    const r = card.getBoundingClientRect()
    const x = ((ev.clientX - r.left) / r.width) * 100
    const y = ((ev.clientY - r.top) / r.height) * 100
    if (spot) { spot.style.setProperty('--mx', x + '%'); spot.style.setProperty('--my', y + '%') }
    if (card.classList.contains('tilt')) {
      card.style.transform = 'perspective(800px) rotateY(' + ((x - 50) / 12) + 'deg) rotateX(' + (-(y - 50) / 12) + 'deg)'
    }
    if (card.classList.contains('magnet')) {
      card.style.transform = 'translate(' + ((x - 50) / 12) + 'px,' + ((y - 50) / 12) + 'px)'
    }
  })
  card.addEventListener('pointerleave', () => { card.style.transform = '' })
})
</script>
</body></html>`
}
