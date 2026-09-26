/**
 * Round-trip tests against Shane's REAL Atelier bundle.
 *
 * The bundle at ~/Downloads/atelier-ai-bundle.zip is the actual interchange
 * contract, so this imports it rather than a synthetic fixture. If the bundle
 * is absent the checks skip loudly rather than pass vacuously.
 */

import { importDsl, exportDsl, TYPE_ALIAS } from '../src/model/dsl'
import { resolveBundle, fromAtelierColors, toBundle, toCssVariables } from '../src/render/tokens'
import { normalizeEffects, applyEffects, DEFAULT_EFFECTS } from '../src/render/effects'
import { getTheme } from '../src/render/theme'
import { snapMove, artboardAnchors, type SnapBox } from '../src/model/snap'
import { clampZ } from '../src/model/ops'
import { ATELIER_BUNDLE } from '../src/model/atelier-bundle.generated'
import '../src/model/toolbox'
import { getComponent } from '../src/model/registry'

export function bundleTests(): Array<{ name: string; pass: boolean; detail: string }> {
  const out: Array<{ name: string; pass: boolean; detail: string }> = []
  const ok = (name: string, pass: boolean, detail = '') => out.push({ name, pass, detail })

  /* ---- tokens ---------------------------------------------------- */

  const atelierColors = {
    background: '#0A0A0B',
    foreground: '#0A0A0B',
    primary: '#7C3AED',
    accent: '#06B6D4',
    muted: 'rgba(10,10,11,0.5)',
  }
  const b = fromAtelierColors(atelierColors)
  ok('atelier colors map to a bundle', b.colors?.bg === '#0A0A0B' && b.colors?.accent === '#7C3AED')
  ok('atelier muted maps to textMuted', b.colors?.textMuted === 'rgba(10,10,11,0.5)')

  const t1 = resolveBundle('midnight', b)
  ok('bundle overrides bg', t1.bg === '#0A0A0B', t1.bg)
  ok('bundle overrides accent', t1.accent === '#7C3AED', t1.accent)
  // A bundle that does not mention a field must leave that field alone.
  const sparse = resolveBundle('midnight', { colors: { accent: '#ff0000' } })
  ok('bundle leaves untouched fields alone',
    sparse.textPrimary === getTheme('midnight').textPrimary && sparse.bg === getTheme('midnight').bg)

  // Resolving a bundle must not mutate the base theme it derived from.
  const base = getTheme('midnight')
  const before = base.accent
  resolveBundle('midnight', { colors: { accent: '#ff0000' } })
  ok('resolving a bundle does not mutate the base theme', getTheme('midnight').accent === before)

  const t2 = resolveBundle('midnight', { spacing: { scale: [2, 4, 8, 16, 32, 64, 128] } })
  ok('spacing scale maps onto named steps', t2.space1 === 2 && t2.space4 === 16 && t2.space8 === 128,
    `${t2.space1}/${t2.space4}/${t2.space8}`)

  const t3 = resolveBundle('midnight', { typography: { sizes: { md: 17, xxl: 40 } } })
  ok('typography sizes override', t3.textMd === 17 && t3.textXxl === 40)

  // Round trip: theme -> bundle -> theme.
  const rt = resolveBundle('midnight', toBundle(getTheme('daylight')))
  ok('theme survives a bundle round trip', rt.bg === getTheme('daylight').bg && rt.accent === getTheme('daylight').accent)

  const css = toCssVariables(getTheme('midnight'))
  ok('css variables emitted', css.includes('--loom-bg:') && css.includes('--loom-accent:'))
  ok('css variables close the block', css.trim().endsWith('}'))

  /* ---- effects ---------------------------------------------------- */

  ok('default effects are all off', Object.entries(DEFAULT_EFFECTS)
    .filter(([k]) => k.endsWith('Enabled') || ['grain', 'glass', 'shimmer', 'glow', 'tilt', 'chromatic'].includes(k))
    .every(([, v]) => v === false))

  const norm = normalizeEffects({ grain: 'true', grainIntensity: '0.3', bogusKey: 1 })
  ok('effects coerce string booleans', norm.grain === true)
  ok('effects coerce string numbers', norm.grainIntensity === 0.3)
  ok('effects drop unknown keys', !('bogusKey' in norm))

  const effOut = applyEffects({ ...DEFAULT_EFFECTS, aurora: true, glass: true, glassBlur: 30 }, getTheme('midnight'), {}, 'n1')
  ok('glass sets backdrop-filter', String(effOut.style.backdropFilter ?? '').includes('blur(30px)'))
  ok('glass sets an inner highlight', String(effOut.style.boxShadow ?? '').includes('inset'))
  ok('aurora emits three orbs', effOut.layers.length === 3, `${effOut.layers.length} layers`)

  const noEffects = applyEffects(DEFAULT_EFFECTS, getTheme('midnight'), {}, 'n1')
  ok('no effects means no decoration layers', noEffects.layers.length === 0)
  ok('no effects means no backdrop-filter', noEffects.style.backdropFilter === undefined)

  const tilt = applyEffects({ ...DEFAULT_EFFECTS, tilt: true }, getTheme('midnight'), { localX: 40, localY: 20 }, 'n1')
  ok('tilt produces a 3D transform', String(tilt.style.transform ?? '').includes('perspective(800px)'))
  const tiltUnhovered = applyEffects({ ...DEFAULT_EFFECTS, tilt: true }, getTheme('midnight'), {}, 'n1')
  ok('tilt is inert without pointer input', tiltUnhovered.style.transform === undefined)

  /* ---- snap ------------------------------------------------------- */

  const others: SnapBox[] = [{ id: 'a', x: 200, y: 200, w: 100, h: 40 }]

  // Fixtures keep the mover vertically near `a` (y overlap >= crossOverlap)
  // so they test line matching, not the 2D-proximity gate. `gap` is for the
  // one test that deliberately exercises the gate.
  const near = (x: number, gap = 0): SnapBox => ({ id: 'm', x, y: 205 + gap, w: 100, h: 40 })

  // Left edge approaching another's left edge.
  const s1 = snapMove(near(203), others, { threshold: 6 })
  ok('snaps left edge to a neighbour left edge', s1.x === 200, `x=${s1.x}`)
  ok('publishes a vertical guide', s1.guides.some((g) => g.axis === 'x'))
  ok('guide carries a delta label', (s1.guides[0]?.label ?? '').includes('px'))

  // Right edge to neighbour right edge. Neighbour `r` spans x 250..300; the
  // mover must be placed so its RIGHT edge (x+100) is what lands on 300, with
  // the left edge far enough away not to win first. x=196 -> right=296, delta +4.
  const rightTarget: SnapBox[] = [{ id: 'r', x: 250, y: 205, w: 50, h: 40 }]
  const s2 = snapMove(near(196), rightTarget, { threshold: 6 })
  ok('snaps moving right edge to neighbour right edge', s2.x + 100 === 300, `right=${s2.x + 100}`)

  // Centre alignment: mover centre (x+50) -> 250 needs x=200.
  const s3 = snapMove(near(199), others, { threshold: 6 })
  ok('snaps centres together', s3.x + 50 === 250, `centre=${s3.x + 50}`)

  // Out of threshold horizontally AND far away vertically: no snap at all.
  const s4 = snapMove(near(150, 900), others, { threshold: 6 })
  ok('does not snap beyond the threshold', s4.x === 150 && s4.guides.length === 0, `x=${s4.x}`)

  // The gate itself: horizontally aligned but 900px away vertically. Axis-only
  // matching would snap this; 2D proximity must not.
  const s4b = snapMove(near(203, 900), others, { threshold: 6 })
  ok('does not snap to a neighbour far off-axis', s4b.x === 203, `x=${s4b.x}`)

  // Self-exclusion: a moving node must not snap to itself.
  const selfSnap = snapMove({ id: 'm', x: 0, y: 0, w: 10, h: 10 }, [{ id: 'm', x: 0, y: 0, w: 10, h: 10 }], { exclude: new Set(['m']) })
  ok('excluded nodes never snap', selfSnap.guides.length === 0)

  // Grid fallback only when no edge snap claimed the axis.
  const g1 = snapMove(near(203), others, { grid: 4, threshold: 6 })
  ok('edge snap wins over the grid on x', g1.x === 200, `x=${g1.x}`)
  ok('grid snaps the unsnapped axis', g1.y % 4 === 0, `y=${g1.y}`)

  const anchors = artboardAnchors(1200, 800)
  const s5 = snapMove({ id: 'm', x: 549, y: 500, w: 100, h: 40 }, [], { anchors, threshold: 6 })
  ok('artboard centre is a snap anchor', s5.x + 50 === 600, `centre=${s5.x + 50}`)

  /* ---- z clamp ---------------------------------------------------- */

  ok('z clamps to a sane maximum', clampZ(Number.MAX_SAFE_INTEGER) === 1_000_000)
  ok('z clamps negatives to zero', clampZ(-5) === 0)
  ok('z survives repeated bring-to-front', clampZ(clampZ(1_000_000) + 1) === 1_000_000)
  ok('z handles NaN', clampZ(Number.NaN) === 0)

  /* ---- the real bundle ------------------------------------------- */

  if (ATELIER_BUNDLE) {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(ATELIER_BUNDLE)
    } catch (e) {
      ok('atelier bundle parses', false, String(e))
    }
    if (parsed) {
      const imp = importDsl(parsed)
      // Guard BEFORE dereferencing: a null doc is a finding to report, not a
      // reason to throw and lose the rest of the report.
      if (!imp.doc) {
        ok('atelier bundle imports', false, `importDsl returned null: ${imp.issues.join('; ')}`)
      } else {
        const doc = imp.doc
        const count = Object.keys(doc.nodes).length - 1
        ok('atelier bundle imports', true)
        ok('atelier bundle yields 8 elements', count === 8, `got ${count}`)
        ok('atelier artboard imported', doc.meta.artboard?.w === 1200 && doc.meta.artboard?.h === 800,
          JSON.stringify(doc.meta.artboard))
        ok('atelier snap grid imported', doc.meta.snapGrid === 4)
        // Remapping is the adapter WORKING, not a failure: Atelier's type names
        // differ from Loom's by design. What must hold is that every element
        // resolved to a REAL component rather than falling back to Panel.
        ok('every atelier type resolved to a real component',
          Object.values(doc.nodes).every((n) => getComponent(n.type) !== undefined),
          Object.values(doc.nodes).filter((n) => !getComponent(n.type)).map((n) => n.type).join(','))
        // The failure worth catching is a type MISSING FROM THE ALIAS TABLE
        // entirely, which lands on the importer's default. A type that maps to
        // Card because it genuinely is a card is correct, not a fallthrough.
        const atelierTypes = (parsed as Array<{ type: string }>).map((e) => e.type)
        const missing = atelierTypes.filter((t) => !(t in TYPE_ALIAS))
        ok('every atelier type is explicitly mapped, none falls through',
          missing.length === 0, `unmapped: ${missing.join(',')}`)
        ok('remap report accounts for all 8 elements',
          imp.remapped.length > 0 && imp.remapped.reduce((a, r) => a + r.count, 0) === 8,
          imp.remapped.map((r) => `${r.from}->${r.to}`).join(','))
        // The meaningful check: 8 distinct SEMANTIC roles, not 8 identical
        // fallbacks. Two cards legitimately collapse to Card.
        const resolved = Object.values(doc.nodes).filter((n) => n.id !== doc.root).map((n) => n.type)
        ok('atelier 8 types resolve to >=4 distinct components',
          new Set(resolved).size >= 4,
          [...new Set(resolved)].join(','))
        ok('atelier element count preserved', resolved.length === 8, `${resolved.length}`)
        ok('import is issue-free', imp.issues.length === 0, imp.issues.join('; '))

        const nonEmpty = Object.values(doc.nodes).filter((n) => n.id !== doc.root)
        ok('every imported element carries geometry',
          nonEmpty.every((n) => typeof n.props.x === 'number' && typeof n.props.y === 'number'),
          `${nonEmpty.filter((n) => typeof n.props.x !== 'number').length} missing x`)
        ok('every imported element carries its schema defaults',
          nonEmpty.every((n) => Object.keys(getComponent(n.type)?.props ?? {}).length > 0 &&
            Object.keys(n.props).length > 0),
          `${nonEmpty.filter((n) => Object.keys(n.props).length === 0).length} with no props`)
        ok('effects survive the import',
          nonEmpty.some((n) => n.effects && Object.keys(n.effects).length > 5))

        // Export back out and re-import: the contract must be stable.
        const back = exportDsl(doc)
        ok('export produces the same element count', back.elements?.length === 8, `${back.elements?.length}`)
        const reimport = importDsl(back)
        ok('export -> import round trip is valid', reimport.doc !== null, reimport.issues.join('; '))
        const reCount = reimport.doc ? Object.keys(reimport.doc.nodes).length - 1 : 0
        ok('round trip preserves element count', reCount === 8, `got ${reCount}`)

        const firstOrig = Object.keys(doc.nodes).find((k) => k !== doc.root)
        const firstNew = reimport.doc ? Object.keys(reimport.doc.nodes).find((k) => k !== reimport.doc!.root) : undefined
        const origX = firstOrig ? doc.nodes[firstOrig]?.props.x : undefined
        const newX = firstNew ? reimport.doc?.nodes[firstNew]?.props.x : undefined
        ok('round trip preserves coordinates', origX !== undefined && origX === newX, `${origX} vs ${newX}`)
      }
    }
  } else {
    out.push({ name: 'atelier bundle present', pass: false, detail: 'bundle not found at ~/Downloads' })
  }

  return out
}
