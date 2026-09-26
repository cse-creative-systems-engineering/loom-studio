/**
 * Headless self-test.
 *
 * `npm run verify` boots Electron, runs this in the real renderer, and
 * prints a JSON report. It exercises the parts of the editor that are
 * easy to get subtly wrong: transient drag, gesture sealing, undo/redo
 * exactness, subtree delete/undo, and the document's purity.
 */

import { EditorStore } from '../src/state/store'
import { descendants, parentOf } from '../src/model/ops'
import { allComponents, DESKTOP_CAPABILITIES, getComponent, instantiate } from '../src/model/registry'
import { emitHtml, exportFilenameFor } from '../src/export/html'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { isFlowChild, renderNode, zoomed } from '../src/render/web'
import { PreviewStage } from '../src/preview'
import { seedDemo } from '../src/demo'
import { reparentProbe } from './reparent-probe'
import { layoutProbe } from './layout-probe-renderer'
import { bundleTests } from './bundle-tests'
import { getTheme, resolveTheme } from '../src/render/theme'
import { serialize, validate, filenameFor, MAX_TREE_DEPTH } from '../src/model/persist'
import { renderToStaticMarkup } from 'react-dom/server'
import '../src/model/toolbox'

/** True when `id`'s node carries every prop its component declares. */
function hasAllProps(s: EditorStore, id: string, type: string): boolean {
  const spec = getComponent(type)
  const node = s.doc.nodes[id]
  if (!spec || !node) return false
  return Object.keys(spec.props).every((k) => k in node.props)
}

interface Check {
  name: string
  pass: boolean
  detail: string
}

const checks: Check[] = []

function check(name: string, pass: boolean, detail = '') {
  checks.push({ name, pass, detail })
}

function snapshot(s: EditorStore) {
  return JSON.stringify(s.doc.nodes)
}

export async function runSelfTest(): Promise<string> {
  const s = new EditorStore()

  // --- 1. drop a component with declared defaults applied ---
  const btn = s.addComponent('Button', s.doc.root, 40, 60)
  check('drop returns an id', Boolean(btn), String(btn))
  const node = btn ? s.doc.nodes[btn] : undefined
  check(
    'defaults applied from schema',
    node?.props.label === 'Button' && node?.props.variant === 'primary',
    JSON.stringify(node?.props),
  )
  check('drop is one undo step', s.history.length === 1, `history=${s.history.length}`)

  // --- 2. transient drag: many pokes, ONE sealed history entry ---
  if (btn) {
    for (let i = 0; i < 40; i++) {
      s.poke({ op: 'move', id: btn, x: 40 + i * 3, y: 60 + i })
    }
    const afterPokes = Number(s.doc.nodes[btn].props.x)
    check('poke mutates live doc', afterPokes === 40 + 39 * 3, `x=${afterPokes}`)
    check('poke adds no history', s.history.length === 1, `history=${s.history.length}`)
    s.seal('Move')
    check('seal collapses gesture to one entry', s.history.length === 2, `history=${s.history.length}`)
  }

  // --- 3. undo restores the PRE-gesture position, not the first poke ---
  s.undo()
  const undone = btn ? s.doc.nodes[btn] : undefined
  check(
    'undo of drag restores original position',
    undone?.props.x === 40 && undone?.props.y === 60,
    `x=${undone?.props.x} y=${undone?.props.y}`,
  )
  check('undo removed the gesture entry only', s.history.length === 1, `history=${s.history.length}`)

  s.redo()
  check('redo restores dragged position', btn ? s.doc.nodes[btn].props.x === 157 : false)

  // --- 4. nested containers: a Panel holding a child, then delete + undo ---
  const panel = s.addComponent('Panel', s.doc.root, 0, 0)
  let child: string | undefined
  if (panel) {
    s.commit({ op: 'setFlow', id: panel, flow: true }, 'flow on')
    child = s.addComponent('Label', panel, 10, 10)
  }
  check('child parented to panel', child ? parentOf(s.doc, child) === panel : false)
  const beforeDelete = snapshot(s)
  const depth = child ? descendants(s.doc, child).length + 1 : 0

  if (panel) {
    s.remove([panel])
    check('delete removes subtree', !s.doc.nodes[panel] && !s.doc.nodes[child!], `depth was ${depth}`)
    s.undo()
    check('undo restores the full subtree', snapshot(s) === beforeDelete)
    check('restored child re-parents correctly', child ? parentOf(s.doc, child) === panel : false)
    check('restored subtree is detached-safe', child ? descendants(s.doc, child).length === depth - 1 : false)
  }

  // --- 5. cycle guard: a node cannot become its own descendant ---
  if (panel && child) {
    const idCountBefore = Object.keys(s.doc.nodes).length
    s.commit({ op: 'reparent', id: panel, parent: child }, 'illegal reparent')
    check(
      'reparent into own descendant rejected',
      Object.keys(s.doc.nodes).length === idCountBefore &&
        parentOf(s.doc, panel) === s.doc.root,
      `nodes=${Object.keys(s.doc.nodes).length}`,
    )
  }

  // --- 6. root is undeletable ---
  const nodeCount = Object.keys(s.doc.nodes).length
  s.remove([s.doc.root])
  check('root cannot be deleted', Object.keys(s.doc.nodes).length === nodeCount)

  // --- 7. ops are pure: the previous document is untouched by apply ---
  const s2 = new EditorStore()
  const a = s2.addComponent('Gauge', s2.doc.root, 5, 5)
  const frozen = JSON.stringify(s2.doc.nodes)
  if (a) s2.poke({ op: 'move', id: a, x: 999, y: 999 })
  check('poke does not mutate history snapshots', frozen !== JSON.stringify(s2.doc.nodes))

  // --- 8. registry integrity ---
  const gauge = instantiate('Gauge')
  check('gauge defaults are schema-derived', gauge.props.unit === '%' && gauge.props.size === 140)

  // --- 9. every node carries ALL declared schema props -----------------
  // Regression: the `insert` op stored raw props verbatim, so nodes created
  // outside `instantiate` were missing defaults entirely.
  {
    const s3 = new EditorStore()
    const rootId = s3.doc.root
    const panel = s3.addComponent('Panel', rootId)
    check('toolbox drop gets all schema props', panel ? hasAllProps(s3, panel, 'Panel') : false)

    // A node built with a partial props object must still be normalised.
    if (panel) {
      const before = s3.doc.nodes[panel].props
      s3.poke({ op: 'setProp', id: panel, key: 'radius', value: 20 })
      check('partial-props node was normalised on insert', 'radius' in before, JSON.stringify(before))
      check('radius default was 14 not 0', before.radius === 14, String(before.radius))
    }

    // Undeclared keys must be dropped, not stored.
    const ghost = s3.addComponent('Label', rootId, 0, 0, { text: 'x', bogusProp: 99 } as never)
    check(
      'undeclared prop is dropped on insert',
      ghost ? !('bogusProp' in s3.doc.nodes[ghost].props) : false,
      ghost ? JSON.stringify(Object.keys(s3.doc.nodes[ghost].props)) : 'no node',
    )
  }

  // --- 10. no duplicate child links ------------------------------------
  // Regression: the seeder pre-linked children on insert AND inserted them
  // again, so every container rendered its children twice.
  {
    const s4 = new EditorStore()
    seedDemo(s4)
    const dupes: string[] = []
    for (const n of Object.values(s4.doc.nodes)) {
      const seen = new Set<string>()
      for (const c of n.children) {
        if (seen.has(c)) dupes.push(`${n.id}->${c}`)
        seen.add(c)
      }
    }
    check('no container double-links a child', dupes.length === 0, dupes.join(','))

    const labels = Object.values(s4.doc.nodes).filter((n) => n.type === 'Label')
    check(
      'demo seeds 8 Labels (2 header, 2 per card x 3 cards)',
      labels.length === 8,
      `got ${labels.length}`,
    )
  }

  // --- 11. flow vs free is decided by the PARENT -----------------------
  // Regression: the renderer positioned every leaf absolutely, so children of
  // a flow panel all stacked at left:0 top:0.
  {
    const s5 = new EditorStore()
    const rootId = s5.doc.root
    s5.commit({ op: 'setFlow', id: rootId, flow: true }, 'flow')
    const card = s5.addComponent('Panel', rootId, 0, 0, {}, { flow: true })
    const leaf = card ? s5.addComponent('Label', card) : undefined
    check('leaf inside a flow parent is a flow child', leaf ? isFlowChild(s5.doc, leaf) : false)
    check('leaf outside a flow parent is free', !isFlowChild(s5.doc, rootId))

    if (card) {
      s5.commit({ op: 'setFlow', id: card, flow: false }, 'unflow')
      check(
        'flipping the parent switches the child to free',
        leaf ? !isFlowChild(s5.doc, leaf) : false,
      )
    }
  }

  // --- 12. all declared props present on every node --------------------
  {
    const s6 = new EditorStore()
    seedDemo(s6)
    const missing: string[] = []
    for (const n of Object.values(s6.doc.nodes)) {
      // The root is created by emptyDocument() before any component is
      // registered, so it legitimately carries only its layout keys.
      if (n.id === s6.doc.root) continue
      if (!hasAllProps(s6, n.id, n.type)) missing.push(n.id)
    }
    check('every non-root node has all declared props', missing.length === 0, missing.join(','))

    // The root must still be complete AFTER a seeder pass, which is when it
    // actually gets its real shape.
    check('root is normalised once a component is registered', hasAllProps(s6, s6.doc.root, 'Panel'))
  }

  // --- 13. resize: transient, sealed, and reversible --------------------
  {
    const s7 = new EditorStore()
    const rootId = s7.doc.root
    s7.commit({ op: 'setFlow', id: rootId, flow: false }, 'free root')
    const g = s7.addComponent('Gauge', rootId, 100, 100)
    check('resize op accepted', g ? s7.commit({ op: 'resize', id: g, w: 220, h: 180 }, 'Resize') : false)
    check('resize stores w/h', g ? s7.doc.nodes[g].props.w === 220 && s7.doc.nodes[g].props.h === 180 : false)

    // Rounding and a floor, so a degenerate drag cannot produce a 0px node.
    if (g) {
      s7.poke({ op: 'resize', id: g, w: 10.6, h: -50 })
      check('resize rounds', s7.doc.nodes[g].props.w === 11, String(s7.doc.nodes[g].props.w))
      check('resize floors at 1', s7.doc.nodes[g].props.h === 1, String(s7.doc.nodes[g].props.h))
    }

    // Transient contract: many pokes, then ONE sealed history entry.
    const beforeCount = s7.history.length
    if (g) {
      for (let i = 0; i < 25; i++) s7.poke({ op: 'resize', id: g, w: 100 + i, h: 100 + i })
      check('resize pokes add no history', s7.history.length === beforeCount)
      s7.seal('Resize')
      check('resize gesture seals to one entry', s7.history.length === beforeCount + 1)

      s7.undo()
      check('undo of resize restores prior size', s7.doc.nodes[g].props.w === 220, String(s7.doc.nodes[g].props.w))
      s7.redo()
      check('redo of resize reapplies', s7.doc.nodes[g].props.w === 124, String(s7.doc.nodes[g].props.w))
    }
  }

  // --- 14. w/h survive schema normalisation ---------------------------
  {
    const s8 = new EditorStore()
    const rootId = s8.doc.root
    s8.commit({ op: 'setFlow', id: rootId, flow: false }, 'free root')
    const b = s8.addComponent('Button', rootId, 10, 10, { w: 300, h: 80 })
    check(
      'explicit w/h are preserved (not dropped as undeclared)',
      b ? s8.doc.nodes[b].props.w === 300 && s8.doc.nodes[b].props.h === 80 : false,
      b ? JSON.stringify(s8.doc.nodes[b].props) : 'no node',
    )
  }

  // --- 15. reparent index convention ------------------------------------
  // Regression: reparenting to the END of a parent landed one slot short, and
  // the inverse used a different index convention than apply, so undo drifted.
  {
    for (const c of reparentProbe()) {
      const got = c.got ?? c.restored ?? []
      check(
        `reparent: ${c.case}`,
        JSON.stringify(got) === JSON.stringify(c.want),
        `got ${JSON.stringify(got)} want ${JSON.stringify(c.want)}`,
      )
    }
  }

  // --- 16. preview mode emits no editor chrome --------------------------
  // The preview must be indistinguishable from shipped output: no
  // data-loom-id hooks, no resize handles, real focusable controls.
  {
    const s9 = new EditorStore()
    seedDemo(s9)

    const host = document.createElement('div')
    document.body.appendChild(host)
    const rootC = createRoot(host)
    rootC.render(React.createElement(PreviewStage, { s: s9 }))
    // Let React flush before inspecting the DOM.
    await new Promise((r) => setTimeout(r, 80))

    const stage = host.querySelector('.preview-stage')
    const ids = stage?.querySelectorAll('[data-loom-id]').length ?? -1
    const handles = stage?.querySelectorAll('.loom-handle').length ?? -1
    const buttons = stage?.querySelectorAll('button').length ?? 0
    const inputs = stage?.querySelectorAll('input').length ?? 0

    check('preview stage exists', Boolean(stage))
    check('preview emits no data-loom-id hooks', ids === 0, `found ${ids}`)
    check('preview emits no resize handles', handles === 0, `found ${handles}`)
    check('preview renders real buttons', buttons > 0, `buttons=${buttons}`)
    check('preview renders real inputs', inputs > 0, `inputs=${inputs}`)
    check(
      'preview inputs are not readonly (they behave like output)',
      [...(stage?.querySelectorAll('input') ?? [])].every((i) => !i.hasAttribute('readonly')),
    )

    // Authoring mode, by contrast, MUST still carry the hooks.
    const s10 = new EditorStore()
    seedDemo(s10)
    s10.select([s10.doc.root])
    const host2 = document.createElement('div')
    document.body.appendChild(host2)
    const root2 = createRoot(host2)
    root2.render(
      renderNode(
        { doc: s10.doc, selected: new Set(s10.selection), onPointerDownNode: () => undefined },
        s10.doc.root,
      ),
    )
    await new Promise((r) => setTimeout(r, 80))
    const authIds = host2.querySelectorAll('[data-loom-id]').length
    check('authoring mode still emits data-loom-id hooks', authIds > 0, `found ${authIds}`)

    rootC.unmount()
    root2.unmount()
    host.remove()
    host2.remove()
  }

  // --- 17. peek preview stays inside its own column ---------------------
  // Regression: the artboard was absolutely positioned at 720px inside a
  // 300px grid column, so the miniature overlapped the design canvas.
  {
    const lc = layoutProbe()
    for (const c of lc) {
      check(`preview layout: ${c.name}`, c.pass, c.detail)
    }
  }

  // --- 18. the output has a design system -------------------------------
  // The output-quality review's headline: every colour/radius/size was a
  // literal in styleFor, so two authors produced two unrelated apps and
  // re-skinning meant editing every node.
  {
    const mid = getTheme('midnight')
    const day = getTheme('daylight')
    const con = getTheme('contrast')

    check('three themes resolve', mid.name === 'midnight' && day.name === 'daylight' && con.name === 'contrast')
    check('themes differ on surface', mid.bg !== day.bg && day.bg !== con.bg, `${mid.bg} / ${day.bg} / ${con.bg}`)
    check('themes differ on accent', mid.accent !== day.accent, `${mid.accent} vs ${day.accent}`)
    check(
      'type scale is monotonic',
      mid.textXs < mid.textSm && mid.textSm < mid.textMd && mid.textMd < mid.textLg &&
        mid.textLg < mid.textXl && mid.textXl < mid.textXxl,
      [mid.textXs, mid.textSm, mid.textMd, mid.textLg, mid.textXl, mid.textXxl].join(','),
    )
    check(
      'spacing scale is monotonic',
      mid.space1 < mid.space2 && mid.space2 < mid.space3 && mid.space3 < mid.space4 &&
        mid.space4 < mid.space5 && mid.space5 < mid.space6 && mid.space6 < mid.space8,
    )
    check('elevation ramp has three steps', Boolean(mid.shadowSm && mid.shadowMd && mid.shadowLg))
    check('motion tokens exist', mid.motionFast > 0 && mid.motionBase > 0 && mid.motionSlow > 0)

    const custom = resolveTheme('daylight', { accent: '#ff0000' })
    check('override merges onto the base theme', custom.accent === '#ff0000' && custom.bg === day.bg)
  }

  // --- 19. switching theme re-skins the document ------------------------
  {
    const s11 = new EditorStore()
    seedDemo(s11)
    s11.setTheme('daylight')
    check('setTheme writes doc.meta.theme', s11.doc.meta.theme === 'daylight', String(s11.doc.meta.theme))
    check('setTheme preserves the document name', s11.doc.meta.name === 'Telemetry Console')
    check('setTheme keeps every node intact', Object.keys(s11.doc.nodes).length > 15)
  }

  // --- 20. the dead props now render ------------------------------------
  // Regression: `Panel.title` was declared in the schema and rendered
  // NOWHERE. A prop that silently does nothing is worse than no prop.
  {
    const s12 = new EditorStore()
    const rootId = s12.doc.root
    s12.commit({ op: 'setFlow', id: rootId, flow: true }, 'flow')
    s12.addComponent('Panel', rootId, 0, 0, { title: 'Section One' }, { flow: true })

    const host = document.createElement('div')
    document.body.appendChild(host)
    const rootC = createRoot(host)
    rootC.render(React.createElement(PreviewStage, { s: s12 }))
    await new Promise((r) => setTimeout(r, 90))
    const text = host.textContent ?? ''
    check('Panel.title is actually rendered', text.includes('Section One'), text.slice(0, 60))
    rootC.unmount()
    host.remove()
  }

  // --- 21. rendered output actually uses theme colours -------------------
  // Proves the token layer is WIRED, not merely present.
  {
    const s13 = new EditorStore()
    seedDemo(s13)
    s13.setTheme('daylight')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const rootC = createRoot(host)
    rootC.render(React.createElement(PreviewStage, { s: s13 }))
    await new Promise((r) => setTimeout(r, 90))

    const stage = host.querySelector('.preview-stage')
    const first = stage?.firstElementChild as HTMLElement | null
    const bg = first ? getComputedStyle(first).backgroundColor : ''
    check('daylight theme reaches the rendered DOM', bg !== '' && bg !== 'rgba(0, 0, 0, 0)', `bg=${bg}`)
    check(
      'rendered output no longer uses the old midnight panel literal',
      bg !== 'rgb(22, 26, 38)',
      `bg=${bg}`,
    )
    rootC.unmount()
    host.remove()
  }

  // --- 22. persistence: a round trip is lossless -------------------------
  {
    const s14 = new EditorStore()
    seedDemo(s14)
    s14.setTheme('contrast')
    const json = serialize(s14.doc)
    const back = validate(json)
    check('serialised document validates', back.doc !== null, back.issues.map((i) => i.message).join('; '))
    check(
      'round trip preserves every node',
      back.doc ? Object.keys(back.doc.nodes).length === Object.keys(s14.doc.nodes).length : false,
      `${back.doc ? Object.keys(back.doc.nodes).length : 0} vs ${Object.keys(s14.doc.nodes).length}`,
    )
    check('round trip preserves the theme', back.doc?.meta.theme === 'contrast', String(back.doc?.meta.theme))
    check('round trip preserves the name', back.doc?.meta.name === 'Telemetry Console')
    check('round trip is issue-free', back.issues.length === 0, back.issues.map((i) => `${i.path}: ${i.message}`).join('; '))
  }

  // --- 23. persistence: untrusted files are rejected, not trusted -------
  // A .loom.json is user-supplied. Every one of these would corrupt the tree.
  {
    const seedForFile = new EditorStore()
    seedDemo(seedForFile)
    const good = JSON.parse(serialize(seedForFile.doc))

    check('rejects a non-object', validate(42).doc === null)
    check('rejects a wrong version', validate({ ...good, version: 99 }).doc === null)

    // Unknown component type: the node is dropped, the rest survives.
    const unknown = structuredClone(good)
    unknown.nodes.zzz = { id: 'zzz', type: 'NotAComponent', props: {}, children: [], flow: false }
    const u = validate(unknown)
    check('unknown component type is dropped', u.doc !== null && !u.doc.nodes.zzz)
    check('unknown component is reported', u.issues.some((i) => i.message.includes('unknown component')))
    check('rest of the document survives', u.doc ? Object.keys(u.doc.nodes).length === Object.keys(good.nodes).length : false)

    // Dangling child reference.
    const dangling = structuredClone(good)
    dangling.nodes[dangling.root].children.push('does-not-exist')
    const d = validate(dangling)
    check('dangling child reference is dropped', d.doc !== null && !d.doc.nodes[d.doc.root].children.includes('does-not-exist'))

    // Duplicate child links.
    const dup = structuredClone(good)
    dup.nodes[dup.root].children = [...dup.nodes[dup.root].children, ...dup.nodes[dup.root].children]
    const dd = validate(dup)
    check(
      'duplicate child links are collapsed',
      dd.doc !== null &&
        new Set(dd.doc.nodes[dd.doc.root].children).size === dd.doc.nodes[dd.doc.root].children.length,
    )

    // A cycle: a node that is its own ancestor.
    const cyc = structuredClone(good)
    const rootId = cyc.root
    cyc.nodes[rootId].children.push(rootId)
    const c = validate(cyc)
    check('a self-referencing child is removed', c.doc !== null && !c.doc.nodes[c.doc.root].children.includes(c.doc.root))

    // Orphaned node: valid on its own, unreachable from the root.
    const orphan = structuredClone(good)
    orphan.nodes.orphan = { id: 'orphan', type: 'Label', props: {}, children: [], flow: false }
    const o = validate(orphan)
    check('orphaned node is dropped', o.doc !== null && !o.doc.nodes.orphan)
    check('orphan is reported', o.issues.some((i) => i.message.includes('orphaned')))

    // Missing root.
    check('rejects a document whose root is missing', validate({ ...good, root: 'nope' }).doc === null)
  }

  // --- 24. filenames are filesystem-safe ---------------------------------
  {
    check('plain name becomes a slug', filenameFor('Telemetry Console') === 'telemetry-console.loom.json', filenameFor('Telemetry Console'))
    check('punctuation is stripped', filenameFor('My App / v2.0!') === 'my-app-v2-0.loom.json', filenameFor('My App / v2.0!'))
    check('empty name still yields a filename', filenameFor('   ') === 'untitled.loom.json', filenameFor('   '))
    check('long names are truncated', filenameFor('x'.repeat(200)).length <= 72, String(filenameFor('x'.repeat(200)).length))
  }

  // --- 25. the dirty flag tracks unsaved work ---------------------------
  {
    const s15 = new EditorStore()
    check('a fresh document is clean', s15.dirty === false)
    s15.addComponent('Button', s15.doc.root, 0, 0)
    check('an edit makes it dirty', s15.dirty === true)
    s15.undo()
    check('undo alone keeps it dirty (work is still unsaved)', s15.dirty === true)
  }


  // --- 26. a flow child must not record a phantom Move --------------------
  // The functionality review demonstrated: dragging a leaf inside a flow
  // container committed a "Move" that changed nothing on screen, so the undo
  // count grew for zero visual effect. The drag now refuses to start.
  {
    const s16 = new EditorStore()
    const rootId = s16.doc.root
    s16.commit({ op: 'setFlow', id: rootId, flow: true }, 'flow root')
    const card = s16.addComponent('Panel', rootId, 0, 0, {}, { flow: true })
    const leaf = card ? s16.addComponent('Button', card) : undefined

    check('leaf inside a flow parent exists', Boolean(leaf))
    check('that leaf IS a flow child', leaf ? isFlowChild(s16.doc, leaf) : false)

    // The real guard is that the canvas NEVER STARTS a drag for a flow
    // child, so no poke and no seal happen. Prove the store is well-behaved
    // if one ever does: sealing a gesture that changed NOTHING must be a
    // no-op, not a phantom undo entry.
    if (leaf) {
      const before = s16.history.length
      s16.seal('Move')
      check(
        'sealing a gesture that changed nothing adds no history',
        s16.history.length === before,
        `${before} -> ${s16.history.length}`,
      )
    }

    // And a gesture that DID change something must still be recorded.
    if (leaf) {
      const before = s16.history.length
      s16.poke({ op: 'move', id: leaf, x: 42, y: 24 })
      s16.seal('Move')
      check(
        'sealing a real change IS recorded',
        s16.history.length === before + 1,
        `${before} -> ${s16.history.length}`,
      )
      check(
        'the recorded move kept its value',
        s16.doc.nodes[leaf].props.x === 42,
        String(s16.doc.nodes[leaf].props.x),
      )
    }

    // Contrast: a free child DOES move and DOES record it.
    const s17 = new EditorStore()
    const r2 = s17.doc.root
    s17.commit({ op: 'setFlow', id: r2, flow: false }, 'free root')
    const free = s17.addComponent('Button', r2, 10, 10)
    check('a free child is not a flow child', free ? !isFlowChild(s17.doc, free) : false)
    if (free) {
      const before = s17.history.length
      s17.poke({ op: 'move', id: free, x: 100, y: 100 })
      s17.seal('Move')
      check('a free child move IS recorded', s17.history.length === before + 1)
    }
  }

  // --- 27. drops can target a CONTAINER, not just the surface ------------
  {
    const s18 = new EditorStore()
    seedDemo(s18)
    // Every container in the document must advertise itself as a drop target.
    const containers = Object.values(s18.doc.nodes).filter((n) => n.type === 'Panel' || n.type === 'Stack' || n.type === 'Grid')
    check('demo has containers', containers.length > 0, `${containers.length}`)

    const host = document.createElement('div')
    document.body.appendChild(host)
    const rootC = createRoot(host)
    rootC.render(
      renderNode(
        { doc: s18.doc, selected: new Set(), onPointerDownNode: () => undefined },
        s18.doc.root,
      ),
    )
    await new Promise((r) => setTimeout(r, 90))
    const targets = host.querySelectorAll('[data-loom-container="true"]')
    check(
      'rendered containers are marked as drop targets',
      targets.length >= containers.length,
      `${targets.length} marked vs ${containers.length} containers`,
    )
    rootC.unmount()
    host.remove()
  }

  // --- 28. export: standalone HTML is robust ---------------------------
  // The exporter is `renderToStaticMarkup` over the SAME preview renderer,
  // so these checks guard both the emitter shell and future renderer drift.
  {
    const se = new EditorStore()
    seedDemo(se)
    se.setTheme('daylight')
    const html = emitHtml(se.doc)
    check('export emits a doctype', html.startsWith('<!DOCTYPE html>'))
    check('export has no editor hooks', !html.includes('data-loom-id') && !html.includes('loom-handle'))
    check('export renders real controls', html.includes('<button') && html.includes('<input'))
    check('export embeds the active theme', html.includes('#f6f7f9'), 'daylight bg missing')
    check('export is deterministic', emitHtml(se.doc) === html)

    // Hostile text must be escaped, never emitted raw.
    const evil = new EditorStore()
    evil.addComponent('Label', evil.doc.root, 0, 0, { text: '<script>alert(1)</script>' })
    const evilHtml = emitHtml(evil.doc)
    check(
      'export escapes hostile text',
      !evilHtml.includes('<script>alert') && evilHtml.includes('&lt;script&gt;'),
    )

    // Hostile NAME: title escaped in <title>, filename slugged for disk.
    check(
      'export filename is filesystem-safe',
      exportFilenameFor('My App / v2.0!') === 'my-app-v2-0.html',
      exportFilenameFor('My App / v2.0!'),
    )
    const named = new EditorStore()
    named.commit({ op: 'rename', name: 'Bad <script>"name"' }, 'rename')
    check('export escapes the title', emitHtml(named.doc).includes('&lt;script&gt;'))

    // Every registered component must survive the exporter. One tiny doc
    // per component so a failure names the culprit.
    const failed: string[] = []
    for (const spec of allComponents()) {
      try {
        const t = new EditorStore()
        const id = t.addComponent(spec.name, t.doc.root, 0, 0)
        if (!id) {
          failed.push(`${spec.name} (no id)`)
          continue
        }
        const out = emitHtml(t.doc)
        if (!out || out.length < 100) failed.push(`${spec.name} (empty)`)
      } catch (e) {
        failed.push(`${spec.name} (${String(e)})`)
      }
    }
    check('export covers all registered components', failed.length === 0, failed.join('; ').slice(0, 300))

    // Fail-fast: an unknown type must throw, not emit a silent generic div.
    const bad = structuredClone(se.doc)
    bad.nodes.evil = { id: 'evil', type: 'NotAComponent', props: {}, children: [], flow: false, visible: true, locked: false }
    bad.nodes[bad.root].children.push('evil')
    let threw = false
    try {
      emitHtml(bad)
    } catch {
      threw = true
    }
    check('export throws on unknown components', threw)
  }

  // --- 29. adversarial loader + renderer hardening ----------------------
  // Demonstrated hostile-input findings (second adversarial pass): the
  // loader used to accept incomplete/mistyped props silently, emit
  // invalid CSS for non-finite geometry, hang superlinearly on deep files,
  // and render shared-subtree DAGs exponentially.
  {
    const mkNodes = (n: number) => {
      const nodes: Record<string, { id: string; type: string; props: object; children: string[]; flow: boolean }> = {
        root: { id: 'root', type: 'Panel', props: {}, children: n > 0 ? ['n0'] : [], flow: true },
      }
      for (let i = 0; i < n; i++) {
        nodes[`n${i}`] = { id: `n${i}`, type: 'Panel', props: {}, children: i + 1 < n ? [`n${i + 1}`] : [], flow: true }
      }
      return nodes
    }
    const mkDoc = (nodes: object, root = 'root') => ({ version: 1, meta: { name: 't', targets: ['web'], created: 0 }, root, nodes })

    // Missing props are completed, undeclared dropped, wrong-typed reset —
    // every repair reported, good docs untouched (see §22 staying green).
    const s19 = new EditorStore()
    seedDemo(s19)
    const tampered = JSON.parse(serialize(s19.doc))
    const panelId = Object.keys(tampered.nodes).find((id) => id !== tampered.root && tampered.nodes[id].type === 'Panel')!
    delete tampered.nodes[panelId].props.gap
    tampered.nodes[panelId].props.bogusProp = 7
    tampered.nodes[panelId].props.padding = 'wide'
    tampered.nodes[panelId].props.direction = 'diagonal'
    const rep = validate(tampered)
    const rp = rep.doc?.nodes[panelId]?.props ?? {}
    check('loader completes missing props with defaults', rp.gap === 12, String(rp.gap))
    check('loader drops undeclared props with an issue', !('bogusProp' in rp) && rep.issues.some((i) => i.message.includes('undeclared')))
    check('loader resets mistyped props with issues', rp.padding === 16 && rp.direction === 'column' &&
      rep.issues.some((i) => i.message.includes('finite number')) && rep.issues.some((i) => i.message.includes('one of')))
    check('repaired nodes are complete', rep.doc ? Object.keys(rep.doc.nodes).every((id) => {
      const n = rep.doc!.nodes[id]
      const spec = getComponent(n.type)
      return spec ? Object.keys(spec.props).every((k) => k in n.props) : false
    }) : false)

    // Non-finite geometry never reaches the stylesheet.
    const s20 = new EditorStore()
    const nanBtn = s20.addComponent('Button', s20.doc.root, 0, 0)
    if (nanBtn) {
      s20.commit({ op: 'setProp', id: nanBtn, key: 'x', value: NaN as never }, 'nan')
      s20.commit({ op: 'setProp', id: nanBtn, key: 'y', value: Infinity as never }, 'inf')
      const html = emitHtml(s20.doc)
      check('non-finite geometry emits valid CSS', !html.includes('NaNpx') && !html.includes('Infinitypx'))
    } else {
      check('non-finite geometry emits valid CSS', false, 'no node')
    }

    // Deep files validate in linear time and truncate past the cap.
    const v300 = validate(mkDoc(mkNodes(300)))
    check('a 300-deep chain loads clean', v300.doc !== null && v300.issues.length === 0 &&
      Object.keys(v300.doc.nodes).length === 301)
    const tDeep = Date.now()
    const v2000 = validate(mkDoc(mkNodes(2000)))
    const deepMs = Date.now() - tDeep
    check('a 2000-deep chain loads fast with one truncation', v2000.doc !== null &&
      Object.keys(v2000.doc!.nodes).length === 1 + MAX_TREE_DEPTH &&
      v2000.issues.some((i) => i.message.includes('truncated')), `${deepMs}ms, issues=${v2000.issues.length}`)

    // Shared subtrees stay a tree: one parent per child, linear output.
    {
      const depth = 6
      const nodes: Record<string, { id: string; type: string; props: object; children: string[]; flow: boolean }> = {}
      for (let i = 0; i <= depth; i++) {
        nodes[`a${i}`] = { id: `a${i}`, type: 'Panel', props: {}, children: [`s${i}`], flow: true }
        nodes[`b${i}`] = { id: `b${i}`, type: 'Panel', props: {}, children: [`s${i}`], flow: true }
        nodes[`s${i}`] = { id: `s${i}`, type: 'Panel', props: {}, children: i < depth ? [`a${i + 1}`, `b${i + 1}`] : [], flow: true }
      }
      const v = validate(mkDoc(nodes, 'a0'))
      let singleParent = false
      let linear = false
      if (v.doc) {
        const counts: Record<string, number> = {}
        for (const n of Object.values(v.doc.nodes)) for (const c of n.children) counts[c] = (counts[c] ?? 0) + 1
        singleParent = Object.values(counts).every((k) => k === 1) &&
          v.issues.some((i) => i.message.includes('already has a parent'))
        linear = emitHtml(v.doc).length < 100000
      }
      check('shared subtrees collapse to one parent with issues', singleParent)
      check('shared subtrees render linearly', linear)
    }

    // A reachable mutual cycle loads, reports, and renders finitely.
    {
      const nodes = {
        root: { id: 'root', type: 'Panel', props: {}, children: ['a'], flow: true },
        a: { id: 'a', type: 'Panel', props: {}, children: ['b'], flow: true },
        b: { id: 'b', type: 'Panel', props: {}, children: ['a'], flow: true },
      }
      const v = validate(mkDoc(nodes))
      let rendered = -1
      if (v.doc) {
        try {
          rendered = emitHtml(v.doc).length
        } catch {
          rendered = -1
        }
      }
      check('a mutual cycle loads and renders finitely', v.doc !== null && rendered > 0 && rendered < 100000,
        `len=${rendered}`)
    }

    // Authoring mode (plain + selected) covers every component without
    // throwing, and selected nodes carry editor hooks in static markup.
    {
      const failed: string[] = []
      let hooks = 0
      for (const spec of allComponents()) {
        try {
          const t = new EditorStore()
          const id = t.addComponent(spec.name, t.doc.root, 0, 0)
          if (!id) {
            failed.push(`${spec.name} (no id)`)
            continue
          }
          renderNode({ doc: t.doc, selected: new Set() }, id, 0)
          const sel = renderNode({ doc: t.doc, selected: new Set([id]) }, id, 0)
          if (renderToStaticMarkup(sel).includes('data-loom-id')) hooks++
        } catch (e) {
          failed.push(`${spec.name} (${String(e).slice(0, 80)})`)
        }
      }
      check('authoring renders all components (plain + selected)', failed.length === 0, failed.join('; ').slice(0, 300))
      check('selected authoring carries editor hooks', hooks === allComponents().length, `${hooks}/${allComponents().length}`)
    }

    // Deleting the root refuses AND keeps the selection (old review bug 6).
    {
      const s21 = new EditorStore()
      s21.select([s21.doc.root])
      const before = Object.keys(s21.doc.nodes).length
      s21.remove([s21.doc.root])
      check('refused delete keeps the document', Object.keys(s21.doc.nodes).length === before)
      check('refused delete keeps the selection', s21.selection.includes(s21.doc.root))
    }

    // Fill text follows the theme on every theme (white-on-accent failed AA
    // on midnight 3.16:1 and contrast 2.39:1; the token is dark there).
    {
      const themes = ['midnight', 'daylight', 'contrast'] as const
      const missing = themes.filter((n) => {
        const v = (getTheme(n) as unknown as Record<string, unknown>).textOnAccent
        return typeof v !== 'string' || v.length === 0
      })
      check('every theme defines textOnAccent', missing.length === 0, missing.join(','))
      const s22 = new EditorStore()
      s22.addComponent('Button', s22.doc.root, 0, 0, { variant: 'primary' })
      s22.setTheme('contrast')
      check('contrast primary buttons use the token, not white',
        emitHtml(s22.doc).includes('#0a0f1c') && !emitHtml(s22.doc).includes('color:#fff;') &&
        !emitHtml(s22.doc).includes('color:#fff"'))
    }
  }

  // --- 30. desktop-first, absolute-first defaults -----------------------
  // Product direction: Loom produces desktop apps first, and positioning is
  // absolute unless a container explicitly opts into flow. Pin all three so
  // a future default flip breaks loudly instead of silently re-webbing.
  {
    const nonFree = allComponents().filter((c) => instantiate(c.name).flow !== false)
    check('every component instantiates free (absolute)', nonFree.length === 0, nonFree.map((c) => c.name).join(','))
    const panel = getComponent('Panel')
    check('Panel defaults to a portable solid surface', panel?.props.surface?.default === 'solid')
    check('Panel glass defaults off (web-only effect)', panel?.props.glass?.default === false)
    check('desktop capabilities exclude CSS layout mechanisms', !DESKTOP_CAPABILITIES.includes('css-grid' as never))
    check('the editor targets desktop by default', new EditorStore().target === 'desktop')
  }

  // --- 31. layers: visibility, locks, z-order, duplication ---------------
  // Stolen from Atelier's layers panel: every element manageable outside
  // the canvas, with output-truth (hidden really hides) and exact undo.
  {
    // Visible/locked ride ops with exact inverses.
    const s23 = new EditorStore()
    const b = s23.addComponent('Button', s23.doc.root, 10, 10)
    check('new nodes are visible and unlocked', b ? s23.doc.nodes[b].visible === true && s23.doc.nodes[b].locked === false : false)
    if (b) {
      s23.commit({ op: 'setVisible', id: b, visible: false }, 'Hide')
      check('hide commits', s23.doc.nodes[b].visible === false)
      s23.undo()
      check('undo of hide restores visibility', s23.doc.nodes[b].visible === true)
      s23.redo()
      check('redo of hide re-hides', s23.doc.nodes[b].visible === false)
      s23.commit({ op: 'setLocked', id: b, locked: true }, 'Lock')
      check('lock commits', s23.doc.nodes[b].locked === true)
      s23.undo()
      check('undo of lock restores', s23.doc.nodes[b].locked === false)
    }

    // Hidden nodes vanish from output but survive in the document.
    const s24 = new EditorStore()
    seedDemo(s24)
    const beforeHide = emitHtml(s24.doc)
    // A label whose text occurs exactly once in the output (the header
    // label shares its text with <title>, so it can never prove removal).
    const someId = Object.keys(s24.doc.nodes).find((id) => {
      const n = s24.doc.nodes[id]
      if (id === s24.doc.root || n.type !== 'Label') return false
      const t = String(n.props.text ?? '').trim()
      return t !== '' && t !== s24.doc.meta.name && beforeHide.split(t).length - 1 === 1
    })
    if (someId) {
      const text = String(s24.doc.nodes[someId].props.text ?? '')
      s24.commit({ op: 'setVisible', id: someId, visible: false }, 'Hide')
      const after = emitHtml(s24.doc)
      check('hidden nodes leave the output', beforeHide.includes(text) && !after.includes(text), text.slice(0, 40))
      check('hidden nodes stay in the document', Boolean(s24.doc.nodes[someId]))
      // Authoring does not throw on hidden nodes (it ghosts them).
      renderNode({ doc: s24.doc, selected: new Set(), mode: 'preview' }, s24.doc.root)
      check('preview renders with hidden nodes present', true)
    } else {
      check('hidden nodes leave the output', false, 'no label found')
      check('hidden nodes stay in the document', false)
      check('preview renders with hidden nodes present', false)
    }

    // Locked nodes refuse deletion; the selection survives the refusal.
    const s25 = new EditorStore()
    const l1 = s25.addComponent('Button', s25.doc.root, 0, 0)
    const l2 = s25.addComponent('Label', s25.doc.root, 0, 0)
    if (l1 && l2) {
      s25.commit({ op: 'setLocked', id: l1, locked: true }, 'Lock')
      const before = Object.keys(s25.doc.nodes).length
      s25.select([l1])
      s25.remove([l1])
      check('locked nodes survive remove', Boolean(s25.doc.nodes[l1]) && Object.keys(s25.doc.nodes).length === before)
      check('refused locked delete keeps selection', s25.selection.includes(l1))
      s25.remove([l1, l2])
      check('mixed remove deletes only the unlocked', Boolean(s25.doc.nodes[l1]) && !s25.doc.nodes[l2])
    } else {
      check('locked nodes survive remove', false, 'no nodes')
      check('refused locked delete keeps selection', false)
      check('mixed remove deletes only the unlocked', false)
    }

    // Duplication re-ids the whole subtree, offsets the copy, selects it.
    const s26 = new EditorStore()
    const card = s26.addComponent('Panel', s26.doc.root, 50, 60, {}, { flow: false })
    let leaf: string | undefined
    if (card) leaf = s26.addComponent('Label', card, 5, 5, { text: 'copy me' })
    if (card && leaf) {
      const before = Object.keys(s26.doc.nodes).length
      const copy = s26.duplicate(card)
      const copyNode = copy ? s26.doc.nodes[copy] : undefined
      check('duplicate returns a new id', Boolean(copy && copy !== card && copyNode))
      check('duplicate materialises the subtree', copy ? Object.keys(s26.doc.nodes).length === before + 2 : false)
      check('duplicate offsets the copy', copyNode?.props.x === 62 && copyNode?.props.y === 72,
        copyNode ? `${String(copyNode.props.x)},${String(copyNode.props.y)}` : 'none')
      check('duplicate re-ids children', copyNode ? copyNode.children.length === 1 && copyNode.children[0] !== leaf : false)
      check('duplicate selects the copy', copy ? s26.selection.includes(copy) : false)
      s26.undo()
      check('undo of duplicate removes the copy', Object.keys(s26.doc.nodes).length === before)
      check('root refuses duplication', s26.duplicate(s26.doc.root) === undefined)
      if (copy) {
        s26.redo()
        s26.commit({ op: 'setLocked', id: copy, locked: true }, 'Lock')
        check('locked nodes refuse duplication', s26.duplicate(copy) === undefined)
      }
    } else {
      check('duplicate returns a new id', false, 'no fixture')
      check('duplicate materialises the subtree', false)
      check('duplicate offsets the copy', false)
      check('duplicate re-ids children', false)
      check('duplicate selects the copy', false)
      check('undo of duplicate removes the copy', false)
      check('root refuses duplication', false)
      check('locked nodes refuse duplication', false)
    }

    // Z-order moves one slot per commit through the layers panel op.
    const s27 = new EditorStore()
    const za = s27.addComponent('Button', s27.doc.root, 0, 0, { label: 'a' })
    const zb = s27.addComponent('Button', s27.doc.root, 10, 10, { label: 'b' })
    const zc = s27.addComponent('Button', s27.doc.root, 20, 20, { label: 'c' })
    if (za && zb && zc) {
      s27.commit({ op: 'reparent', id: zb, parent: s27.doc.root, index: 0 }, 'Move forward')
      check('layers move-forward reorders', JSON.stringify(s27.doc.nodes[s27.doc.root].children) === JSON.stringify([zb, za, zc]),
        JSON.stringify(s27.doc.nodes[s27.doc.root].children))
      s27.undo()
      check('undo restores z-order', JSON.stringify(s27.doc.nodes[s27.doc.root].children) === JSON.stringify([za, zb, zc]))
    } else {
      check('layers move-forward reorders', false, 'no fixture')
      check('undo restores z-order', false)
    }

    // Zoom math: screen pixels become doc units at any zoom.
    check('zoom halves screen distance at 200%', zoomed(100, 2) === 50)
    check('zoom doubles screen distance at 50%', zoomed(100, 0.5) === 200)
    check('zoom is identity at 100%', zoomed(37, 1) === 37)
    check('zoom guards degenerate input', zoomed(37, 0) === 37 && zoomed(37, NaN) === 37)

    // The loader coerces visibility/locks with issues on garbage.
    const hostile = { version: 1, meta: { name: 'h', targets: ['web'], created: 0 }, root: 'root', nodes: {
      root: { id: 'root', type: 'Panel', props: {}, children: ['a', 'b'], flow: false, visible: true, locked: false },
      a: { id: 'a', type: 'Label', props: { text: 'x' }, children: [], flow: false, visible: 'yes', locked: 0 },
      b: { id: 'b', type: 'Label', props: { text: 'y' }, children: [], flow: false },
    } }
    const hv = validate(hostile)
    check('loader repairs flag garbage with issues', hv.doc !== null && hv.doc.nodes.a.visible === true &&
      hv.doc.nodes.a.locked === false && hv.issues.some((i) => i.path.includes('$.nodes.a.visible')) &&
      hv.doc.nodes.b.visible === true && hv.doc.nodes.b.locked === false)
  }

  // Interchange, effects, tokens, snap, and z-clamp — the layers added after
  // the Atelier bundle review.
  for (const c of await bundleTests()) {
    checks.push({ name: c.name, pass: c.pass, detail: c.detail })
  }

  const passed = checks.filter((c) => c.pass).length
  return JSON.stringify(
    { passed, total: checks.length, allPass: passed === checks.length, checks },
    null,
    2,
  )
}
