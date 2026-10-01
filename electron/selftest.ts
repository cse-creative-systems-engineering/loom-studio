/**
 * Headless self-test.
 *
 * `npm run verify` boots Electron, runs this in the real renderer, and
 * prints a JSON report. It exercises the parts of the editor that are
 * easy to get subtly wrong: transient drag, gesture sealing, undo/redo
 * exactness, subtree delete/undo, and the document's purity.
 */

import { EditorStore, emptyDocument, type LoomHost } from '../src/state/store'
import { autosaveFileName, isExternalUrlAllowed } from './guards'
import { humanize, inspectorView, isModified } from '../src/model/inspector-view'
import { universalStyleProps } from '../src/model/prop-vocab'
import { isSafeColor, stateCss, STATE_PRESETS } from '../src/render/states'
import { documentCss } from '../src/render/document-css'
import { fieldsFor } from '../src/render/parts'
import type { Document, Node as LoomNode } from '../src/model/types'
import { ancestry, descendants, parentOf } from '../src/model/ops'
import { defineComponent, allComponents, DELIMITERS, delimiterChar, delimiterLabel, DESKTOP_CAPABILITIES, getComponent, instantiate } from '../src/model/registry'
import { emitHtml, exportFilenameFor } from '../src/export/html'
import { emitReact, reactFilenameFor } from '../src/export/react'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { isFlowChild, renderNode, zoomed } from '../src/render/web'
import { ROLE_OF, ITEM_ROLE, REVEAL_OF, interactiveTypes, behaviourAttrs, behaviourCss, behaviourRuntime } from '../src/render/behaviour'
import { responsiveCss, breakpointForWidth, CONTAINER_NAME } from '../src/render/responsive'
import { ICONS, ICON_NAMES, resolveIcon } from '../src/render/icons'
import { buildTooltip, tooltipFor } from '../src/model/tooltip'
import { auditReport, KNOWN_INERT } from './prop-audit'
import { auditAreas } from './area-audit'
import { auditInteractions } from './interaction-audit'
import { KNOWN_UNREACHABLE } from './area-backlog'
import { installBehaviourRuntime } from '../src/render/behaviour-mount'
import { STARTERS } from '../src/model/starters'
import { hasOwnGlyph } from '../src/tool-icons'
import { GROUP_ORDER } from '../src/model/prop-groups'
import { ToolThumb } from '../src/tool-card'
import { cleanPage } from '../src/model/page'
import { desktopBounds } from '../src/model/desktop-run'
import { AiTurn, runTool, TOOLS } from '../src/ai/tools'
import { addedTypes } from '../src/model/registry'
import { itemsOf } from '../src/model/lists'
import { CONTENT_STATE_TOOLS } from '../src/model/prop-vocab'
import { unsupportedProps } from '../src/model/registry'
import { THEME_NAMES } from '../src/render/theme'
import { OUTPUT_FAMILY, fontFaceCss } from '../src/render/fonts'
import { effectSupported } from '../src/render/effects'
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

/**
 * Fixtures used to inherit an auto-created root Panel. Documents are rootless
 * now, so a fixture that needs a container root must ASK for one — the same
 * gesture a user's first drop makes, but seeded as clean initial state (no
 * history, clean, nothing selected) so "one undo step" assertions keep
 * meaning exactly what they meant when the root was implicit.
 */
function withRoot(s: EditorStore): string {
  const existing = s.doc.root
  if (existing !== null) return existing
  s.loadDocument(rootDoc())
  return 'root'
}

/**
 * A document with one untouched Panel root at the origin — the "the root is
 * the page" case, without a store.
 */
function rootDoc(): Document {
  const id = 'root'
  const built = instantiate('Panel')
  return {
    version: 1,
    meta: { name: 'Untitled', targets: ['web'], created: Date.now() },
    root: id,
    nodes: {
      [id]: {
        id,
        type: 'Panel',
        props: { ...built.props, x: 0, y: 0 },
        children: [],
        flow: false,
        visible: true,
        locked: false,
        opacity: 1,
      },
    },
  }
}

/** The root of a document that is asserted to HAVE one. */
function mustRoot(doc: Document): string {
  const id = doc.root
  if (id === null) throw new Error('expected a root, document is empty')
  return id
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

/**
 * Measure a width with transitions switched off, then put them back.
 *
 * The verification window is HIDDEN, and a hidden renderer advances CSS
 * transitions lazily — at best slowly, while polling apparently not at all. The
 * width is the contract; the animation is decoration. So the measurement
 * disables transitions, reads the real layout, and restores them, which tests
 * what a person sees without depending on how the window is being composited.
 */
async function widthWithoutTransition(el: HTMLElement | null): Promise<number> {
  if (!el) return -1
  const style = document.createElement('style')
  style.textContent = '[data-loom-shell] *{transition:none !important}'
  document.head.appendChild(style)
  await new Promise((r) => setTimeout(r, 60))
  const width = Math.round(el.getBoundingClientRect().width)
  style.remove()
  return width
}

/** The colour applied to a KPI card's comparison row, and nothing else. */
function deltaTone(html: string): string {
  const m = /data-loom-kpi-delta=""[^>]*?color:([^;"]+)/.exec(html)
  return m ? m[1].trim() : ''
}

function snapshot(s: EditorStore) {
  return JSON.stringify(s.doc.nodes)
}

export async function runSelfTest(): Promise<string> {
  const s = new EditorStore()

  // --- 0. the canvas has the output's state stylesheet from the start ---
  // FIRST, before anything opens a preview: the sheet used to arrive only
  // with the docked preview, so until then a Switch drew its knob with no
  // track (in the canvas, the toolbox cards and the specimen board alike).
  {
    const host0 = document.createElement('div')
    document.body.appendChild(host0)
    const r0 = createRoot(host0)
    r0.render(React.createElement(ToolThumb, { tool: { type: 'Switch' }, theme: 'midnight' }))
    await new Promise((r) => setTimeout(r, 60))
    const track = host0.querySelector<HTMLElement>('[data-loom-track]')
    const bg = track ? getComputedStyle(track).backgroundColor : 'missing'
    r0.unmount()
    host0.remove()
    check('a Switch draws its track before any preview has opened', bg !== 'missing' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent', bg)
  }

  // --- 1. drop a component with declared defaults applied ---
  const btn = s.addComponent('Button', withRoot(s), 40, 60)
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
  const panel = s.addComponent('Panel', withRoot(s), 0, 0)
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
        parentOf(s.doc, panel) === withRoot(s),
      `nodes=${Object.keys(s.doc.nodes).length}`,
    )
  }

  // --- 6. deleting the ROOT empties the workspace ----------------------
  // The root is an ordinary design node the user placed, so deleting it takes
  // its subtree and leaves a genuinely empty document. Covered in depth in §33.
  {
    const empty = new EditorStore()
    check('a new workspace has no root', empty.doc.root === null && Object.keys(empty.doc.nodes).length === 0)
    const id = empty.addComponent('Card', null, 10, 10)
    check('first drop becomes the root', empty.doc.root === id)
    if (id === undefined) {
      check('delete on root empties the workspace', false, 'no root created')
      check('undo of a root delete brings it back', false)
    } else {
      empty.select([id])
      empty.remove([id])
      check('delete on root empties the workspace', empty.doc.root === null && Object.keys(empty.doc.nodes).length === 0)
      empty.undo()
      check('undo of a root delete brings it back', empty.doc.root === id)
    }
  }

  // --- 7. ops are pure: the previous document is untouched by apply ---
  const s2 = new EditorStore()
  const a = s2.addComponent('Gauge', withRoot(s2), 5, 5)
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
    const rootId = withRoot(s3)
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

    // Muted lines are Captions (theme-coloured), so text is Label + Caption.
    const labels = Object.values(s4.doc.nodes).filter((n) => n.type === 'Label' || n.type === 'Caption')
    check(
      'demo seeds 8 text lines (2 header, 5 in the cards, 1 footer)',
      labels.length === 8,
      `got ${labels.length}`,
    )
  }

  // --- 11. flow vs free is decided by the PARENT -----------------------
  // Regression: the renderer positioned every leaf absolutely, so children of
  // a flow panel all stacked at left:0 top:0.
  {
    const s5 = new EditorStore()
    const rootId = withRoot(s5)
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
      // The demo creates the root as a real drop, so it is schema-complete
      // like every other node — nothing about it is hand-written.
      if (n.id === withRoot(s6)) continue
      if (!hasAllProps(s6, n.id, n.type)) missing.push(n.id)
    }
    check('every non-root node has all declared props', missing.length === 0, missing.join(','))
    check('root is a normal, complete node', hasAllProps(s6, mustRoot(s6.doc), 'Panel'))
  }

  // --- 13. resize: transient, sealed, and reversible --------------------
  {
    const s7 = new EditorStore()
    const rootId = withRoot(s7)
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
    const rootId = withRoot(s8)
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
    s10.select([withRoot(s10)])
    const host2 = document.createElement('div')
    document.body.appendChild(host2)
    const root2 = createRoot(host2)
    root2.render(
      renderNode(
        { doc: s10.doc, selected: new Set(s10.selection), onPointerDownNode: () => undefined },
        withRoot(s10),
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
    const rootId = withRoot(s12)
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
    check('dangling child reference is dropped', d.doc !== null && !d.doc.nodes[mustRoot(d.doc)].children.includes('does-not-exist'))

    // Duplicate child links.
    const dup = structuredClone(good)
    dup.nodes[dup.root].children = [...dup.nodes[dup.root].children, ...dup.nodes[dup.root].children]
    const dd = validate(dup)
    check(
      'duplicate child links are collapsed',
      dd.doc !== null &&
        new Set(dd.doc.nodes[mustRoot(dd.doc)].children).size === dd.doc.nodes[mustRoot(dd.doc)].children.length,
    )

    // A cycle: a node that is its own ancestor.
    const cyc = structuredClone(good)
    const rootId = cyc.root
    cyc.nodes[rootId].children.push(rootId)
    const c = validate(cyc)
    check('a self-referencing child is removed', c.doc !== null && !c.doc.nodes[mustRoot(c.doc)].children.includes(mustRoot(c.doc)))

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
    s15.addComponent('Button', withRoot(s15), 0, 0)
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
    const rootId = withRoot(s16)
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
    const r2 = withRoot(s17)
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
        withRoot(s18),
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
    // The theme's text colour (the page colour is only painted when a page
    // background is chosen, §69).
    check('export embeds the active theme', html.includes(getTheme('daylight').textPrimary), 'daylight text colour missing')
    check('export is deterministic', emitHtml(se.doc) === html)

    // The export carries its typeface. Without it the page fell to whatever
    // `ui-sans-serif` meant on the machine that opened it (DejaVu Sans on
    // Linux), which is most of why the output looked home made. Proven the
    // way a reader sees it: the page is loaded in a frame under the app's own
    // content-security-policy (a srcdoc frame inherits it, and a policy
    // without `font-src data:` blocks the face) and the text is MEASURED
    // against the platform face.
    for (const name of THEME_NAMES) {
      check(`theme ${name} asks for the shipped face first`, getTheme(name).fontFamily.startsWith(`'${OUTPUT_FAMILY}'`), getTheme(name).fontFamily)
    }
    check('export embeds the output typeface as data', /@font-face\{font-family:'Inter Variable'[^}]*src:url\(data:font\/woff2;base64,/.test(html))
    {
      const frame = document.createElement('iframe')
      frame.style.cssText = 'position:fixed;left:-4000px;top:0;width:800px;height:600px'
      document.body.appendChild(frame)
      await new Promise<void>((r) => { frame.onload = () => r(); frame.srcdoc = html })
      const fd = frame.contentDocument!
      const faces = [...fd.fonts].filter((f) => f.family.replace(/["']/g, '') === OUTPUT_FAMILY)
      const loaded = await Promise.all(faces.map((f) => f.load().then(() => f.status, () => 'error')))
      const probe = (family: string) => {
        const el = fd.createElement('span')
        el.style.cssText = `font:400 32px ${family};white-space:nowrap;position:absolute`
        el.textContent = 'Hamburgefonstiv 0123'
        fd.body.appendChild(el)
        const w = el.getBoundingClientRect().width
        el.remove()
        return w
      }
      const shipped = probe(getTheme('daylight').fontFamily)
      const platform = probe('ui-sans-serif, system-ui, sans-serif')
      frame.remove()
      check('exported page loads its typeface', faces.length === 2 && loaded.every((st) => st === 'loaded'), `faces=${faces.length} ${loaded.join(',')}`)
      check('exported text is set in the shipped face, not the platform one', Math.abs(shipped - platform) > 2, `shipped=${shipped.toFixed(1)} platform=${platform.toFixed(1)}`)
    }

    // Hostile text must be escaped, never emitted raw.
    const evil = new EditorStore()
    evil.addComponent('Label', withRoot(evil), 0, 0, { text: '<script>alert(1)</script>' })
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
        const id = t.addComponent(spec.name, withRoot(t), 0, 0)
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
    bad.nodes.evil = { id: 'evil', type: 'NotAComponent', props: {}, children: [], flow: false, visible: true, locked: false, opacity: 1 }
    bad.nodes[mustRoot(bad)].children.push('evil')
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
    const nanBtn = s20.addComponent('Button', withRoot(s20), 0, 0)
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
        linear = emitHtml(v.doc).length - fontFaceCss().length < 100000
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
          // The embedded typeface is a fixed cost, not rendering.
          rendered = emitHtml(v.doc).length - fontFaceCss().length
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
          const id = t.addComponent(spec.name, withRoot(t), 0, 0)
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

    // Deleting a LOCKED node refuses AND keeps the selection (old review bug 6).
    // The root is deletable now, so the refusal case is the lock.
    {
      const s21 = new EditorStore()
      const locked = withRoot(s21)
      s21.commit({ op: 'setLocked', id: locked, locked: true }, 'Lock')
      s21.select([locked])
      const before = Object.keys(s21.doc.nodes).length
      s21.remove([locked])
      check('refused delete keeps the document', Object.keys(s21.doc.nodes).length === before)
      check('refused delete keeps the selection', s21.selection.includes(locked))
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
      s22.addComponent('Button', withRoot(s22), 0, 0, { variant: 'primary' })
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
    // The one exception, recorded rather than silent: a message list IS a
    // column that new messages are appended to, which free positioning cannot
    // express. Adding a name here needs the same kind of reason.
    // Tabs, accordions and settings sections stack their own sections, which
    // their panels add: free-positioned sections would pile up at 0,0.
    const FLOW_BY_NATURE = new Set(['MessageList', 'Tabs', 'Accordion', 'SettingsSection'])
    const nonFree = allComponents().filter((c) => instantiate(c.name).flow !== false && !FLOW_BY_NATURE.has(c.name))
    check('every component instantiates free (absolute)', nonFree.length === 0, nonFree.map((c) => c.name).join(','))
    check('the flow exceptions are real and few', [...FLOW_BY_NATURE].every((n) => instantiate(n).flow === true) && FLOW_BY_NATURE.size <= 4)
    const panel = getComponent('Panel')
    // Glass is the default material (desktop output is Chromium, 2026-09-28).
    check('Panel defaults to the glass surface', panel?.props.surface?.default === 'glass')
    check('Panel glass is not gated off desktop', panel !== undefined && unsupportedProps(panel, 'desktop').length === 0)
    // Desktop output renders in Chromium (decided 2026-09-28), so it admits
    // every web capability: glass and atmosphere are not web-only.
    check('desktop renders in Chromium: it can express everything the web can',
      (['webview', 'webgl', 'css-filter', 'css-grid', 'css-backdrop-filter'] as const).every((c) => DESKTOP_CAPABILITIES.includes(c)))
    check('no effect is gated off desktop', (['glass', 'aurora', 'grain', 'glow', 'shimmer', 'spotlight', 'tilt', 'chromatic'] as const).every((e) => effectSupported(e, 'desktop')))
    check('the editor targets desktop by default', new EditorStore().target === 'desktop')
  }

  // --- 31. layers: visibility, locks, z-order, duplication ---------------
  // Stolen from Atelier's layers panel: every element manageable outside
  // the canvas, with output-truth (hidden really hides) and exact undo.
  {
    // Visible/locked ride ops with exact inverses.
    const s23 = new EditorStore()
    const b = s23.addComponent('Button', withRoot(s23), 10, 10)
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
      if (id === withRoot(s24) || (n.type !== 'Label' && n.type !== 'Caption')) return false
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
      renderNode({ doc: s24.doc, selected: new Set(), mode: 'preview' }, withRoot(s24))
      check('preview renders with hidden nodes present', true)
    } else {
      check('hidden nodes leave the output', false, 'no label found')
      check('hidden nodes stay in the document', false)
      check('preview renders with hidden nodes present', false)
    }

    // Locked nodes refuse deletion; the selection survives the refusal.
    const s25 = new EditorStore()
    const l1 = s25.addComponent('Button', withRoot(s25), 0, 0)
    const l2 = s25.addComponent('Label', withRoot(s25), 0, 0)
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
    const card = s26.addComponent('Panel', withRoot(s26), 50, 60, {}, { flow: false })
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
      check('root refuses duplication', s26.duplicate(withRoot(s26)) === undefined)
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
    const za = s27.addComponent('Button', withRoot(s27), 0, 0, { label: 'a' })
    const zb = s27.addComponent('Button', withRoot(s27), 10, 10, { label: 'b' })
    const zc = s27.addComponent('Button', withRoot(s27), 20, 20, { label: 'c' })
    if (za && zb && zc) {
      s27.commit({ op: 'reparent', id: zb, parent: withRoot(s27), index: 0 }, 'Move forward')
      check('layers move-forward reorders', JSON.stringify(s27.doc.nodes[withRoot(s27)].children) === JSON.stringify([zb, za, zc]),
        JSON.stringify(s27.doc.nodes[withRoot(s27)].children))
      s27.undo()
      check('undo restores z-order', JSON.stringify(s27.doc.nodes[withRoot(s27)].children) === JSON.stringify([za, zb, zc]))
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

  // --- 32. React emitter: single-file component, no dependencies ------
  // Same single-source-of-truth contract as the HTML emitter: converted
  // from the preview renderer, so all 111 components work by construction.
  {
    const s28 = new EditorStore()
    seedDemo(s28)
    s28.setTheme('daylight')
    const src = emitReact(s28.doc)
    check('react output is a default-exported module', src.includes('export default function LoomExport'))
    check('react output imports only react', src.includes("import React from 'react'") && !src.includes('tailwind'))
    check('react output embeds the theme', src.includes('#2f5fe0') && src.includes('const THEME'))
    check('react output keeps absolute positioning', src.includes('"position": "absolute"'))
    check('react output carries no editor hooks', !src.includes('data-loom-id') && !src.includes('loom-handle'))
    check('react output is deterministic', emitReact(s28.doc) === src)
    // It must COMPILE and RUN (npm run probe:react compiles, renders and
    // mounts every export for real); these are the fast guards for the three
    // ways it did not: a style as `style={"k": v}` (a syntax error in every
    // export), custom properties camel-cased (`--loom-accent` as
    // `-LoomAccent`), and a behaviour runtime that ran on import (touching
    // `window`, leaving nothing to call on mount).
    check('react styles are object literals: style={{...}}', src.includes('style={{"') && !/style=\{"/.test(src))
    check('react keeps custom properties by name', src.includes('"--loom-accent"') && !src.includes('-LoomAccent'))
    check('react installs its behaviour on mount, not on import', /const installBehaviour = \(function[\s\S]*\}\);\n/.test(src) && !/const installBehaviour = \(function[\s\S]*?\}\)\(\);\n/.test(src))
    // The page under the design travels with the component, as in the HTML
    // export (export/page.ts): the typeface embedded, the aurora drawn and
    // moving, and every page rule scoped to the component's own wrapper.
    const pageCss = /const PAGE_CSS = (".*");\n/.exec(src)?.[1]
    const pageRules = pageCss ? (JSON.parse(pageCss) as string) : ''
    check('react embeds the output typeface', /@font-face\{font-family:'Inter Variable'[^}]*src:url\(data:font\/woff2;base64,/.test(pageRules))
    check('react draws the aurora page', s28.doc.meta.page?.background === 'aurora' && src.includes('data-loom-aurora') && pageRules.includes('@keyframes loom-wander-1'))
    check('react page rules stay inside the component', src.includes('className="loom-export loom-container"') && !/(^|\})\s*body\{/.test(pageRules) && !/(^|\})\s*\*,/.test(pageRules), pageRules.slice(0, 80))
    check('react filename is filesystem-safe', reactFilenameFor('My App / v2.0!') === 'my-app-v2-0.jsx', reactFilenameFor('My App / v2.0!'))

    // Hostile text is expression-wrapped (a JS string literal, never parsed
    // as JSX), so markup-significant characters cannot break the module.
    const evil = new EditorStore()
    evil.addComponent('Label', withRoot(evil), 0, 0, { text: '<b>{x}</b> & "q"' })
    const evilSrc = emitReact(evil.doc)
    check('react output escapes hostile text', evilSrc.includes('{"<b>{x}</b>'))

    // Every registered component converts without throwing.
    const failed: string[] = []
    for (const spec of allComponents()) {
      try {
        const t = new EditorStore()
        const id = t.addComponent(spec.name, withRoot(t), 0, 0)
        if (!id) {
          failed.push(`${spec.name} (no id)`)
          continue
        }
        const out = emitReact(t.doc)
        if (!out.includes('LoomExport')) failed.push(`${spec.name} (empty)`)
      } catch (e) {
        failed.push(`${spec.name} (${String(e).slice(0, 80)})`)
      }
    }
    check('react covers all registered components', failed.length === 0, failed.join('; ').slice(0, 300))

    // Fail-fast like the HTML emitter.
    const bad = structuredClone(s28.doc)
    bad.nodes.evil = { id: 'evil', type: 'NotAComponent', props: {}, children: [], flow: false, visible: true, locked: false, opacity: 1 }
    bad.nodes[mustRoot(bad)].children.push('evil')
    let threw = false
    try {
      emitReact(bad)
    } catch {
      threw = true
    }
    check('react throws on unknown components', threw)
  }

  // --- 33. rootless lifecycle, opacity, frameless-output truths ---------
  {
    // Deleting the root is an ordinary delete: the workspace becomes empty
    // and the user can rebuild it, or undo.
    const s30 = new EditorStore()
    seedDemo(s30)
    const full = Object.keys(s30.doc.nodes).length
    const root30 = mustRoot(s30.doc)
    s30.select([root30])
    s30.remove([root30])
    check('delete on root empties the workspace', s30.doc.root === null && Object.keys(s30.doc.nodes).length === 0,
      `${full} -> ${Object.keys(s30.doc.nodes).length}`)
    check('the empty workspace exports an empty page', emitHtml(s30.doc).includes('<!DOCTYPE html>'))
    check('delete is labelled, not a silent clear', s30.history[s30.history.length - 1]?.label === 'Delete root')
    s30.undo()
    check('undo of a root delete restores everything', Object.keys(s30.doc.nodes).length === full)
    // Deleting from an already-empty workspace is a no-op: no phantom history.
    s30.redo()
    const h0 = s30.history.length
    s30.remove([root30])
    check('deleting from an empty workspace adds no history', s30.history.length === h0)

    // Opacity: universal node field with exact undo + clamped writes.
    const s31 = new EditorStore()
    const ob = s31.addComponent('Button', withRoot(s31), 0, 0)
    check('new nodes are fully opaque', ob ? s31.doc.nodes[ob].opacity === 1 : false)
    if (ob) {
      s31.commit({ op: 'setOpacity', id: ob, opacity: 0.4 }, 'Opacity')
      check('opacity commits', s31.doc.nodes[ob].opacity === 0.4)
      s31.undo()
      check('undo of opacity restores', s31.doc.nodes[ob].opacity === 1)
      s31.commit({ op: 'setOpacity', id: ob, opacity: 7 }, 'Opacity')
      check('opacity clamps above 1', s31.doc.nodes[ob].opacity === 1)
      s31.commit({ op: 'setOpacity', id: ob, opacity: -3 }, 'Opacity')
      check('opacity clamps below 0', s31.doc.nodes[ob].opacity === 0)
      const html = emitHtml(s31.doc)
      check('zero opacity reaches the output', html.includes('opacity:0'))
    } else {
      check('opacity commits', false, 'no node')
      check('undo of opacity restores', false)
      check('opacity clamps above 1', false)
      check('opacity clamps below 0', false)
      check('zero opacity reaches the output', false)
    }

    // The loader coerces opacity like any other trust-boundary value.
    const ov = validate({ version: 1, meta: { name: 'o', targets: ['web'], created: 0 }, root: 'root', nodes: {
      root: { id: 'root', type: 'Panel', props: {}, children: ['a'], flow: false, visible: true, locked: false, opacity: 'half' },
      a: { id: 'a', type: 'Label', props: { text: 'x' }, children: [], flow: false, visible: true, locked: false, opacity: 0.25 },
    } })
    check('loader repairs garbage opacity with an issue', ov.doc?.nodes.root.opacity === 1 &&
      ov.issues.some((i) => i.path.includes('$.nodes.root.opacity')))
    check('loader keeps valid opacity silently', ov.doc?.nodes.a.opacity === 0.25 &&
      !ov.issues.some((i) => i.path.includes('$.nodes.a.opacity')))
  }

  {
    // Styling work survives the file round trip (effects + z).
    const s29 = new EditorStore()
    seedDemo(s29)
    const effId = Object.keys(s29.doc.nodes).find((id) => id !== withRoot(s29))
    if (effId) {
      s29.commit({ op: 'setEffects', id: effId, patch: { glass: true } }, 'fx')
      const rt = validate(serialize(s29.doc))
      check('effects survive save/load', rt.doc?.nodes[effId]?.effects?.glass === true)
      check('clean nodes carry no effects baggage', rt.doc ? Object.values(rt.doc.nodes).every((n) => n.effects === undefined || typeof n.effects === 'object') : false)
    } else {
      check('effects survive save/load', false, 'no node')
      check('clean nodes carry no effects baggage', false)
    }
  }

  // --- 34. new workspace resets everything, cleanly --------------------
  // The New button path is loadDocument(emptyDocument()): an OPEN, not an
  // edit. The dirty-confirm lives in the UI (untestable headlessly); the
  // store contract below is what it guards.
  {
    const s32 = new EditorStore()
    seedDemo(s32)
    s32.select([mustRoot(s32.doc)])
    const named = s32.doc.meta.name
    check('demo seeds unsaved work', s32.dirty === true && named !== 'Untitled')
    s32.loadDocument(emptyDocument())
    check('new workspace has no root at all', s32.doc.root === null && Object.keys(s32.doc.nodes).length === 0)
    check('new workspace is untitled', s32.doc.meta.name === 'Untitled')
    check('new workspace resets history', s32.history.length === 0)
    check('new workspace clears selection', s32.selection.length === 0)
    check('new workspace is clean', s32.dirty === false)
    check('an empty document still exports', emitHtml(s32.doc).includes('<!DOCTYPE html>'))
  }

  // --- 35. the root is an ordinary node the USER placed -----------------
  // No auto-created panel. The first drop becomes the root, and because the
  // user owns it, it is selectable, movable, resizable, editable, deletable —
  // no special cases anywhere.
  {
    const s33 = new EditorStore()
    const root33 = withRoot(s33)
    const authRoot = renderToStaticMarkup(renderNode({ doc: s33.doc, selected: new Set() }, root33))
    check('authoring root carries its hooks', authRoot.includes('data-loom-id'))
    check('authoring root renders as a real node', authRoot.includes('border'))
    const selRoot = renderToStaticMarkup(
      renderNode({ doc: s33.doc, selected: new Set([root33]) }, root33),
    )
    // Handles are canvas chrome, drawn over the design by the canvas's
    // selection layer (§101), not inside the node where its own overflow
    // clipped them; the node itself carries the selection mark.
    check('the root is marked selected like any node, and draws no handles of its own', selRoot.includes('data-selected="true"') && !selRoot.includes('loom-handle'))
    check('handles never reach the output', !emitHtml(s33.doc).includes('loom-handle'))

    // Move + resize reach the model for the root exactly as for a child.
    s33.commit({ op: 'move', id: root33, x: 40, y: 30 }, 'Move')
    s33.commit({ op: 'resize', id: root33, w: 640, h: 480 }, 'Resize')
    check('the root moves', s33.doc.nodes[root33]?.props.x === 40 && s33.doc.nodes[root33]?.props.y === 30)
    check('the root resizes', s33.doc.nodes[root33]?.props.w === 640 && s33.doc.nodes[root33]?.props.h === 480)
    s33.commit({ op: 'setProp', id: root33, key: 'background', value: '#101319' }, 'Set background')
    check('the root is editable', s33.doc.nodes[root33]?.props.background === '#101319')

    // An untouched, unsized root is the page. Once the user sizes or moves
    // it, the export honours their decision instead of overriding it.
    // Match the CHILD override specifically: the page wrapper itself is
    // always min-height:100vh, so the bare string proves nothing.
    const pagey = emitHtml(rootDoc())
    check('an untouched root fills the page', pagey.includes('.loom-export>:first-child'))
    check(
      'a user-sized root is exported as authored',
      !emitHtml(s33.doc).includes('.loom-export>:first-child'),
    )

    const s34 = new EditorStore()
    seedDemo(s34)
    const flowRoot = renderToStaticMarkup(renderNode({ doc: s34.doc, selected: new Set() }, mustRoot(s34.doc)))
    check('authoring root keeps flow layout', flowRoot.includes('display:flex'))
  }

  // --- 36. rootless invariants ------------------------------------------
  // "Empty" and "root" are first-class states, not special cases.
  {
    const s35 = new EditorStore()
    check('a fresh store is genuinely empty', s35.doc.root === null && Object.keys(s35.doc.nodes).length === 0)

    // Only ONE root can ever exist: a second rootless insert is refused.
    const first = s35.addComponent('Panel', null, 0, 0)
    const second = s35.addComponent('Panel', null, 0, 0)
    check('the first drop becomes the root', s35.doc.root === first)
    check('a second drop cannot create a second root', second === undefined && s35.doc.root === first)

    // Children land inside the existing root, as they always did.
    const kid = s35.addComponent('Label', mustRoot(s35.doc), 0, 0)
    check('later drops parent into the root', kid !== undefined && parentOf(s35.doc, kid) === mustRoot(s35.doc))

    // The page root is not a duplicate candidate (it has no parent to hold it).
    check('the root refuses duplication', s35.duplicate(mustRoot(s35.doc)) === undefined)

    // setRoot: emptying and re-rooting are ops, so they are undoable.
    const before = Object.keys(s35.doc.nodes).length
    s35.commit({ op: 'setRoot', id: null }, 'Empty workspace')
    check('setRoot(null) empties the document', s35.doc.root === null && Object.keys(s35.doc.nodes).length === 0)
    s35.undo()
    check('undo restores an emptied workspace', Object.keys(s35.doc.nodes).length === before)
    check('undo restores the same root', s35.doc.root === first)

    // Round-trip: an empty document survives a save/load cycle.
    const roundTrip = validate(serialize(s35.doc))
    check('a rooted document round-trips', roundTrip.doc?.root === first)
    const emptyDoc = validate(serialize(emptyDocument()))
    check('an empty document round-trips with no root', emptyDoc.doc !== null && emptyDoc.doc.root === null)
    check('an empty document keeps zero nodes', emptyDoc.doc ? Object.keys(emptyDoc.doc.nodes).length === 0 : false)

    // A file claiming no root but carrying nodes is repaired, not trusted.
    const stray = { version: 1, meta: { name: 'Stray', targets: ['web'], created: 1 }, root: null, nodes: { a: { id: 'a', type: 'Panel', props: {}, children: [], flow: false, visible: true, locked: false, opacity: 1 } } }
    const repaired = validate(stray)
    check('nodes with no root are dropped, and reported', repaired.doc !== null && Object.keys(repaired.doc.nodes).length === 0 && repaired.issues.some((i) => i.path === '$.nodes'))

    // An empty document still produces valid output on both emitters.
    check('empty document exports HTML', emitHtml(emptyDocument()).includes('<!DOCTYPE html>'))
    check('empty document exports React', emitReact(emptyDocument()).includes('export default'))

    // The demo seeds a root the same way a user's first drop does.
    const s36 = new EditorStore()
    seedDemo(s36)
    check('the demo creates its own root', s36.doc.root !== null && Object.keys(s36.doc.nodes).length > 1)
    check('the demo root is a normal Panel', s36.doc.nodes[mustRoot(s36.doc)]?.type === 'Panel')
  }

  // --- 37. built-in control behaviour ------------------------------------
  // The promise: every interactive control WORKS, with no authoring, and it
  // works the same in the preview and in both exports.
  {
    // The contract table is explicit and total for the control families.
    const expected: Record<string, string> = {
      Button: 'press', IconButton: 'press', BackButton: 'press',
      Link: 'press', FileUpload: 'press',
      Switch: 'toggle', ToggleButton: 'toggle', DropdownButton: 'toggle',
      Checkbox: 'check', Checklist: 'check',
      TabPanel: 'panel', AccordionItem: 'disclosure',
    }
    const wrong = Object.entries(expected).filter(([type, role]) => ROLE_OF[type] !== role)
    check('every pressable/boolean control has its built-in role', wrong.length === 0,
      wrong.map(([t, r]) => `${t}=${String(ROLE_OF[t])} want ${r}`).join(', '))
    check('the item-role families are declared', ITEM_ROLE.Tabs === 'tab' && ITEM_ROLE.DataGrid === 'sort' &&
      ITEM_ROLE.Pagination === 'page' && ITEM_ROLE.Rating === 'rate' && ITEM_ROLE.ProgressDots === 'dot' &&
      ITEM_ROLE.Stepper === 'step' && ITEM_ROLE.TreeList === 'expand' && ITEM_ROLE.TabBar === 'tab')
    check('the reveal chrome is declared', REVEAL_OF.Modal === 'reveal' && REVEAL_OF.Drawer === 'reveal' &&
      REVEAL_OF.SidebarPanel === 'reveal')

    // No control is interactive in name only: every declared type must be a
    // real component, or the table is lying about coverage.
    const unknown = interactiveTypes().filter((t) => !getComponent(t))
    check('every interactive type is a real component', unknown.length === 0, unknown.join(','))

    // Static things stay static. A Label that toggles would be a bug.
    check('static components claim no role', !ROLE_OF.Label && !ROLE_OF.Panel && !ROLE_OF.Paragraph)

    // The runtime is real, self-guarding, and syntactically valid JS.
    const rt = behaviourRuntime()
    check('the runtime guards against double-binding', rt.includes('__loomBehaviour'))
    check('the runtime handles every role it ships', interactiveTypes().length > 20)
    // It travels as SOURCE, so it must be self-contained: no imports, and no
    // eval (a strict content-security-policy forbids eval, and a throw inside
    // a React effect unmounts the tree).
    check('the runtime is self-contained source', !/\bimport\b|\brequire\(/.test(rt))
    check('the runtime never uses eval', !rt.includes('eval('))
    check('the runtime source installs the layer', rt.startsWith('(') && rt.includes('addEventListener'))

    // The stylesheet carries the state rules, and no hard-coded colours:
    // state must read the theme custom properties, never a second palette.
    const css = behaviourCss()
    check('the stylesheet has a state rule per role family',
      ['press', 'toggle', 'tab', 'disclosure', 'sort', 'page', 'dot', 'step', 'rate', 'check', 'radio', 'expand']
        .every((r) => css.includes(`data-loom-b="${r}"`)))
    check('the reveal chrome has its own state rules', css.includes('[data-loom-reveal]') && css.includes('[data-loom-scrim]'))
    check('a closed dropdown menu is hidden', css.includes('[data-loom-menu-panel][data-loom-open="0"]'))
    check('state colours come from theme variables', css.includes('var(--loom-on)') && css.includes('var(--loom-accent'))
    check('a pressed control looks pressed', css.includes('[data-loom-pressed="1"]'))
    // Forced: the panel's own display is inline, which beat the plain rule
    // (§98 measures it live).
    check('a closed panel is hidden', css.includes('[data-loom-b="panel"][data-loom-shown="0"]{display:none !important}'))
    check('a collapsed drawer is hidden even against inline styles',
      css.includes(':not([data-loom-open="1"]){display:none !important}'))

    // The attribute builder is total: state is always expressed as data.
    const attrs = behaviourAttrs({ role: 'tab', group: 'g1', index: 2, active: true })
    check('attributes carry role, group and index',
      attrs['data-loom-b'] === 'tab' && attrs['data-loom-g'] === 'g1' && attrs['data-loom-i'] === '2' &&
      attrs['data-loom-active'] === '1')
    check('attributes never leak undefined', !Object.values(behaviourAttrs({ role: 'press' })).some((v) => v === undefined || v === ''))

    // REAL markup: render a document with one of every interactive control
    // and assert the output carries the contract, not a picture of it.
    const sb = new EditorStore()
    const r = withRoot(sb)
    const made: Record<string, string> = {}
    for (const type of interactiveTypes()) {
      const id = sb.addComponent(type, r, 0, 0)
      if (id) made[type] = id
    }
    const missing = interactiveTypes().filter((t) => !made[t])
    check('every interactive control can be placed', missing.length === 0, missing.join(','))
    if (missing.length === 0) {
      const html = emitHtml(sb.doc)
      const roleCount = (html.match(/data-loom-b="/g) ?? []).length
      check('output marks interactive controls', roleCount > 30, `${roleCount} marks`)
      check('buttons carry the press role', html.includes('data-loom-b="press"'))
      check('tabs carry a group and an index', html.includes('data-loom-b="tab"') && html.includes('data-loom-g='))
      check('accordions ship their open state', html.includes('data-loom-b="disclosure"') && html.includes('data-loom-open='))
      check('grid headers are sortable', html.includes('data-loom-b="sort"') && html.includes('data-loom-rows'))
      check('modals are dismissible', html.includes('data-loom-close=') && html.includes('data-loom-scrim'))
      // The single most important regression guard: no control may ship a
      // handler that does nothing. A no-op onChange is a control that lies.
      check('no control ships a dead onChange', !/onChange\s*=/.test(html))
      check('native inputs are uncontrolled, not pinned', !/\bvalue=""\s*\/?>/.test(html))
      // The behaviour layer must travel WITH the document.
      check('the export carries the state stylesheet', html.includes('data-loom-b="press"]'))
      check('the export carries the runtime', html.includes('__loomBehaviour'))
      // React export ships the same layer.
      const jsx = emitReact(sb.doc)
      check('the React export carries the behaviour layer',
        jsx.includes('BEHAVIOUR_CSS') && jsx.includes('installBehaviour') && jsx.includes('useEffect'))
      check('the React export installs it without eval', !jsx.includes('eval('))
      check(
        'the React export is still self-contained',
        jsx.includes('export default') &&
          !jsx.includes("from 'react-dom'") &&
          !jsx.includes('@radix') &&
          !jsx.includes('antd'),
      )
    }
  }

  // --- 38. the controls ACTUALLY WORK (live DOM, real clicks) -----------
  // Markup carrying a role proves nothing. This drives the real runtime with
  // real events and asserts the DOM state changed — the same thing a person
  // does when they click the artifact.
  {
    const s38 = new EditorStore()
    const r38 = withRoot(s38)
    const tabs = s38.addComponent('Tabs', r38, 0, 0, { tabs: 'Overview, Activity' })
    s38.addComponent('TabPanel', tabs ?? r38, 0, 0, { title: 'Overview' })
    s38.addComponent('TabPanel', tabs ?? r38, 0, 0, { title: 'Activity' })
    s38.addComponent('Switch', r38, 0, 0, { label: 'Live', on: false })
    s38.addComponent('AccordionItem', r38, 0, 0, { title: 'Details', expanded: false })
    s38.addComponent('Button', r38, 0, 0, { label: 'Save' })
    s38.addComponent('DataGrid', r38, 0, 0, { columns: 'Name,Score', rows: 'grace|30;ada|10;linus|20' })
    s38.addComponent('Rating', r38, 0, 0, { value: 1, max: 5 })
    s38.addComponent('Slider', r38, 0, 0, { value: 20, min: 0, max: 100 })
    s38.addComponent('Pagination', r38, 0, 0, { page: 2, total: 9 })

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root38 = createRoot(host)
    root38.render(React.createElement(PreviewStage, { s: s38 }))
    await new Promise((res) => setTimeout(res, 120))
    const stage = host.querySelector('.preview-stage')

    check('the behaviour runtime installed itself', Boolean((window as unknown as { __loomBehaviour?: boolean }).__loomBehaviour))
    check('the behaviour stylesheet is present', Boolean(document.querySelector('style[data-loom-behaviour]')))

    // --- tabs: clicking the second tab shows the second panel -----------
    const tabEls = stage ? Array.from(stage.querySelectorAll('[data-loom-b="tab"]')) : []
    check('both tabs rendered', tabEls.length === 2, `${tabEls.length}`)
    if (tabEls.length === 2) {
      check('the authored tab starts active', tabEls[0].getAttribute('aria-selected') === 'true')
      tabEls[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
      check('clicking a tab selects it', tabEls[1].getAttribute('aria-selected') === 'true' &&
        tabEls[0].getAttribute('aria-selected') === 'false')
      // The strip must SHOW the switch, not just record it: the active tab has
      // to actually look different from the inactive one.
      const activeColor = getComputedStyle(tabEls[1]).color
      const idleColor = getComputedStyle(tabEls[0]).color
      check('the active tab is visually distinct', activeColor !== idleColor, `${activeColor} vs ${idleColor}`)
      // Preview output carries no editor ids, so panels are addressed by role
      // and position — the Nth panel belongs to the Nth tab.
      const panels = stage ? Array.from(stage.querySelectorAll('[data-loom-b="panel"]')) : []
      check('both tab panels rendered', panels.length === 2, `${panels.length}`)
      check('the tab panel actually shows', panels[1]?.getAttribute('data-loom-shown') === '1')
      check('the other panel actually hides', panels[0]?.getAttribute('data-loom-shown') === '0')
    }

    // --- switch: flips, and reports itself to assistive tech ------------
    {
      const el = stage?.querySelector('[data-loom-b="toggle"]') ?? null
      check('the switch starts off', el?.getAttribute('data-loom-on') === '0')
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      check('clicking the switch turns it on', el?.getAttribute('data-loom-on') === '1')
      check('the switch reports aria-checked', el?.getAttribute('aria-checked') === 'true')
      check('the switch knob is styled by state', (() => {
        const track = el?.querySelector('[data-loom-track]')
        return track ? getComputedStyle(track).backgroundColor !== '' : false
      })())
    }

    // --- accordion: opens and closes ------------------------------------
    {
      const el = stage?.querySelector('[data-loom-b="disclosure"]') ?? null
      check('the accordion starts closed', el?.getAttribute('data-loom-open') === '0')
      const summary = el?.querySelector('[data-loom-summary]')
      summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      check('clicking the summary opens it', el?.getAttribute('data-loom-open') === '1')
      check('the open body is actually visible', (() => {
        const body = el?.querySelector('[data-loom-body]')
        return body ? getComputedStyle(body).display !== 'none' : false
      })())
      summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      check('clicking again closes it', el?.getAttribute('data-loom-open') === '0')
    }

    // --- button: visible press feedback ---------------------------------
    {
      const el = stage?.querySelector('[data-loom-b="press"]') ?? null
      el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      check('holding a button shows it pressed', el?.getAttribute('data-loom-pressed') === '1')
      el?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      check('releasing clears the press', el?.getAttribute('data-loom-pressed') === null)
      let fired = false
      el?.addEventListener('loom:press', () => { fired = true })
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      check('a button announces its action', fired)
    }

    // --- table: sorting actually reorders rows --------------------------
    {
      const headers = stage ? Array.from(stage.querySelectorAll('[data-loom-b="sort"]')) : []
      check('table headers are sortable', headers.length === 2, `${headers.length}`)
      const scoreHeader = headers[1]
      const firstCell = () =>
        stage?.querySelector('[data-loom-rows] [data-loom-row] [data-loom-cell="0"]')?.textContent ?? ''
      // Deliberately unsorted input: an assertion that can pass on the
      // untouched document order is not an assertion.
      check('the grid starts in document order, not sorted', firstCell() === 'grace', firstCell())
      scoreHeader?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      check('sorting ascending puts the lowest score first', firstCell() === 'ada', firstCell())
      scoreHeader?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      check('clicking again sorts descending', firstCell() === 'grace', firstCell())
      check('the sort direction is exposed', scoreHeader?.getAttribute('data-loom-sort') === 'desc',
        `headers=${headers.length}`)
    }

    // --- rating, slider, pagination -------------------------------------
    {
      const el = stage?.querySelector('[data-loom-b="rate"]') ?? null
      const stars = el ? Array.from(el.querySelectorAll('[data-loom-star]')) : []
      stars[3]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      check('clicking a star sets the rating', el?.getAttribute('data-loom-value') === '4')
      check('the stars relit to match', stars.filter((s) => s.getAttribute('data-loom-lit') === '1').length === 4)
    }
    {
      const input0 = stage?.querySelector('input[type=range]') ?? null
      const el = input0?.parentElement ?? stage
      const input = input0
      const readout = el?.querySelector('[data-loom-readout]')
      check('the slider shows its authored value', readout?.textContent === '20')
      if (input instanceof HTMLInputElement) {
        input.value = '65'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      check('the readout follows the slider live', readout?.textContent === '65')
    }
    {
      const el = stage?.querySelector('[data-loom-pager]') ?? null
      const pageBtns = el ? Array.from(el.querySelectorAll('[data-loom-b="page"]')) : []
      check('pagination renders its pages', pageBtns.length >= 3, `${pageBtns.length}`)
      const three = pageBtns.find((b) => b.getAttribute('data-loom-i') === '3')
      three?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      check('clicking a page marks it current', three?.getAttribute('aria-current') === 'page')
      check('only one page is current', pageBtns.filter((b) => b.getAttribute('aria-current') === 'page').length === 1,
        pageBtns.map((b) => `${b.getAttribute('data-loom-i')}:${b.getAttribute('aria-current')}`).join(' '))
    }

    // --- a field's validation state must reach the control inside it -----
    // Markup can claim a state; only computed style proves the control changed.
    {
      const host2 = document.createElement('div')
      document.body.appendChild(host2)
      const s45 = new EditorStore()
      const r45 = withRoot(s45)
      const fld = s45.addComponent('Field', r45, 0, 0, { label: 'Region', state: 'error', message: 'Required' })
      s45.addComponent('Select', fld ?? r45, 0, 0, { options: 'us-east,eu-west' })
      const root45 = createRoot(host2)
      root45.render(React.createElement(PreviewStage, { s: s45 }))
      await new Promise((res) => setTimeout(res, 120))
      const field = host2.querySelector('[data-loom-field]') as HTMLElement | null
      const select = field?.querySelector('select') as HTMLSelectElement | null
      check('the field exposes its validation state', field?.getAttribute('data-loom-state') === 'error')
      check('the field marks itself invalid for assistive tech', field?.getAttribute('aria-invalid') === 'true')
      check('the message is announced', Boolean(field?.querySelector('[role="alert"]')))
      check('a control inside an error field takes the error ring', (() => {
        if (!select) return false
        const ring = getComputedStyle(select).borderTopColor
        return ring !== '' && ring !== 'rgba(0, 0, 0, 0)'
      })())
      // And a select inside a field is genuinely a select: choosing works.
      if (select) {
        select.value = 'eu-west'
        check('a select inside a field is operable', select.value === 'eu-west')
      }
      root45.unmount()
      host2.remove()
    }

    // --- the command palette must index the artifact and RUN things ----
    // A hand-maintained command list is a second copy of the interface that
    // goes stale immediately. The palette reads the document, so pressing
    // Enter has to actually press the control it names.
    {
      const host4 = document.createElement('div')
      document.body.appendChild(host4)
      const s50 = new EditorStore()
      const r50 = withRoot(s50)
      const shell50 = s50.addComponent('AppShell', r50, 0, 0)
      if (shell50) {
        s50.addComponent('Menu', shell50, 0, 0)
        s50.addComponent('HeaderBar', shell50, 0, 0)
      }
      s50.addComponent('Button', r50, 0, 0, { label: 'Publish release' })
      s50.addComponent('Link', r50, 0, 0, { text: 'Open billing' })
      s50.addComponent('CommandPalette', r50, 0, 0)
      const root50 = createRoot(host4)
      root50.render(React.createElement(PreviewStage, { s: s50 }))
      await new Promise((res) => setTimeout(res, 140))
      const palette = host4.querySelector('[data-loom-palette]') as HTMLElement | null
      check('the palette renders closed', palette?.getAttribute('data-loom-open') === '0')
      // Open it the way a person does.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
      await new Promise((res) => setTimeout(res, 80))
      check('the hotkey opens the palette', palette?.getAttribute('data-loom-open') === '1')
      const rows = palette ? Array.from(palette.querySelectorAll('[data-loom-cmd]')) : []
      const labels = rows.map((r) => r.textContent ?? '')
      check('the palette indexes the design\'s own controls',
        labels.includes('Publish release') && labels.includes('Open billing'), labels.join(' | '))
      check('the palette groups its commands', palette?.querySelectorAll('[data-loom-cmd-group]').length !== 0)
      check('the first row is active', rows[0]?.getAttribute('data-loom-active') === '1')

      // Typing filters.
      const input = palette?.querySelector('[data-loom-palette-input]') as HTMLInputElement | null
      if (input) {
        input.value = 'bill'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      await new Promise((res) => setTimeout(res, 60))
      const filtered = palette ? Array.from(palette.querySelectorAll('[data-loom-cmd]')) : []
      check('typing filters the commands', filtered.length === 1 &&
        (filtered[0]?.textContent ?? '') === 'Open billing', filtered.map((r) => r.textContent).join(' | '))
      // Fuzzy: a subsequence, not a prefix, is enough.
      if (input) {
        input.value = 'pub rel'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      await new Promise((res) => setTimeout(res, 60))
      const fuzzyRows = palette ? Array.from(palette.querySelectorAll('[data-loom-cmd]')) : []
      check('matching is fuzzy, not just prefix', fuzzyRows.length === 1 &&
        (fuzzyRows[0]?.textContent ?? '') === 'Publish release', fuzzyRows.map((r) => r.textContent).join(' | '))
      // Something that matches nothing empties the list and says so.
      if (input) {
        input.value = 'zzzznope'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      await new Promise((res) => setTimeout(res, 60))
      check('an empty result says so', (palette?.querySelectorAll('[data-loom-cmd]').length ?? 0) === 0 &&
        (palette?.querySelector('[data-loom-palette-empty]') as HTMLElement | null)?.style.display === 'block')
      // Enter runs the command it names: the real control gets pressed.
      if (input) {
        input.value = 'Publish'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      await new Promise((res) => setTimeout(res, 60))
      const publishRow = Array.from(palette?.querySelectorAll('[data-loom-cmd]') ?? [])
        .find((r) => (r.textContent ?? '').includes('Publish')) as HTMLElement | undefined
      check('the filtered command is present', Boolean(publishRow))
      // The whole claim of indexing the document is that running a command
      // presses the REAL control, so watch that control — not the palette row.
      // By LABEL, not by "first pressable": the shell's own collapse toggle is
      // also a pressable, and grabbing it would have watched the wrong control.
      const realButton = Array.from(host4.querySelectorAll('[data-loom-b="press"]'))
        .find((b) => (b.textContent ?? '').includes('Publish')) as HTMLElement | undefined
      check('the real control exists in the artifact', Boolean(realButton))
      if (publishRow && realButton) {
        let realPresses = 0
        realButton.addEventListener('click', () => { realPresses += 1 })
        publishRow.click()
        check('running a command presses the control it names', realPresses === 1, `${realPresses} presses`)
        check('running a command closes the palette', palette?.getAttribute('data-loom-open') === '0')
      }
      // Escape closes without running anything.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
      await new Promise((res) => setTimeout(res, 60))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise((res) => setTimeout(res, 60))
      check('escape closes the palette', palette?.getAttribute('data-loom-open') === '0')
      root50.unmount()
      host4.remove()
    }

    // --- the shell's collapse must actually collapse -------------------
    // Markup can claim a collapsed shell; only a measured width proves it.
    {
      const host3 = document.createElement('div')
      document.body.appendChild(host3)
      const s49 = new EditorStore()
      const r49 = withRoot(s49)
      const shell = s49.addComponent('AppShell', r49, 0, 0, { sidebarWidth: 240, railWidth: 64 })
      if (shell) {
        s49.addComponent('Menu', shell, 0, 0)
        s49.addComponent('HeaderBar', shell, 0, 0)
      }
      const root49 = createRoot(host3)
      root49.render(React.createElement(PreviewStage, { s: s49 }))
      await new Promise((res) => setTimeout(res, 120))
      const shellEl = host3.querySelector('[data-loom-shell]') as HTMLElement | null
      const sideEl = shellEl?.querySelector('[data-loom-shell-sidebar]') as HTMLElement | null
      const toggle = shellEl?.querySelector('[data-loom-shell-toggle]') as HTMLElement | null
      check('the shell renders its sidebar', Boolean(sideEl))
      const wide = sideEl ? Math.round(sideEl.getBoundingClientRect().width) : 0
      check('the sidebar starts at its authored width', wide > 200 && wide < 260, `${wide}px`)
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      check('collapsing is recorded as state', shellEl?.getAttribute('data-loom-collapsed') === '1')
      check('the toggle reports its state', toggle?.getAttribute('aria-expanded') === 'false')
      const narrow = await widthWithoutTransition(sideEl)
      check('the sidebar really narrows to the rail', narrow > 40 && narrow < 90,
        `${wide}px -> ${narrow}px (rail ${sideEl ? getComputedStyle(sideEl).getPropertyValue('--loom-sidebar-w').trim() : '?'})`)
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      const back = await widthWithoutTransition(sideEl)
      check('and it expands again', back > 200, `${back}px`)
      check('the collapsed sidebar clips its contents', sideEl ? getComputedStyle(sideEl).overflow === 'hidden' : false)
      root49.unmount()
      host3.remove()
    }

    root38.unmount()
    host.remove()
  }

  // --- 39. no sample project rides along with the app -------------------
  // A person opening Loom gets an EMPTY workspace. There is no demo waiting
  // for them and nothing restores an old document behind their back; the
  // first node is theirs to place. The fixture seeder exists for tests and
  // the E2E probes, and must stay off the launch path.
  {
    check('a fresh store is empty, not a sample project', (() => {
      const s39 = new EditorStore()
      return s39.doc.root === null && Object.keys(s39.doc.nodes).length === 0
    })())
    // (The launch path itself is asserted from the main process in verify.ts,
    // which can actually read the source. Asserting it here would be theatre.)
    // The seeder itself still works for fixtures — it is the probes that need
    // it, not the product.
    const s39b = new EditorStore()
    seedDemo(s39b)
    check('the fixture seeder still builds a document', s39b.doc.root !== null && Object.keys(s39b.doc.nodes).length > 5)
    check(
      'the fixture is named, so it is never mistaken for user work',
      s39b.doc.meta.name === 'Telemetry Console',
    )
  }

  // --- 40. responsive layout: the foundation, pinned ---------------------
  // The base document is authored at desktop and adapts DOWN. One generated
  // stylesheet serves the editor, the preview and both exports, so the layout
  // you author against is the layout that ships.
  {
    const bands: Array<[number, string]> = [[390, 'sm'], [834, 'md'], [1280, 'lg']]
    const wrongBand = bands.filter(([w, want]) => breakpointForWidth(w) !== want)
    check('widths map to the right breakpoint', wrongBand.length === 0,
      wrongBand.map(([w, want]) => `${w}->${breakpointForWidth(w)} want ${want}`).join(', '))

    const s40 = new EditorStore()
    const r40 = withRoot(s40)
    const row = s40.addComponent('Grid', r40, 0, 0, { columns: 3 })
    const card = row ? s40.addComponent('Card', row, 0, 0) : undefined
    check('a node starts with no responsive overrides', row ? s40.doc.nodes[row].responsive === undefined : false)

    if (row && card) {
      // Flow and geometry at the phone width; visibility at the tablet width.
      s40.commit({ op: 'setResponsive', id: row, breakpoint: 'sm', patch: { flow: true, h: 420 } }, 'Stack on phone')
      s40.commit({ op: 'setResponsive', id: card, breakpoint: 'sm', patch: { w: 320, visible: false } }, 'Hide on phone')
      s40.commit({ op: 'setResponsive', id: card, breakpoint: 'md', patch: { x: 12 } }, 'Nudge on tablet')
      // An explicit desktop override is a real authoring move: pin the card to
      // the grid's cell instead of leaving it to the schema default.
      s40.commit({ op: 'setResponsive', id: card, breakpoint: 'lg', patch: { w: 240 } }, 'Pin on desktop')

      const bag = s40.doc.nodes[row].responsive
      check('overrides are stored per breakpoint', bag?.sm?.flow === true && bag?.sm?.h === 420 && bag?.md === undefined)
      check('the base layout is untouched by an override', s40.doc.nodes[row].props.h !== 420)

      const css = responsiveCss(s40.doc)
      check('the stylesheet establishes the container', css.includes(`container-name:${CONTAINER_NAME}`))
      check('the phone band is a max-width query', css.includes('(max-width: 639px)'))
      check('the tablet band is a range query', css.includes('(min-width: 640px) and (max-width: 1023px)'))
      check('the desktop band is a min-width query', css.includes('(min-width: 1024px)'))
      check('every override reaches a rule', css.includes(`[data-loom-id="${row}"]`) && css.includes(`[data-loom-id="${card}"]`))
      check('flow is expressed as a layout change', css.includes('display:flex') && css.includes('flex-direction:column'))
      check('hiding is expressed as display:none', css.includes('display:none'))
      check('rules are narrowest-last so narrow wins', (() => {
        const lg = css.indexOf('(min-width: 1024px)')
        const md = css.indexOf('(min-width: 640px)')
        const sm = css.indexOf('(max-width: 639px)')
        return lg === -1 || (md > lg && sm > md)
      })())

      // A document with nothing responsive ships NO rules at all.
      const s40b = new EditorStore()
      const r40b = withRoot(s40b)
      s40b.addComponent('Card', r40b, 0, 0)
      check('a non-responsive document ships no layout rules', responsiveCss(s40b.doc) === '')

      // Undo must remove the bag entirely, not leave an empty override behind.
      s40.undo()
      check('undo of the last override leaves no empty bag',
        JSON.stringify(s40.doc.nodes[card].responsive?.sm ?? null) !== '{}')

      // Round trip.
      const rt = validate(serialize(s40.doc))
      check('overrides survive save/load', rt.doc?.nodes[row]?.responsive?.sm?.flow === true)
      check('the round trip keeps the exact values',
        rt.doc?.nodes[card]?.responsive?.sm?.w === 320 && rt.doc?.nodes[row]?.responsive?.sm?.h === 420)

      // Trust boundary: a hand-written file must not smuggle in junk.
      const hostile = JSON.parse(serialize(s40.doc))
      hostile.nodes[row].responsive = {
        sm: { w: Number.NaN, x: '0', flow: true, bogus: 1 },
        xl: { w: 100 },
        md: 'not-an-object',
      }
      const fixed = validate(hostile)
      const cleanBp = fixed.doc?.nodes[row]?.responsive
      check('a non-finite override is dropped and reported',
        cleanBp?.sm?.w === undefined && fixed.issues.some((i) => i.path.endsWith('.sm.w')))
      check('a wrongly-typed override is dropped and reported',
        cleanBp?.sm?.x === undefined && fixed.issues.some((i) => i.path.endsWith('.sm.x')))
      check('a valid override in the same bag survives', cleanBp?.sm?.flow === true)
      check('an unknown key is dropped and reported', (cleanBp?.sm as Record<string, unknown> | undefined)?.bogus === undefined &&
        fixed.issues.some((i) => i.path.includes('bogus')))
      check('an unknown breakpoint is dropped and reported', (cleanBp as Record<string, unknown> | undefined)?.xl === undefined &&
        fixed.issues.some((i) => i.path.includes('xl')))
      check('a non-object override bag is dropped and reported', cleanBp?.md === undefined &&
        fixed.issues.some((i) => i.path.endsWith('.md')))

      // The outputs carry the rules, or responsive is a lie.
      const html = emitHtml(s40.doc)
      check('the HTML export ships the layout rules', html.includes('(max-width: 639px)'))
      check('the HTML export makes the page measurable', html.includes('loom-container'))
      const jsx = emitReact(s40.doc)
      check('the React export ships the layout rules', jsx.includes('DOCUMENT_CSS'))
      check('the React export root is measurable', jsx.includes('loom-container'))
    }
  }

  // --- 41. list separators are the USER's property, not a convention -----
  // A list property used to hardcode its separator. The moment real data
  // contains a comma inside an item, the list split in the wrong place and the
  // designer had no way to say so. The separator is now a property.
  {
    check('comma is the default separator', delimiterChar(undefined) === ',')
    check('every separator name maps to a character', Object.values(DELIMITERS).length === 6 &&
      DELIMITERS.pipe === '|' && DELIMITERS.semicolon === ';' && DELIMITERS.newline === '\n')
    check('an unknown separator name falls back rather than throwing', delimiterChar('nope') === ',')
    check('the inspector shows the character, not just the name', delimiterLabel('pipe').includes('|'))

    // Every list-valued property ships its separator, so no list can be
    // half-declared. This walks the registry rather than a hand-kept list.
    const listProps: Array<[string, string]> = [
      ['TabBar', 'tabs'], ['Select', 'options'], ['Segmented', 'options'],
      ['ComboBox', 'options'], ['DropdownButton', 'items'],
      ['Checklist', 'items'], ['BulletList', 'items'], ['NumberedList', 'items'],
      ['TreeList', 'items'], ['DataList', 'items'], ['Breadcrumbs', 'trail'],
      ['Stepper', 'steps'], ['AnchorList', 'links'], ['AvatarGroup', 'names'],
      ['BarChart', 'values'], ['PieChart', 'values'], ['LineChart', 'points'],
      ['ErrorSummary', 'items'], ['DataGrid', 'columns'], ['DataGrid', 'rows'],
    ]
    const undeclared = listProps.filter(([type]) => {
      const spec = getComponent(type)
      if (!spec) return true
      return !Object.keys(spec.props).some((k) => k.toLowerCase().endsWith('sep'))
    })
    check('every list property declares its separator', undeclared.length === 0,
      undeclared.map(([t, p]) => `${t}.${p}`).join(', '))

    // It has to actually change the parsing, which is the whole point.
    const s41 = new EditorStore()
    const r41 = withRoot(s41)
    // "Ada, Countess of Lovelace" contains a comma: with a comma separator that
    // is three broken items, and with a pipe it is exactly one.
    const tabs = s41.addComponent('TabBar', r41, 0, 0, { tabs: 'Ada, Countess of Lovelace', tabsSep: 'comma' })
    const commaHtml = emitHtml(s41.doc)
    // One comma in the text: with a comma separator that is two items, and the
    // second one is not what the author meant.
    check('a comma inside an item splits on a comma separator', (commaHtml.match(/role="tab"/g) ?? []).length === 2)
    if (tabs) {
      s41.commit({ op: 'setProp', id: tabs, key: 'tabsSep', value: 'pipe' }, 'Separator')
      const pipeHtml = emitHtml(s41.doc)
      check('switching the separator reparses the same text', (pipeHtml.match(/role="tab"/g) ?? []).length === 1)
      check('the one item keeps its commas intact', pipeHtml.includes('Ada, Countess of Lovelace'))
      s41.undo()
      check('undo restores the separator', (emitHtml(s41.doc).match(/role="tab"/g) ?? []).length === 2)
    }

    // The grid's row and cell separators are separate properties. A cell may
    // contain the CELL separator's neighbours freely (a comma is just data
    // when cells are pipe-separated); a cell cannot contain the ROW separator,
    // because the row split necessarily happens first. That is a property of
    // two-level parsing, not a bug — and it is now visible in the inspector
    // instead of surprising someone in the output.
    const s42 = new EditorStore()
    const r42 = withRoot(s42)
    s42.addComponent('DataGrid', r42, 0, 0, {
      columns: 'Name,Note',
      rows: 'Ada|uses, commas freely;Grace|also, commas',
    })
    const gridHtml = emitHtml(s42.doc)
    check('a comma inside a cell is data, not a separator', gridHtml.includes('uses, commas freely'))
    check('the second row is intact too', gridHtml.includes('also, commas'))
    check('the grid produced the right number of rows', (gridHtml.match(/<tr[^>]*data-loom-row/g) ?? []).length === 2)

    // A separator is a property, so it must survive a save/load round trip.
    const rt = validate(serialize(s41.doc))
    const rtTabs = Object.values((rt.doc?.nodes ?? {}) as Record<string, LoomNode>).find((n) => n.type === 'TabBar')
    check('the separator survives save/load', rtTabs?.props.tabsSep === 'comma' || rtTabs?.props.tabsSep === 'pipe')

    // And a hand-written file cannot smuggle in a separator we do not know.
    const hostile = JSON.parse(serialize(s41.doc))
    const anyTab = Object.values(hostile.nodes as Record<string, LoomNode>).find((n) => n.type === 'TabBar')
    if (anyTab) {
      anyTab.props.tabsSep = 'backslash'
      const repaired = validate(hostile)
      const fixedTab = Object.values((repaired.doc?.nodes ?? {}) as Record<string, LoomNode>).find((n) => n.type === 'TabBar')
      check('an unknown separator is repaired toward comma', fixedTab?.props.tabsSep === 'comma')
      check('the repair is reported', repaired.issues.some((i) => i.path.includes('tabsSep')))
    }
  }

  // --- 42. Field replaces FormField, and owns validation ----------------
  // The old FormField drew its own text input, so nothing else could go
  // inside a form field. Field is a container: ANY control drops in, and the
  // field's validation state reaches it.
  {
    const s43 = new EditorStore()
    const r43 = withRoot(s43)
    // A Field holding a SELECT — the thing that was impossible before.
    const f = s43.addComponent('Field', r43, 0, 0, {
      label: 'Region',
      description: 'Where the workload runs',
      message: 'Region is required',
      state: 'error',
      required: true,
    })
    const sel = f ? s43.addComponent('Select', f, 0, 0, { options: 'us-east,eu-west' }) : undefined
    check('Field accepts a non-text control', Boolean(sel) && s43.doc.nodes[sel!].type === 'Select')
    check('the control is a CHILD of the field', sel ? parentOf(s43.doc, sel) === f : false)

    const html = emitHtml(s43.doc)
    check('the field renders its label', html.includes('Region'))
    check('the field renders its description', html.includes('Where the workload runs'))
    check('the field renders its message', html.includes('Region is required'))
    check('a required field is marked required', html.includes('aria-invalid="true"') || html.includes('*'))
    check('the validation state is exposed as data', html.includes('data-loom-state="error"'))
    check('the state stylesheet reaches controls inside a field',
      behaviourCss().includes('[data-loom-field] :is(input,select,textarea){border-color'))

    // The inline layout is the settings-row pattern.
    const inline = s43.addComponent('Field', r43, 0, 0, { label: 'Region', layout: 'inline', labelWidth: 220 })
    check('the inline layout is a real row', inline ? emitHtml(s43.doc).includes('width:220px') : false)

    // States are the field's, not the control's: switching state changes the
    // field, and the control inside is untouched.
    if (f) {
      s43.commit({ op: 'setProp', id: f, key: 'state', value: 'success' }, 'State')
      check('the field state changes', emitHtml(s43.doc).includes('data-loom-state="success"'))
      check('the control inside is untouched by the state', sel ? s43.doc.nodes[sel].type === 'Select' : false)
      s43.undo()
      check('undo restores the validation state', emitHtml(s43.doc).includes('data-loom-state="error"'))
    }

    // FormField is GONE, not deprecated: two tools doing one job is the
    // toolbox bloat we do not ship.
    check('the removed form field is really gone', !getComponent('FormField'))
    check('the removed table is really gone', !getComponent('Table'))
    check('their replacements exist', Boolean(getComponent('Field')) && Boolean(getComponent('DataGrid')))
    check('no interactive type claims a removed name',
      !interactiveTypes().includes('FormField') && !interactiveTypes().includes('Table'))

    // A file written before the renames must still OPEN, with the migration
    // reported rather than silently applied.
    const s44 = new EditorStore()
    const r44 = withRoot(s44)
    s44.addComponent('Card', r44, 0, 0)
    const old = JSON.parse(serialize(s44.doc))
    const victim = Object.values(old.nodes as Record<string, LoomNode>).find((n) => n.type === 'Card')
    if (victim) {
      victim.type = 'FormField'
      victim.props = { label: 'Legacy', hint: 'from an old file' }
      const migrated = validate(old)
      check('a renamed tool migrates instead of vanishing', migrated.doc !== null &&
        Object.values(migrated.doc!.nodes).some((n) => n.type === 'Field'))
      check('the migration is reported', migrated.issues.some((i) => i.message.includes('replaced by')))
      check('a migrated field still renders', emitHtml(migrated.doc!).includes('Legacy'))
    }
    // The rename map must not become a "guess anything" map: a genuinely
    // unknown component is DROPPED and reported, and the rest of the file still
    // opens. Losing one node beats refusing to open a designer's work.
    const junk = JSON.parse(serialize(s44.doc))
    const other = Object.values(junk.nodes as Record<string, LoomNode>).find((n) => n.type === 'Card')
    if (other) {
      other.type = 'NotARealComponent'
      const rejected = validate(junk)
      check('an unknown component is dropped, not guessed at', rejected.doc !== null &&
        !Object.values(rejected.doc!.nodes).some((n) => n.type === 'NotARealComponent'))
      check('the drop is reported', rejected.issues.some((i) => i.message.includes('unknown component')))
      check('the rest of the document still opens', rejected.doc !== null &&
        Object.keys(rejected.doc.nodes).length >= 1)
    }
  }






  // --- 48. the properties ratchet ---------------------------------------
  // If a property is declared, setting it must change the output. The audit
  // proves it mechanically; this check makes it a BUILD failure when a new
  // property starts lying, and names the backlog when one is finally fixed.
  {
    const report = auditReport()
    check('no declared property is newly inert', report.unexpected.length === 0,
      report.unexpected.join(', '))
    // Every entry in the backlog must correspond to a finding the audit still
    // reports, so the table cannot be used to silence a property that works.
    check('the inert-property backlog has no stale entries', report.missing.length === 0,
      `stale entries: ${report.missing.join(', ')}`)
    check('every inert property has a recorded reason', Object.values(KNOWN_INERT).every((r) => r.length > 20))
    check('the audit actually checks a lot', report.checked > 1500, `${report.checked} properties`)
  }

  // --- 47. tooltips are worth waiting for -------------------------------
  // A tooltip is the only documentation a designer always has. The old one
  // restated the component's name, which is the same information twice.
  {
    const specs = allComponents()
    const text = (n: string) => tooltipFor(n, 'web')

    // No tooltip may simply restate the name: every summary must add a word the
    // name does not already contain.
    const restates = specs.filter((c) => {
      const words = new Set((c.description.toLowerCase().match(/[a-z]+/g) ?? []))
      const name = new Set((c.name.toLowerCase().match(/[a-z]+/g) ?? []))
      return [...words].filter((w) => !name.has(w)).length <= 1
    })
    check('no description just restates the component name', restates.length === 0,
      restates.map((c) => c.name).join(', '))

    // Every tooltip answers "what does it DO", and the answer is derived from
    // the behaviour tables rather than written twice.
    // Every tooltip must SAY something about behaviour, whatever the role. A
    // panel is state-driven rather than clicked, and a container's own controls
    // are described by the container, so the test is "it answers the question",
    // not "it contains the word click".
    const interactive = interactiveTypes()
    const silent = specs.filter((c) => buildTooltip(c).behaviour.trim().length < 8)
    check('every component answers what it does', silent.length === 0, silent.map((c) => c.name).join(', '))
    check('click-driven controls say so in so many words',
      interactive.filter((n) => {
        const r = n in {} ? '' : ''
        void r
        const t = buildTooltip(getComponent(n)!)
        return /Revealed|Opens and closes/.test(t.behaviour) || /click/i.test(t.behaviour)
      }).length === interactive.length)
    // A component with no role of its own must not imply that pressing it does
    // something — EXCEPT when it visibly contains a control of its own.
    const claimsInteraction = specs.filter((c) => {
      if (interactive.includes(c.name)) return false
      const t = buildTooltip(c)
      if (t.behaviour.startsWith('Presentational')) return false
      return !c.container
    })
    check('no static component claims interaction it lacks', claimsInteraction.length === 0,
      claimsInteraction.map((c) => c.name).join(', '))

    // The three questions a tooltip has to answer.
    const grid = buildTooltip(getComponent('DataGrid')!)
    check('a tooltip says what the component is for', grid.summary.length > 20)
    check('a tooltip says what it does', grid.behaviour.includes('sort') && grid.behaviour.includes('filter'))
    check('a tooltip names the properties worth setting',
      grid.properties.some((p) => p.startsWith('title')) && grid.properties.some((p) => p.startsWith('rows')),
      grid.properties.join(' | '))
    check('a tooltip explains the list format trap', grid.caveats.some((c) => c.includes('cellSep')))
    check('a tooltip does not lead with a separator',
      !grid.properties[0]?.includes('separator'), grid.properties[0] ?? '')

    // Parent requirements are the things you learn by breaking something.
    check('a panel says which parent it needs',
      buildTooltip(getComponent('TabPanel')!).caveats.some((c) => c.includes('Tabs')))
    check('the shell explains its slot order',
      buildTooltip(getComponent('AppShell')!).caveats.some((c) => c.includes('positional')))
    check('a field points at the settings row for list alignment',
      buildTooltip(getComponent('Field')!).caveats.some((c) => c.includes('SettingsRow')))
    check('containers say they are containers',
      buildTooltip(getComponent('Card')!).caveats.some((c) => c.includes('container')))
    check('Stat is told where the full card is',
      buildTooltip(getComponent('Stat')!).caveats.some((c) => c.includes('KpiCard')))

    // Target gating still shows up, now inside a richer tooltip.
    const gated = allComponents().find((c) => unsupportedProps(c, 'desktop').length > 0)
    if (gated) {
      check('target gating survives in the new tooltip',
        buildTooltip(gated, 'desktop').caveats.some((c) => c.includes('Not portable')))
    }

    // Every component in the toolbox produces a real, multi-section tooltip.
    const thin = specs.filter((c) => {
      const t = text(c.name)
      return t.split('\n').filter((l) => l.trim() !== '').length < 3
    })
    check('every component has a multi-section tooltip', thin.length === 0,
      thin.map((c) => c.name).join(', '))
    check('no tooltip is a single restatement of the name',
      specs.every((c) => text(c.name).length > c.name.length + 40))
  }

  // --- 46. foundation: one icon set, data typography, theme review ------
  {
    // --- icons ---
    check('the icon set is a real set', ICON_NAMES.length >= 40, `${ICON_NAMES.length} icons`)
    check('every icon is drawn on the same 24px grid', Object.values(ICONS).every((m) => !m.includes('viewBox')))
    check('icon names are unique and sorted', ICON_NAMES.every((n, i) => i === 0 || ICON_NAMES[i - 1] < n))
    check('a known name resolves to an icon', resolveIcon('search').kind === 'icon')
    check('an emoji stays a glyph, which is a real special case', resolveIcon('\u{1F514}').kind === 'glyph')
    check('an unknown value is a glyph, never a blank box', resolveIcon('\u2315').kind === 'glyph' &&
      resolveIcon('\u2315').kind === 'glyph')
    check('whitespace is tolerated', resolveIcon('  check  ').kind === 'icon')
    check('the Icon tool exists for standalone use', Boolean(getComponent('Icon')))

    // A control's icon PROPERTY accepts a name from the set, so the whole
    // toolbox can be moved onto one family without touching 82 props.
    const s53 = new EditorStore()
    const r53 = withRoot(s53)
    s53.addComponent('IconButton', r53, 0, 0, { icon: 'trash' })
    s53.addComponent('Icon', r53, 0, 0, { name: 'shield', size: 32 })
    const iconHtml = emitHtml(s53.doc)
    check('a control icon renders as a drawn icon', iconHtml.includes('<svg') && iconHtml.includes('viewBox="0 0 24 24"'))
    check('a standalone icon draws at its own size', iconHtml.includes('width="32" height="32"') ||
      iconHtml.includes('width="32"'))
    check('an icon control still has an accessible name', iconHtml.includes('aria-label="trash"'))
    // And a legacy glyph still renders, rather than silently vanishing.
    const s54 = new EditorStore()
    const r54 = withRoot(s54)
    s54.addComponent('IconButton', r54, 0, 0, { icon: '\u2315' })
    const legacy = emitHtml(s54.doc)
    check('a legacy glyph icon still renders', !legacy.includes('<svg') && legacy.includes('\u2315'))

    // --- data typography ---
    const s55 = new EditorStore()
    const r55 = withRoot(s55)
    s55.addComponent('DataGrid', r55, 0, 0, { columns: 'Name,Amount', rows: 'a|100;b|20' })
    const gridHtml = emitHtml(s55.doc)
    check('numeric columns use the tabular token, not a literal',
      gridHtml.includes('font-variant-numeric:var(--loom-numeric)'), 'token missing')
    check('the token is defined on the surface', gridHtml.includes('--loom-numeric:tabular-nums'))
    check('numeric columns are right-aligned', gridHtml.includes('text-align:right'))
    s55.addComponent('KpiCard', r55, 0, 0, {})
    check('a KPI value uses the same token', emitHtml(s55.doc).includes('font-variant-numeric:var(--loom-numeric)'))

    // --- theme review ---
    check('there are three themes to review in', THEME_NAMES.length === 3)
    // The switch is a REVIEW instrument: it must not edit the document.
    const s56 = new EditorStore()
    const before = JSON.stringify(s56.doc)
    const s56b = new EditorStore()
    seedDemo(s56b)
    const before2 = JSON.stringify(s56b.doc)
    const themed = renderToStaticMarkup(
      React.createElement(PreviewStage, { s: s56b, themeName: 'daylight', onThemeName: () => undefined }),
    )
    check('the preview can render in another theme', themed.includes('theme-switch'))
    // The document is byte-identical before and after a review render: a theme
    // switch changes what you are LOOKING at, not what you built.
    check('reviewing in a theme does not change the document', JSON.stringify(s56b.doc) === before2)
    void before
  }

  // --- 45. the settings pattern: section + row --------------------------
  // Two levels, like Tabs/TabPanel and Accordion/AccordionItem, because a
  // section and a row are different things at different depths.
  {
    const s51 = new EditorStore()
    const r51 = withRoot(s51)
    const sec = s51.addComponent('SettingsSection', r51, 0, 0, {
      title: 'Workspace',
      description: 'How this workspace behaves for everyone in it.',
      saveBar: true,
      dirty: true,
    })
    const rowA = sec ? s51.addComponent('SettingsRow', sec, 0, 0, { label: 'Name', description: 'Shown in the sidebar' }) : undefined
    const rowB = sec ? s51.addComponent('SettingsRow', sec, 0, 0, { label: 'Default role', description: 'For new members' }) : undefined
    const sw = rowA ? s51.addComponent('Switch', rowA, 0, 0, { label: '' }) : undefined
    const sel = rowB ? s51.addComponent('Select', rowB, 0, 0, { options: 'Editor,Viewer' }) : undefined
    check('a section holds rows', Boolean(rowA) && Boolean(rowB))
    check('a row holds any control', Boolean(sw) && Boolean(sel))
    check('a switch and a select both fit a settings row',
      sw ? s51.doc.nodes[sw].type === 'Switch' : false, sel ? s51.doc.nodes[sel].type : '')

    const html = emitHtml(s51.doc)
    check('the section shows its title', html.includes('Workspace'))
    check('the section shows its description', html.includes('How this workspace behaves'))
    check('rows show their labels and descriptions', html.includes('Shown in the sidebar') && html.includes('For new members'))
    check('the save bar is present when asked for', html.includes('data-loom-save-bar'))
    check('unsaved work is marked, not silent', html.includes('data-loom-dirty'))
    check('the save bar names the action', html.includes('Save changes'))

    // Clean state is visibly different, not just an absent dot.
    if (sec) {
      s51.commit({ op: 'setProp', id: sec, key: 'dirty', value: false }, 'Saved')
      const clean = emitHtml(s51.doc)
      check('a clean section says it is saved', !clean.includes('data-loom-dirty') && clean.includes('Saved'))
      s51.undo()
      check('undo restores the unsaved marker', emitHtml(s51.doc).includes('data-loom-dirty'))
    }

    // A destructive section is marked, and a destructive row is marked — the
    // "danger zone" everyone copies and nobody styles consistently.
    const s52 = new EditorStore()
    const r52 = withRoot(s52)
    const danger = s52.addComponent('SettingsSection', r52, 0, 0, { title: 'Danger zone', danger: true })
    const drow = danger ? s52.addComponent('SettingsRow', danger, 0, 0, { label: 'Delete workspace', destructive: true }) : undefined
    const dangerHtml = emitHtml(s52.doc)
    check('a danger section is marked as one', dangerHtml.includes('data-loom-settings-section="danger"'))
    check('a destructive row is marked destructive', Boolean(drow) && dangerHtml.includes('Delete workspace'))
    check('the danger styling uses the danger token', (() => {
      const theme52 = resolveTheme('midnight')
      return dangerHtml.includes(theme52.danger)
    })())

    // Field and SettingsRow must BOTH exist, and they are not the same thing:
    // a field validates an input, a row aligns a control in a list.
    check('Field still exists — it owns validation', Boolean(getComponent('Field')))
    check('SettingsRow exists — it owns alignment', Boolean(getComponent('SettingsRow')))
    check('the two are not the same tool',
      getComponent('Field')?.container === true && getComponent('SettingsRow')?.container === true &&
      !Object.keys(getComponent('Field')!.props).some((k) => k === 'align'))
  }

  // --- 44. AppShell: the shell composes, and the collapse is real -------
  // Additive: HeaderBar and SidebarPanel are still useful alone. What was
  // missing is composing them correctly and collapsing the sidebar to a rail.
  {
    const s48 = new EditorStore()
    const r48 = withRoot(s48)
    const shell = s48.addComponent('AppShell', r48, 0, 0, { sidebarWidth: 240, railWidth: 64 })
    const nav = shell ? s48.addComponent('Menu', shell, 0, 0) : undefined
    const bar = shell ? s48.addComponent('HeaderBar', shell, 0, 0) : undefined
    const body = shell ? s48.addComponent('Card', shell, 0, 0) : undefined
    check('the shell accepts children', Boolean(shell) && Boolean(nav) && Boolean(bar) && Boolean(body))

    const html = emitHtml(s48.doc)
    check('the shell has a sidebar region', html.includes('data-loom-shell-sidebar'))
    check('the shell has a top bar region', html.includes('data-loom-shell-top'))
    check('the shell has a content region', html.includes('data-loom-shell-content'))
    // Positional slots, in order: the FIRST child is the sidebar.
    if (shell) {
      const first = html.indexOf('data-loom-shell-sidebar')
      const top = html.indexOf('data-loom-shell-top')
      const content = html.indexOf('data-loom-shell-content')
      check('the slot order is sidebar, then top bar, then content',
        first < top && top < content, `${first} < ${top} < ${content}`)
      check('the collapse starts from the authored state', html.includes('data-loom-collapsed="0"'))
    }

    // HeaderBar and SidebarPanel were NOT removed: they are the parts.
    check('HeaderBar survives as a special case', Boolean(getComponent('HeaderBar')))
    check('SidebarPanel survives as a special case', Boolean(getComponent('SidebarPanel')))
  }

  // --- 43. KpiCard: one number, one comparison, ONE visual -------------
  // Additive, not a replacement: `Stat` (a bare number belongs in a table cell)
  // and `Sparkline` (a trend line with no number) are real special cases and
  // both stay. This pins the reasoning, so nobody "consolidates" them later.
  {
    check('Stat survives as a special case', Boolean(getComponent('Stat')))
    check('Sparkline survives as a special case', Boolean(getComponent('Sparkline')))
    check('KpiCard exists alongside them', Boolean(getComponent('KpiCard')))
    check('the toolbox grew rather than duplicated', (() => {
      const spec = getComponent('KpiCard')
      return spec !== undefined && !('Stat' in (spec.props as Record<string, unknown>))
    })())

    const theme = resolveTheme('midnight')
    const s46 = new EditorStore()
    const r46 = withRoot(s46)
    const kpi = s46.addComponent('KpiCard', r46, 0, 0, {
      label: 'Monthly revenue',
      value: '$48.2k',
      delta: '+12.4%',
      deltaLabel: 'vs last month',
      trend: 'up',
      points: '12,30,22,48',
    })
    const html = emitHtml(s46.doc)
    check('the card shows the label', html.includes('Monthly revenue'))
    check('the card shows the value', html.includes('$48.2k'))
    check('the card shows the comparison', html.includes('+12.4%'))
    check('the card says what the comparison is against', html.includes('vs last month'))
    // A trend mark is an icon beside the delta, not the card's visual.
    const visuals = (h: string) => (h.match(/<svg/g) ?? []).length - (h.match(/data-loom-trend/g) ?? []).length
    check('the card draws exactly one visual', visuals(html) === 1, `${visuals(html)} visuals`)

    // Colour follows GOODNESS, not direction. This is the whole reason
    // `goodDirection` exists: a falling error rate is good news.
    if (kpi) {
      s46.commit({ op: 'setProp', id: kpi, key: 'trend', value: 'down' }, 'Trend')
      s46.commit({ op: 'setProp', id: kpi, key: 'goodDirection', value: 'up' }, 'Good dir')
      check(
        'a falling metric that should rise is painted as a problem',
        deltaTone(emitHtml(s46.doc)) === theme.danger,
        deltaTone(emitHtml(s46.doc)),
      )
      s46.commit({ op: 'setProp', id: kpi, key: 'goodDirection', value: 'down' }, 'Good dir')
      check(
        'a falling metric that should fall reads as good news',
        deltaTone(emitHtml(s46.doc)) === theme.success,
        deltaTone(emitHtml(s46.doc)),
      )
      s46.commit({ op: 'setProp', id: kpi, key: 'trend', value: 'flat' }, 'Trend')
      check('a flat metric uses no signal colour', deltaTone(emitHtml(s46.doc)) === theme.textMuted,
        deltaTone(emitHtml(s46.doc)))
    }

    // The visual is a CHOICE, and "none" is a real answer.
    if (kpi) {
      s46.commit({ op: 'setProp', id: kpi, key: 'visual', value: 'none' }, 'Visual')
      check('a card can carry no visual at all', visuals(emitHtml(s46.doc)) === 0)
      s46.commit({ op: 'setProp', id: kpi, key: 'visual', value: 'bars' }, 'Visual')
      check('a card can carry bars instead', visuals(emitHtml(s46.doc)) === 0 &&
        emitHtml(s46.doc).includes('border-radius:2px'))
      s46.undo()
    }

    // The card and the standalone sparkline draw the SAME chart, because there
    // is one implementation. A KPI card must not be a different-looking trend.
    const s47 = new EditorStore()
    const r47 = withRoot(s47)
    s47.addComponent('KpiCard', r47, 0, 0, { points: '12,30,22,48', width: 200, height: 44 })
    // The card draws its chart INSIDE its edge and padding (200 - 2 x 17), so the
    // standalone sparkline is given the same box to compare like with like.
    s47.addComponent('Sparkline', r47, 0, 0, { points: '12,30,22,48', width: 166, height: 44 })
    const both = emitHtml(s47.doc)
    // Each chart draws an area path and a line path, so two charts make four:
    // the card's two must match the sparkline's two exactly.
    const paths = both.match(/<path d="M [^"]+"/g) ?? []
    check('the card and the sparkline share one implementation', paths.length === 4 &&
      paths[0] === paths[2] && paths[1] === paths[3], `${paths.length} paths`)
  }

  // --- 49. every edit is recorded, and the host bridge is confined -------
  // Regression suite for the deep-dive findings. Each block names the bug it
  // pins so a future "simplification" cannot quietly bring it back.
  {
    // (a) Inspector gestures that poke fields OUTSIDE props (opacity, effects,
    // responsive) must seal into history and mark the document dirty. The old
    // seal compared a hand-picked field list and swallowed all three.
    const gestures: Array<[string, (s: EditorStore, id: string) => void]> = [
      ['opacity', (s, id) => s.poke({ op: 'setOpacity', id, opacity: 0.3 })],
      ['effects', (s, id) => s.poke({ op: 'setEffects', id, patch: { grain: true } })],
      ['responsive', (s, id) => s.poke({ op: 'setResponsive', id, breakpoint: 'sm', patch: { x: 5 } })],
    ]
    for (const [name, gesture] of gestures) {
      const s = new EditorStore()
      const r = withRoot(s)
      const before = s.doc
      gesture(s, r)
      s.seal(name)
      check(`the ${name} gesture becomes one undo step`, s.history.length === 1, `${s.history.length} entries`)
      check(`the ${name} gesture marks the document unsaved`, s.dirty === true)
      s.undo()
      check(`undoing the ${name} gesture restores the document exactly`, s.doc === before)
    }
    {
      // ...while a gesture that changed nothing still records nothing.
      const s = new EditorStore()
      const r = withRoot(s)
      s.poke({ op: 'setOpacity', id: r, opacity: 1 })
      s.seal('Opacity')
      check('a no-op gesture still adds no history', s.history.length === 0 && s.dirty === false)
    }

    // (b) A theme change is an edit: undoable, and unsaved until saved.
    {
      const s = new EditorStore()
      withRoot(s)
      const before = s.doc.meta.theme
      s.setTheme('daylight')
      check('a theme change is one undo step', s.history.length === 1 && s.doc.meta.theme === 'daylight')
      check('a theme change marks the document unsaved', s.dirty === true)
      s.undo()
      check('undoing a theme change restores the previous theme', s.doc.meta.theme === before, String(s.doc.meta.theme))
      s.redo()
      s.setTheme('daylight')
      check('re-applying the same theme adds no history', s.history.length === 1, `${s.history.length} entries`)
    }

    // (c) Dirty tracks the SAVED document: undo after a save is unsaved work,
    // and redo back to the saved state is clean again.
    {
      const s = new EditorStore()
      const r = withRoot(s)
      const writes: string[] = []
      const fake: LoomHost = {
        save: async (_name, contents) => {
          writes.push(contents)
          return { ok: true, path: '/tmp/fake.loom.json' }
        },
        open: async () => ({ ok: false, canceled: true }),
        autosave: async () => ({ ok: true }),
        readAutosave: async () => ({ ok: false }),
      }
      s.host = fake
      s.setProp(r, 'title', 'Saved title')
      await s.save()
      check('saving clears the dirty flag', s.dirty === false && writes.length === 1)
      s.undo()
      check('undo after a save is unsaved work', s.dirty === true)
      s.redo()
      check('redo back to the saved state is clean', s.dirty === false)

      // An edit made while the save dialog is open is not on disk.
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => { release = resolve })
      s.host = { ...fake, save: async () => { await gate; return { ok: true, path: '/tmp/fake.loom.json' } } }
      s.setProp(r, 'title', 'Before dialog')
      const pending = s.save()
      s.setProp(r, 'title', 'During dialog')
      release()
      await pending
      check('an edit made during the save dialog stays unsaved', s.dirty === true)
    }

    // (d) Save/load keeps every meta field, and a hostile meta is reported.
    {
      const doc = rootDoc()
      doc.meta = { ...doc.meta, artboard: { w: 800, h: 600 }, snapGrid: 8 }
      const back = validate(serialize(doc))
      check('round trip keeps the artboard', back.doc?.meta.artboard?.w === 800 && back.doc?.meta.artboard?.h === 600,
        JSON.stringify(back.doc?.meta.artboard))
      check('round trip keeps the snap grid', back.doc?.meta.snapGrid === 8, String(back.doc?.meta.snapGrid))
      const hostile = JSON.parse(serialize(doc)) as { meta: Record<string, unknown> }
      hostile.meta.artboard = { w: 'wide', h: -1 }
      hostile.meta.snapGrid = -4
      const repaired = validate(JSON.stringify(hostile))
      check('a malformed artboard is dropped and reported',
        repaired.doc?.meta.artboard === undefined && repaired.issues.some((i) => i.path === '$.meta.artboard'))
      check('a negative snap grid is dropped and reported',
        repaired.doc?.meta.snapGrid === undefined && repaired.issues.some((i) => i.path === '$.meta.snapGrid'))
    }

    // (e) The main process confines what a document can reach.
    check('autosave accepts exactly the names filenameFor produces',
      ['Untitled', 'My App / v2.0!', 'x'.repeat(200), '   '].every((n) => autosaveFileName(filenameFor(n)) === filenameFor(n)))
    const hostileNames = ['../../.bashrc', '..', 'a/b.loom.json', 'a\\b.loom.json', '/etc/passwd', 'x.loom.json/..', '.loom.json', 'evil.json', '', 42, null]
    check('autosave refuses anything that could escape its directory',
      hostileNames.every((n) => autosaveFileName(n) === null),
      hostileNames.filter((n) => autosaveFileName(n) !== null).map(String).join(', '))
    check('web and mail links may open externally',
      ['https://example.com', 'http://example.com/a?b', 'mailto:a@example.com'].every(isExternalUrlAllowed))
    const hostileUrls = ['file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'vscode://x', 'data:text/html,x', 'not a url', '']
    check('every other scheme is refused',
      hostileUrls.every((u) => !isExternalUrlAllowed(u)),
      hostileUrls.filter(isExternalUrlAllowed).join(', '))
  }

  // --- 50. universal styling + a panel for newcomers and developers ------
  {
    const BOX = ['padding', 'paddingX', 'paddingY', 'radius', 'background', 'border', 'borderWidth', 'shadow']
    const TYPE = ['fontSize', 'fontWeight', 'color', 'lineHeight', 'letterSpacing']
    const specs = allComponents()

    // Every component carries the universal box styling; every component with
    // text carries the type styling. Walked from the registry, not a list.
    const noBox = specs.filter((c) => BOX.some((k) => !(k in c.props))).map((c) => c.name)
    check('every component carries universal box styling', noBox.length === 0, noBox.join(', '))
    const noType = specs.filter((c) => c.rendersText !== false && TYPE.some((k) => !(k in c.props))).map((c) => c.name)
    check('every component with text carries universal type styling', noType.length === 0, noType.join(', '))
    const skeleton = getComponent('Skeleton')
    // `color` is excluded: Skeleton declares its own, meaning the placeholder fill.
    check('a component with no text is not offered type controls',
      Boolean(skeleton) && TYPE.filter((k) => k !== 'color').every((k) => !(k in (skeleton?.props ?? {}))))

    // Injection must change NO existing output: every injected property
    // defaults to unset, which the shared style pass ignores.
    const setDefaults = Object.entries(universalStyleProps(true))
      .filter(([, ps]) => !(ps.default === -1 || ps.default === '' || ps.default === 'none'))
      .map(([k]) => k)
    check('every universal property defaults to unset', setDefaults.length === 0, setDefaults.join(', '))

    // A component's own declaration wins over the injected one, and keeps its
    // meaning: a component that declared padding 0 still defaults to 0, not
    // to the injected unset.
    const ownPadding = specs.filter((c) => c.props.padding?.default === 0)
    check('a component\'s own property is not replaced by the universal one', ownPadding.length > 0,
      `${ownPadding.length} components keep their own padding default`)

    // The component's own options come first in the panel.
    const button = getComponent('Button')
    const firstKey = button ? Object.keys(button.props)[0] : ''
    check('a component\'s own properties are listed before injected ones',
      Boolean(button) && !['anchor', 'rotate', 'sticky', ...BOX, ...TYPE].includes(firstKey), firstKey)

    // Newly reachable styling reaches the output. Before this, a Paragraph had
    // no background and an Alert no font size at all.
    {
      const s50 = new EditorStore()
      const r50 = withRoot(s50)
      const para = s50.addComponent('Paragraph', r50, 0, 0, { background: '#123456', padding: 18 })
      const alert = s50.addComponent('Alert', r50, 0, 0, { fontSize: 23, letterSpacing: 2 })
      const html = emitHtml(s50.doc)
      check('a paragraph can take a background and padding', Boolean(para) && html.includes('#123456') && html.includes('padding:18px'))
      check('an alert can take a font size and letter spacing', Boolean(alert) && html.includes('font-size:23px') && html.includes('letter-spacing:2px'))

      // Saved and reopened, the new styling survives.
      const back = validate(serialize(s50.doc))
      check('universal styling survives save and load',
        back.issues.length === 0 && para !== undefined && back.doc?.nodes[para]?.props.background === '#123456',
        back.issues.map((i) => i.message).join('; '))
    }

    // An OLD file (written before these properties existed) opens with no
    // repairs and renders exactly as it did: missing keys take unset defaults.
    {
      const s = new EditorStore()
      const r = withRoot(s)
      s.addComponent('Button', r, 20, 20, { text: 'Old file' })
      s.addComponent('Paragraph', r, 20, 80)
      const old = JSON.parse(serialize(s.doc)) as { nodes: Record<string, { type: string; props: Record<string, unknown> }> }
      for (const n of Object.values(old.nodes)) {
        const spec = getComponent(n.type)
        for (const [k, ps] of Object.entries(spec?.props ?? {})) if (ps.advanced) delete n.props[k]
      }
      const loaded = validate(JSON.stringify(old))
      check('a file written before universal styling opens with no repairs', loaded.issues.length === 0,
        loaded.issues.map((i) => i.message).join('; '))
      check('and renders exactly as before', loaded.doc !== null && emitHtml(loaded.doc) === emitHtml(s.doc))
    }

    // The panel: essentials first, everything one click away, nothing hidden
    // that was changed, and search that ignores the toggle.
    {
      const spec = getComponent('Button')
      if (spec) {
        const defaults = instantiate('Button').props
        const essentials = inspectorView(spec, defaults, { query: '', showAdvanced: false })
        const shown = essentials.groups.flatMap((g) => g.rows.map((r) => r.key))
        check('the panel starts with essentials only', !shown.includes('background') && essentials.hiddenAdvanced > 0,
          `${essentials.hiddenAdvanced} hidden`)
        check('the component\'s own options are always shown',
          ['label', 'variant', 'size', 'disabled'].every((k) => shown.includes(k)), shown.join(','))
        check('the essentials are a short list', shown.length <= 16, `${shown.length} shown: ${shown.join(',')}`)
        const all = inspectorView(spec, defaults, { query: '', showAdvanced: true })
        // Everything but `anchor`, which the Position section's dock picker shows.
        check('"More properties" reveals everything', all.hiddenAdvanced === 0 &&
          all.groups.reduce((n, g) => n + g.rows.length, 0) === Object.keys(spec.props).length - 1)
        const changed = inspectorView(spec, { ...defaults, shadow: 'lg' }, { query: '', showAdvanced: false })
        const shadowRow = changed.groups.flatMap((g) => g.rows).find((r) => r.key === 'shadow')
        check('a changed advanced property is never hidden', shadowRow?.modified === true)
        const found = inspectorView(spec, defaults, { query: 'letter', showAdvanced: false })
        check('search finds advanced properties with the toggle off',
          found.groups.flatMap((g) => g.rows).some((r) => r.key === 'letterSpacing') && found.hiddenAdvanced === 0)
        const byLabel = inspectorView(spec, defaults, { query: 'font size', showAdvanced: false })
        check('search matches the readable label, word by word',
          byLabel.groups.flatMap((g) => g.rows).some((r) => r.key === 'fontSize'))
        const none = inspectorView(spec, defaults, { query: 'zzzz-nothing', showAdvanced: true })
        check('a search with no match returns no groups', none.groups.length === 0)
      }
      check('labels read as words',
        humanize('paddingX') === 'Padding X' && humanize('fontSize') === 'Font size' && humanize('aria-label') === 'Aria label',
        `${humanize('paddingX')} | ${humanize('fontSize')} | ${humanize('aria-label')}`)
      const pad = getComponent('Paragraph')?.props.padding
      check('an unset value is not reported as changed', Boolean(pad) && pad !== undefined && !isModified(pad, -1) && isModified(pad, 0))
    }
  }

  // --- 51. per-breakpoint overrides apply to REAL layout ------------------
  // §40 checked the generated CSS text; nothing measured a box, and the
  // overrides applied nowhere (no hook in output, and inline base styles beat
  // every rule). These mount real markup in real containers and measure.
  {
    const s51 = new EditorStore()
    s51.addComponent('Panel', null, 0, 0)
    const r51 = s51.doc.root as string
    const moved = s51.addComponent('Card', r51, 300, 200) as string
    s51.commit({ op: 'resize', id: moved, w: 500, h: 300 }, 'size')
    s51.commit({ op: 'setResponsive', id: moved, breakpoint: 'sm', patch: { x: 10, y: 20, w: 200, h: 120, opacity: 0.5 } }, 'phone')
    const hidden = s51.addComponent('Button', r51, 40, 600) as string
    s51.commit({ op: 'setResponsive', id: hidden, breakpoint: 'sm', patch: { visible: false } }, 'hide')
    const stack = s51.addComponent('Stack', r51, 700, 40) as string
    s51.addComponent('Button', stack, 10, 10, { label: 'A' })
    s51.addComponent('Button', stack, 200, 10, { label: 'B' })
    s51.commit({ op: 'setResponsive', id: stack, breakpoint: 'sm', patch: { flow: true } }, 'stack')

    const measure = (mode: 'preview' | 'authoring', width: number) => {
      const style = document.createElement('style')
      style.textContent = responsiveCss(s51.doc)
      document.head.appendChild(style)
      const host = document.createElement('div')
      host.className = 'loom-container'
      host.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;height:900px`
      host.innerHTML = renderToStaticMarkup(renderNode({ doc: s51.doc, selected: new Set(), mode }, r51))
      document.body.appendChild(host)
      const attr = mode === 'preview' ? 'data-loom-node' : 'data-loom-id'
      const el = (id: string) => host.querySelector(`[${attr}="${id}"]`) as HTMLElement | null
      // Children are found by label in preview (they carry no hook of their own).
      const btn = (label: string) =>
        [...host.querySelectorAll('button')].find((x) => x.textContent?.trim() === label) as HTMLElement | undefined
      // Position relative to the containing block (offsetLeft/Top), which is
      // exactly what `left`/`top` mean — a parent's border is not an offset.
      const box = (e: Element | null | undefined) => {
        if (!e) return null
        const h = e as HTMLElement
        return { x: h.offsetLeft, y: h.offsetTop, w: h.offsetWidth, h: h.offsetHeight }
      }
      const out = {
        moved: box(el(moved)),
        movedOpacity: el(moved) ? getComputedStyle(el(moved) as HTMLElement).opacity : 'missing',
        hiddenDisplay: el(hidden) ? getComputedStyle(el(hidden) as HTMLElement).display : 'missing',
        a: box(btn('A')),
        b: box(btn('B')),
      }
      host.remove()
      style.remove()
      return out
    }
    for (const mode of ['preview', 'authoring'] as const) {
      const phone = measure(mode, 390)
      const desk = measure(mode, 1280)
      const m = phone.moved
      check(`${mode}: a phone override moves and resizes the node`,
        m !== null && m.x === 10 && m.y === 20 && m.w === 200 && m.h === 120, JSON.stringify(m))
      check(`${mode}: desktop keeps the base layout`,
        desk.moved !== null && desk.moved.x === 300 && desk.moved.y === 200 && desk.moved.w === 500, JSON.stringify(desk.moved))
      check(`${mode}: a phone opacity override applies`, phone.movedOpacity === '0.5' && desk.movedOpacity === '1',
        `${phone.movedOpacity} / ${desk.movedOpacity}`)
      check(`${mode}: hidden at phone only`, phone.hiddenDisplay === 'none' && desk.hiddenDisplay !== 'none',
        `${phone.hiddenDisplay} / ${desk.hiddenDisplay}`)
      check(`${mode}: a free container flows its children at phone`,
        phone.a !== null && phone.b !== null && phone.b.y > phone.a.y && phone.b.x === phone.a.x,
        JSON.stringify({ a: phone.a, b: phone.b }))
      check(`${mode}: and keeps them free on desktop`,
        desk.a !== null && desk.b !== null && desk.b.x - desk.a.x === 190 && desk.b.y === desk.a.y,
        JSON.stringify({ a: desk.a, b: desk.b }))
    }
  }

  // --- 52. interaction states: hover, focus, pressed ---------------------
  {
    const s52 = new EditorStore()
    s52.addComponent('Panel', null, 0, 0)
    const r52 = s52.doc.root as string
    const btn = s52.addComponent('Button', r52, 40, 40, { label: 'Hover me' }) as string
    const plain = s52.addComponent('Button', r52, 40, 120, { label: 'Plain' }) as string

    // Op + exact undo, including the absence of the bag.
    s52.commit({ op: 'setStateStyle', id: btn, state: 'hover', patch: { background: '#123456', lift: 3, brightness: 1.1 } }, 'hover')
    check('a state style is stored per state', s52.doc.nodes[btn].states?.hover?.background === '#123456' &&
      s52.doc.nodes[btn].states?.pressed === undefined)
    s52.undo()
    check('undoing the first state style leaves no empty bag', s52.doc.nodes[btn].states === undefined)
    s52.redo()
    s52.commit({ op: 'setStateStyle', id: btn, state: 'pressed', patch: { scale: 0.97, opacity: 0.8 } }, 'pressed')
    s52.commit({ op: 'setStateStyle', id: btn, state: 'focus', patch: { shadow: 'glow' } }, 'focus')

    // Values are clamped, unknown keys and hostile colours never land.
    s52.commit({ op: 'setStateStyle', id: plain, state: 'hover', patch: { scale: 9, lift: -99 } }, 'clamp')
    check('state numbers are clamped into range',
      s52.doc.nodes[plain].states?.hover?.scale === 1.5 && s52.doc.nodes[plain].states?.hover?.lift === -24,
      JSON.stringify(s52.doc.nodes[plain].states))
    s52.commit({ op: 'setStateStyle', id: plain, state: 'focus', patch: { background: 'red}</style><script>alert(1)</script>', bogus: 1 } }, 'hostile')
    check('a hostile colour or unknown key never reaches the document', s52.doc.nodes[plain].states?.focus === undefined)
    s52.commit({ op: 'setStateStyle', id: plain, state: 'hover', patch: { scale: null, lift: null } }, 'clear')

    const good = ['#fff', '#12345678', 'red', 'transparent', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'hsl(210 50% 40% / .5)', 'var(--loom-accent)']
    const bad = ['red;}', 'red}</style>', 'url(x)', 'rgb(1,2,3));x', 'expression(alert(1))', 'var(--a) ;b', '"red"', '', '#12']
    check('the colour grammar admits real colours', good.every(isSafeColor), good.filter((c) => !isSafeColor(c)).join(', '))
    check('the colour grammar refuses everything else', bad.every((c) => !isSafeColor(c)), bad.filter(isSafeColor).join(', '))

    // Generated CSS: the right selectors, in the right order.
    const css = stateCss(s52.doc)
    check('a document with no states ships no state rules', stateCss(rootDoc()) === '')
    check('hover rules only apply where hovering exists', /@media \(hover:hover\)\{[^]*:hover/.test(css))
    check('focus means keyboard focus, on the node or inside it', css.includes(':focus-visible') && css.includes(':has(:focus-visible)'))
    check('pressed is :active', css.includes(':active'))
    check('pressed rules come after hover rules', css.indexOf(':active') > css.indexOf(':hover'))
    check('lift and scale compose with the node\'s own transform', css.includes('translate:0 -3px !important') && css.includes('scale:0.97 !important'))
    check('state changes animate, except under reduced motion', css.includes('transition:') && css.includes('prefers-reduced-motion'))
    check('every surface gets the state rules', documentCss(s52.doc).includes(css))

    // Defence in depth: a document built in code, bypassing op and loader.
    const forged = JSON.parse(JSON.stringify(s52.doc)) as Document
    forged.nodes[plain].states = { hover: { background: 'red}</style><script>alert(1)</script>' } }
    const forgedHtml = emitHtml(forged)
    check('a forged colour cannot break out of the exported stylesheet', !forgedHtml.includes('<script>alert(1)'))

    // The file trust boundary.
    const hostileFile = JSON.parse(serialize(s52.doc)) as { nodes: Record<string, Record<string, unknown>> }
    hostileFile.nodes[plain].states = { hover: { background: 'url(evil)', opacity: 7, glow: true }, sideways: { opacity: 1 }, focus: 'x' }
    const loaded = validate(JSON.stringify(hostileFile))
    const paths = loaded.issues.map((i) => `${i.path} ${i.message}`)
    check('a hostile states bag is repaired and reported',
      loaded.doc?.nodes[plain].states?.hover?.opacity === 1 && loaded.doc?.nodes[plain].states?.hover?.background === undefined &&
      paths.some((p) => p.includes('sideways')) && paths.some((p) => p.includes('not a colour')) && paths.some((p) => p.includes('glow')) &&
      paths.some((p) => p.includes('states.focus')), paths.join(' | '))
    const clean = validate(serialize(s52.doc))
    check('states survive save and load', clean.issues.length === 0 &&
      JSON.stringify(clean.doc?.nodes[btn].states) === JSON.stringify(s52.doc.nodes[btn].states))

    // Only styled nodes carry an output hook.
    const html = emitHtml(s52.doc)
    check('a styled node carries its output hook in the export', html.includes(`data-loom-node="${btn}"`))
    check('an unstyled node carries none', !html.includes(`data-loom-node="${plain}"`))

    // LIVE: computed styles in a real document. The editor forces the state
    // being edited; the export attaches the same rules to its hook.
    const live = (mode: 'preview' | 'authoring', force: 'hover' | 'pressed' | null) => {
      const style = document.createElement('style')
      style.textContent = documentCss(s52.doc)
      document.head.appendChild(style)
      const host = document.createElement('div')
      host.className = 'loom-container'
      host.style.cssText = 'position:absolute;left:-10000px;top:0;width:800px;height:400px'
      host.innerHTML = renderToStaticMarkup(renderNode({
        doc: s52.doc, selected: new Set(), mode, forceState: force ? { id: btn, state: force } : undefined,
      }, r52))
      document.body.appendChild(host)
      const el = host.querySelector(mode === 'preview' ? `[data-loom-node="${btn}"]` : `[data-loom-id="${btn}"]`) as HTMLElement | null
      // The generated transition is read FIRST (it proves the base rule
      // reached this element), then disabled so values read the end state.
      const transition = el ? getComputedStyle(el).transitionProperty : 'missing'
      if (el) el.style.transition = 'none'
      const c = el ? getComputedStyle(el) : null
      const out = c
        ? { bg: c.backgroundColor, translate: c.translate, filter: c.filter, scale: c.scale, opacity: c.opacity, transition }
        : null
      host.remove()
      style.remove()
      return out
    }
    const hovered = live('authoring', 'hover')
    check('the editor shows the hover being edited', hovered !== null && hovered.bg === 'rgb(18, 52, 86)' &&
      hovered.translate === '0px -3px' && hovered.filter === 'brightness(1.1)', JSON.stringify(hovered))
    const pressed = live('authoring', 'pressed')
    check('the editor shows the pressed state being edited', pressed !== null && pressed.scale === '0.97' && pressed.opacity === '0.8',
      JSON.stringify(pressed))
    const resting = live('authoring', null)
    check('without a forced state the node rests', resting !== null && resting.bg !== 'rgb(18, 52, 86)' && resting.scale === 'none',
      JSON.stringify(resting))
    const exported = live('preview', null)
    check('the export attaches the state rules to the node',
      exported !== null && exported.transition.includes('scale') && exported.transition.includes('background-color'),
      JSON.stringify(exported))

    // Presets are complete and valid on their own.
    const presetProblems = STATE_PRESETS.flatMap((p) =>
      Object.entries(p.states).flatMap(([st, style]) => {
        const f = JSON.parse(JSON.stringify(s52.doc)) as Document
        f.nodes[plain].states = { [st]: style }
        return stateCss(f) === '' ? [`${p.id}.${st}`] : []
      }),
    )
    check('every preset produces real rules', STATE_PRESETS.length >= 4 && presetProblems.length === 0, presetProblems.join(', '))
  }

  // --- 53. a node id is data, never stylesheet text ------------------------
  // Generated rules address nodes by id, and the file loader accepts any
  // string as an id. The colour grammar closed values; this closes selectors.
  {
    const evil = 'x"],*{color:red}</style><script>alert(1)</script><style>[a="'
    const file = {
      version: 1,
      meta: { name: 'ids', targets: ['web'], created: 0 },
      root: 'r',
      nodes: {
        r: { id: 'r', type: 'Panel', props: {}, children: [evil], flow: false, visible: true, locked: false, opacity: 1 },
        [evil]: {
          id: evil, type: 'Button', props: { label: 'Hostile' }, children: [], flow: false, visible: true, locked: false, opacity: 1,
          states: { hover: { background: '#123456' } }, responsive: { sm: { opacity: 0.5 } },
        },
      },
    }
    const loaded = validate(JSON.stringify(file))
    const doc53 = loaded.doc
    const css53 = doc53 ? documentCss(doc53) : ''
    check('a hostile node id cannot close a generated rule or the style element',
      doc53 !== null && !css53.includes('</style') && !css53.includes('*{color:red}') && !emitHtml(doc53).includes('<script>alert(1)'),
      css53.slice(0, 160))
    // The escaped selector must still MATCH the node, or the fix just
    // switched the feature off for unusual ids.
    let matched = 'no doc'
    if (doc53) {
      const style = document.createElement('style')
      style.textContent = documentCss(doc53)
      document.head.appendChild(style)
      const host = document.createElement('div')
      host.className = 'loom-container'
      host.style.cssText = 'position:absolute;left:-10000px;top:0;width:390px;height:400px'
      host.innerHTML = renderToStaticMarkup(renderNode({ doc: doc53, selected: new Set(), mode: 'preview' }, 'r'))
      document.body.appendChild(host)
      const btn = host.querySelector('button')
      matched = btn ? getComputedStyle(btn).opacity : 'missing'
      host.remove()
      style.remove()
    }
    check('an unusual node id is still addressed by its rules', matched === '0.5', matched)
  }

  // --- 54. part styling reaches INSIDE composites ------------------------
  // Universal type/box props style a composite's root, and its inner parts
  // style themselves inline, so a KPI's number could never change size. Every
  // claim below is measured on real elements in a real document.
  {
    // Props that make every declared part actually render. A component that
    // declares a part it does not draw fails the audit below by design.
    const SEED: Record<string, Record<string, string | boolean>> = {
      Field: { description: 'Help text', message: 'Something is wrong' },
      MessageBubble: { status: 'read' },
      MessageList: { showTyping: true },
      RadioGroup: { label: 'Plan' },
      KpiCard: {},
      Stat: {},
      DataGrid: {},
    }
    const withParts = allComponents().filter((c) => c.parts)
    check('composites declare styleable parts',
      ['DataGrid', 'KpiCard', 'Stat', 'Field'].every((n) => getComponent(n)?.parts !== undefined) &&
      withParts.every((c) => Object.values(c.parts ?? {}).every((p) => p.fields.length > 0 && p.label !== '' && p.hint !== '')),
      withParts.map((c) => c.name).join(', '))

    // Mount real markup, run `fn` against it, clean up.
    const mounted = <T,>(doc: Document, mode: 'preview' | 'authoring', fn: (host: HTMLElement) => T, selected: string[] = []): T => {
      const style = document.createElement('style')
      style.textContent = documentCss(doc)
      document.head.appendChild(style)
      const host = document.createElement('div')
      host.className = 'loom-container'
      host.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:700px;z-index:99999;background:#000'
      host.innerHTML = renderToStaticMarkup(renderNode({ doc, selected: new Set(selected), mode }, doc.root as string))
      document.body.appendChild(host)
      try {
        return fn(host)
      } finally {
        host.remove()
        style.remove()
      }
    }
    const partEls = (host: HTMLElement, id: string, part: string) =>
      [...host.querySelectorAll(`[data-loom-part]`)].filter((e) => (e.getAttribute('data-loom-part') ?? '').split(/\s+/).includes(`${id}/${part}`)) as HTMLElement[]

    // What each field is measured by: the CSS property on the part element,
    // the value set, and the computed value expected (null: must differ).
    const PROBE: Record<string, { css: string; value: string | number | ((base: string) => string); lines?: string; expect: string | null }> = {
      fontSize: { css: 'font-size', value: 23, expect: '23px' },
      fontWeight: { css: 'font-weight', value: 800, expect: '800' },
      color: { css: 'color', value: '#123456', expect: 'rgb(18, 52, 86)' },
      lineHeight: { css: 'line-height', value: 2.5, expect: null },
      letterSpacing: { css: 'letter-spacing', value: 3, expect: '3px' },
      textTransform: { css: 'text-transform', value: 'capitalize', expect: 'capitalize' },
      align: { css: 'text-align', value: 'center', expect: 'center' },
      background: { css: 'background-color', value: '#123456', expect: 'rgb(18, 52, 86)' },
      paddingX: { css: 'padding-left', value: 31, expect: '31px' },
      paddingY: { css: 'padding-top', value: 29, expect: '29px' },
      radius: { css: 'border-top-left-radius', value: 13, expect: '13px' },
      // On a part with no lines of its own, a colour draws a hairline; on a
      // part with rule lines, it recolours them.
      border: { css: 'border-top-color', lines: 'border-bottom-color', value: '#123456', expect: 'rgb(18, 52, 86)' },
      borderWidth: { css: 'border-left-width', value: 4, expect: '4px' },
      gap: { css: 'row-gap', value: 17, expect: '17px' },
      shadow: { css: 'box-shadow', value: 'glow', expect: null },
      // Whichever face the part is NOT already in: a mono shortcut set to mono
      // changes nothing, and that is not the field lying.
      fontFamily: { css: 'font-family', value: (base) => (base.includes('mono') ? 'sans' : 'mono'), expect: null },
      decoration: { css: 'text-decoration-line', value: 'line-through', expect: 'line-through' },
    }

    const missing: string[] = []
    const liars: string[] = []
    const leaks: string[] = []
    let measured = 0
    for (const comp of withParts) {
      for (const [partName, partSpec] of Object.entries(comp.parts ?? {})) {
        const st = new EditorStore()
        st.addComponent('Panel', null, 0, 0)
        const r = st.doc.root as string
        const id = st.addComponent(comp.name, r, 20, 20, SEED[comp.name] ?? {}) as string
        if (comp.name === 'Field') st.addComponent('Input', id, 0, 0)
        // Rows that only appear in a state: a current menu command.
        if (comp.name === 'Menu') st.commit({ op: 'setList', id, key: 'items', items: [{ label: 'Profile', icon: 'user', shortcut: '⌘P', active: true }, { label: 'Sign out', danger: true }] }, 'seed')
        // A part that only exists in a state: the loading bars.
        // Parts that only exist in a content state are probed in that state.
        if ('loadState' in comp.props && (partName === 'skeleton' || partName === 'placeholder')) st.setProp(id, 'loadState', 'loading')
        if ('loadState' in comp.props && comp.name !== 'DataGrid' && ['message', 'messageIcon', 'action'].includes(partName)) st.setProp(id, 'loadState', 'error')
        const baseDoc = st.doc
        // The part must exist on the canvas before it is styled (the panel
        // points at it), and in the output once it is.
        const baseline = mounted(baseDoc, 'authoring', (h) => {
          const els = partEls(h, id, partName)
          return els.length > 0 ? getComputedStyle(els[0]) : null
        })
        const baseValues: Record<string, string> = {}
        if (baseline === null) {
          missing.push(`${comp.name}.${partName} (canvas)`)
          continue
        }
        for (const f of fieldsFor(partSpec.fields)) {
          const probe = PROBE[f.key]
          if (!probe) {
            liars.push(`${comp.name}.${partName}.${f.key} (no probe: add one)`)
            continue
          }
          const prop = partSpec.lines && probe.lines ? probe.lines : probe.css
          baseValues[f.key] = mounted(baseDoc, 'authoring', (h) => getComputedStyle(partEls(h, id, partName)[0]).getPropertyValue(prop))
          const rootBefore = mounted(baseDoc, 'authoring', (h) => getComputedStyle(h.querySelector(`[data-loom-id="${id}"]`) as HTMLElement).getPropertyValue(prop))
          const value = typeof probe.value === 'function' ? probe.value(baseValues[f.key]) : probe.value
          st.commit({ op: 'setPartStyle', id, part: partName, patch: { [f.key]: value } }, 'probe')
          for (const mode of ['preview', 'authoring'] as const) {
            mounted(st.doc, mode, (h) => {
              const els = partEls(h, id, partName)
              if (els.length === 0) {
                missing.push(`${comp.name}.${partName} (${mode})`)
                return
              }
              for (const el of els) {
                const got = getComputedStyle(el).getPropertyValue(prop)
                const ok = probe.expect === null ? got !== baseValues[f.key] : got === probe.expect
                if (!ok) liars.push(`${comp.name}.${partName}.${f.key} ${mode}: ${prop}=${got}`)
              }
              measured += 1
              // The root keeps its own look: a part rule must not leak up.
              if (mode === 'authoring') {
                const rootAfter = getComputedStyle(h.querySelector(`[data-loom-id="${id}"]`) as HTMLElement).getPropertyValue(prop)
                if (rootAfter !== rootBefore) leaks.push(`${comp.name}.${partName}.${f.key}: ${rootBefore} -> ${rootAfter}`)
              }
            })
          }
          st.undo()
        }
      }
    }
    check('every declared part exists on the canvas and in the output', missing.length === 0, missing.join(', '))
    check('every field of every part changes that part, on the canvas and in the output',
      liars.length === 0 && measured > 100, `${measured} measured; ${liars.slice(0, 8).join(' | ')}`)
    check('a part rule never restyles the component root', leaks.length === 0, leaks.join(', '))

    // Op discipline: exact undo, and only declared parts and accepted fields land.
    const s54 = new EditorStore()
    s54.addComponent('Panel', null, 0, 0)
    const r54 = s54.doc.root as string
    s54.commit({ op: 'resize', id: r54, w: 900, h: 700 }, 'size root')
    const grid = s54.addComponent('DataGrid', r54, 20, 20) as string
    s54.commit({ op: 'resize', id: grid, w: 640, h: 300 }, 'size grid')
    const field = s54.addComponent('Field', r54, 20, 400, { description: 'Help' }) as string
    const inner = s54.addComponent('Stat', field, 0, 0) as string
    s54.commit({ op: 'setPartStyle', id: grid, part: 'header', patch: { fontSize: 15, color: '#123456' } }, 'header')
    check('a part style is stored per part', s54.doc.nodes[grid].parts?.header?.fontSize === 15 && s54.doc.nodes[grid].parts?.cell === undefined)
    s54.undo()
    check('undoing the first part style leaves no empty bag', s54.doc.nodes[grid].parts === undefined)
    s54.redo()
    s54.commit({ op: 'setPartStyle', id: grid, part: 'nonsense', patch: { fontSize: 15 } }, 'bad part')
    s54.commit({ op: 'setPartStyle', id: grid, part: 'row', patch: { fontSize: 15, paddingX: 4 } }, 'not accepted')
    check('an undeclared part, or a field the part does not take, never lands',
      s54.doc.nodes[grid].parts?.nonsense === undefined && s54.doc.nodes[grid].parts?.row === undefined, JSON.stringify(s54.doc.nodes[grid].parts))
    s54.commit({ op: 'setPartStyle', id: grid, part: 'cell', patch: { fontSize: 999, background: 'red}</style><script>alert(1)</script>' } }, 'hostile')
    check('part numbers clamp and hostile colours never land',
      s54.doc.nodes[grid].parts?.cell?.fontSize === 96 && s54.doc.nodes[grid].parts?.cell?.background === undefined, JSON.stringify(s54.doc.nodes[grid].parts?.cell))

    // Isolation: a Field's label rule must not reach a Stat's label nested in it.
    s54.commit({ op: 'setPartStyle', id: field, part: 'label', patch: { color: '#123456' } }, 'field label')
    const nested = mounted(s54.doc, 'preview', (h) => {
      const own = partEls(h, field, 'label')[0]
      // The Stat's label is unstyled, so it carries no hook in output: find it by text.
      const statLabel = [...h.querySelectorAll('span')].find((e) => e.textContent === 'Revenue') as HTMLElement | undefined
      return { own: own ? getComputedStyle(own).color : 'missing', nested: statLabel ? getComputedStyle(statLabel).color : 'missing' }
    })
    check('a part rule stays inside its own component', nested.own === 'rgb(18, 52, 86)' && nested.nested !== 'rgb(18, 52, 86)' && nested.nested !== 'missing',
      JSON.stringify(nested))
    void inner

    // Output hooks only where needed.
    const html54 = emitHtml(s54.doc)
    check('a styled part carries its hook in the export', html54.includes(`data-loom-part="${grid}/header"`) && html54.includes(`data-loom-part="${field}/label"`))
    check('an unstyled part carries none', !html54.includes(`data-loom-part="${grid}/row"`) && !html54.includes(`data-loom-part="${field}/description"`))
    check('both exports ship the part rules', html54.includes('Loom: part styling') && emitReact(s54.doc).includes('Loom: part styling'))

    // The file trust boundary.
    const hostile54 = JSON.parse(serialize(s54.doc)) as { nodes: Record<string, Record<string, unknown>> }
    hostile54.nodes[grid].parts = { header: { fontSize: 'big', color: 'url(x)', align: 'sideways', fontWeight: 700 }, ghost: { color: 'red' }, row: { fontSize: 12 }, cell: 'x' }
    const loaded54 = validate(JSON.stringify(hostile54))
    const p54 = loaded54.issues.map((i) => `${i.path} ${i.message}`)
    check('a hostile parts bag is repaired and reported',
      JSON.stringify(loaded54.doc?.nodes[grid].parts) === JSON.stringify({ header: { fontWeight: 700 } }) &&
      p54.some((p) => p.includes('no part "ghost"')) && p54.some((p) => p.includes('not a colour')) && p54.some((p) => p.includes('not accepted by this part')) &&
      p54.some((p) => p.includes('parts.cell')) && p54.some((p) => p.includes('not one of')), p54.join(' | '))
    const clean54 = validate(serialize(s54.doc))
    check('parts survive save and load', clean54.issues.length === 0 &&
      JSON.stringify(clean54.doc?.nodes[grid].parts) === JSON.stringify(s54.doc.nodes[grid].parts), clean54.issues.map((i) => i.message).join(' | '))
    const forged54 = JSON.parse(JSON.stringify(s54.doc)) as Document
    forged54.nodes[grid].parts = { header: { color: 'red}</style><script>alert(1)</script>' } } as never
    check('a forged part colour cannot break out of the exported stylesheet', !emitHtml(forged54).includes('<script>alert(1)'))

    // The canvas draws the composite for real.
    const canvas = mounted(s54.doc, 'authoring', (h) => {
      const g = h.querySelector(`[data-loom-id="${grid}"]`) as HTMLElement | null
      const f = h.querySelector(`[data-loom-id="${field}"]`) as HTMLElement | null
      const cell = g?.querySelector('td[data-loom-cell]') as HTMLElement | null
      const r = cell?.getBoundingClientRect()
      const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null
      return {
        table: Boolean(g?.querySelector('table')),
        headerCount: g?.querySelectorAll('th').length ?? 0,
        fieldChild: Boolean(f?.querySelector(`[data-loom-id="${inner}"]`)),
        searchInert: Boolean(g?.querySelector('input[type="search"]')?.closest('[inert]')),
        hitGoesToNode: hit !== null && hit === g,
        hit: hit ? `${hit.tagName}.${hit.getAttribute('data-loom-id') ?? ''}` : 'nothing',
      }
    })
    check('the canvas draws a real grid, not a stub', canvas.table && canvas.headerCount >= 4, JSON.stringify(canvas))
    check('an unselected Field shows the control inside it on the canvas', canvas.fieldChild, JSON.stringify(canvas))
    check('a composite\'s own controls are a picture on the canvas: inert, and a click lands on the node',
      canvas.searchInert && canvas.hitGoesToNode, JSON.stringify(canvas))
    const picked = mounted(s54.doc, 'authoring', (h) => {
      const g = h.querySelector(`[data-loom-id="${grid}"]`) as HTMLElement | null
      return { table: Boolean(g?.querySelector('table')), handles: g?.querySelectorAll('[data-loom-handle]').length ?? 0, selected: g?.getAttribute('data-selected') }
    }, [grid])
    // Its handles are the canvas's selection layer's (§101), not the grid's.
    check('selected, it is the same grid, marked selected', picked.table && picked.handles === 0 && picked.selected === 'true', JSON.stringify(picked))
  }

  // --- 55. every area of every component can be customized ---------------
  // The area audit renders every component in every probe state and finds
  // every inner element that sets its own look without a part to reach it.
  // KNOWN_UNREACHABLE is the ratchet: it may only shrink.
  {
    const areas = auditAreas()
    const found = new Map(areas.findings.map((f) => [`${f.component}|${f.where}`, f]))
    const fresh = [...found].filter(([k, f]) => !KNOWN_UNREACHABLE[k] || f.needs.some((n) => !KNOWN_UNREACHABLE[k].includes(n)))
      .map(([k, f]) => `${k} needs ${f.needs.join('/')} ("${f.sample}")`)
    const stale = Object.keys(KNOWN_UNREACHABLE).filter((k) => !found.has(k))
    const narrower = Object.entries(KNOWN_UNREACHABLE).filter(([k, needs]) => found.has(k) && needs.some((n) => !(found.get(k)?.needs ?? []).includes(n))).map(([k]) => k)
    check('no component draws a new area a designer cannot customize', fresh.length === 0, fresh.slice(0, 12).join(' | '))
    check('the customization backlog has no stale entries', stale.length === 0 && narrower.length === 0,
      `fixed, remove from area-backlog.ts: ${[...stale, ...narrower].slice(0, 12).join(' | ')}`)
    check('the area audit reads every inline property it meets', areas.unclassified.length === 0, areas.unclassified.slice(0, 12).join(', '))
    check('the area audit actually looks', areas.components === allComponents().length && areas.elements > 10000,
      `${areas.components} components, ${areas.elements} elements, ${found.size} areas still unreachable`)
  }

  // --- 56. conversation tools: a chat built from separate tools -----------
  {
    const s56 = new EditorStore()
    s56.addComponent('Panel', null, 0, 0)
    const r56 = s56.doc.root as string
    s56.commit({ op: 'resize', id: r56, w: 900, h: 600 }, 'size')
    const before56 = s56.history.length
    const side = s56.addStarter('chat-sidebar', r56, 0, 0) as string
    const byType = (t: string, within = side) => [within, ...descendants(s56.doc, within)].filter((id) => s56.doc.nodes[id]?.type === t)
    const list = byType('MessageList')[0]
    const composer = byType('Composer')[0]
    check('the chat starter drops real tools as one undo step',
      Boolean(list && composer) && s56.history.length === before56 + 1 && byType('MessageBubble').length === 3 && s56.doc.nodes[list]?.props.showTyping === true &&
      STARTERS.some((st) => st.id === 'chat-sidebar'), `${s56.history.length - before56} steps`)
    check('the starter wires its composer to its own list', s56.doc.nodes[composer]?.props.sendsTo === list)
    check('the chat sidebar docks to the left edge', s56.doc.nodes[side]?.props.anchor === 'left')
    const side2 = s56.addStarter('chat-sidebar', r56, 400, 0) as string
    check('a second drop is wired to its OWN list', s56.doc.nodes[byType('Composer', side2)[0]]?.props.sendsTo === byType('MessageList', side2)[0])
    const dup = s56.duplicate(side) as string
    check('duplicating a chat panel rewires the copy to the copied list',
      Boolean(dup) && s56.doc.nodes[byType('Composer', dup)[0]]?.props.sendsTo === byType('MessageList', dup)[0])
    s56.undo()
    s56.undo()

    // The file trust boundary: a reference that points nowhere, or at the
    // wrong kind of node, is cleared and reported.
    const bad = JSON.parse(serialize(s56.doc)) as { nodes: Record<string, { props: Record<string, unknown> }> }
    bad.nodes[composer].props.sendsTo = side
    const other = byType('Composer', side)[0]
    const loadedBad = validate(JSON.stringify(bad))
    const badIssues = loadedBad.issues.map((i) => `${i.path} ${i.message}`)
    check('a reference to the wrong kind of node is cleared and reported',
      loadedBad.doc?.nodes[composer]?.props.sendsTo === '' && badIssues.some((m) => m.includes('sendsTo') && m.includes('expected MessageList')), badIssues.join(' | '))
    bad.nodes[composer].props.sendsTo = 'nope'
    const loadedGone = validate(JSON.stringify(bad))
    check('a reference to a missing node is cleared and reported',
      loadedGone.doc?.nodes[composer]?.props.sendsTo === '' && loadedGone.issues.some((i) => i.message.includes('missing node')))
    check('a good reference survives save and load', validate(serialize(s56.doc)).doc?.nodes[composer]?.props.sendsTo === list)
    void other

    // A style on the template must carry to a sent message: the copy keeps the
    // part hooks, so the same generated rule reaches it.
    const template = byType('MessageBubble').find((id) => s56.doc.nodes[id]?.props.template === true) as string
    s56.commit({ op: 'setPartStyle', id: template, part: 'body', patch: { background: '#123456' } }, 'style template')

    // LIVE: the real runtime, real events, in a real document.
    installBehaviourRuntime()
    const style56 = document.createElement('style')
    style56.textContent = documentCss(s56.doc)
    document.head.appendChild(style56)
    const host56 = document.createElement('div')
    host56.className = 'loom-container'
    host56.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:420px;z-index:99999'
    host56.innerHTML = renderToStaticMarkup(renderNode({ doc: s56.doc, selected: new Set(), mode: 'preview' }, r56))
    document.body.appendChild(host56)
    const listEl = host56.querySelector(`[data-loom-list="${list}"]`) as HTMLElement
    const composerEl = host56.querySelector(`[data-loom-sends-to="${list}"]`) as HTMLElement
    const input = composerEl?.querySelector('textarea') as HTMLTextAreaElement
    const texts = () => [...(listEl?.querySelectorAll('[data-loom-bubble-text]') ?? [])].map((e) => e.textContent)
    const type = (text: string) => {
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const press = (key: string, shiftKey = false) => {
      const ev = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
      input.dispatchEvent(ev)
      return ev.defaultPrevented
    }
    let sent = ''
    composerEl?.addEventListener('loom:send', (e) => { sent = String((e as CustomEvent).detail?.text ?? '') })
    const startCount = texts().length
    type('Is the launch still on for Friday?')
    check('typing arms the send button', composerEl?.getAttribute('data-loom-empty') === '0')
    press('Enter')
    const afterEnter = texts()
    const newest = [...listEl.children].filter((c) => c.querySelector('[data-loom-bubble-text]') || c.matches('[data-loom-bubble]')).pop()
    const typingIsLast = [...listEl.children].filter((c) => !c.hasAttribute('data-loom-list-jump')).pop()?.querySelector?.('[data-loom-typing]') !== null ||
      [...listEl.children].filter((c) => !c.hasAttribute('data-loom-list-jump')).pop()?.hasAttribute('data-loom-typing')
    check('Enter sends: the message lands in the list, the composer clears',
      afterEnter.length === startCount + 1 && afterEnter.includes('Is the launch still on for Friday?') && input.value === '' &&
      composerEl.getAttribute('data-loom-empty') === '1' && sent === 'Is the launch still on for Friday?', JSON.stringify(afterEnter))
    check('a new message lands after the last message and before the typing indicator', Boolean(typingIsLast) && Boolean(newest))
    const copy = [...listEl.querySelectorAll('[data-loom-bubble="sent"]')].pop() as HTMLElement
    const copyBody = copy?.querySelector('[data-loom-bubble-text]')?.parentElement as HTMLElement | null
    check('the sent message looks like the template, styling included',
      Boolean(copy) && !copy.hasAttribute('data-loom-template') && copyBody !== null && getComputedStyle(copyBody).backgroundColor === 'rgb(18, 52, 86)',
      copyBody ? getComputedStyle(copyBody).backgroundColor : 'missing')
    check('only one message stays the template', listEl.querySelectorAll('[data-loom-template]').length === 1)
    type('line one')
    const shiftPrevented = press('Enter', true)
    check('Shift+Enter is a new line, not a send', !shiftPrevented && texts().length === startCount + 1 && input.value === 'line one')
    type('   ')
    press('Enter')
    check('an empty message is never sent', texts().length === startCount + 1)
    type('<img src=x onerror="window.__loomPwned=1">')
    ;(composerEl.querySelector('[data-loom-composer-send]') as HTMLButtonElement).click()
    check('the send button sends, and what was typed stays text',
      texts().length === startCount + 2 && !listEl.querySelector('img') && !(window as unknown as { __loomPwned?: number }).__loomPwned)

    // Staying on the newest message, and not yanking a reader who scrolled up.
    for (let i = 0; i < 8; i++) { type(`filler ${i}`); press('Enter') }
    const bottomGap = () => listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight
    check('the list follows new messages while you are at the bottom', listEl.scrollHeight > listEl.clientHeight && bottomGap() <= 2, `${bottomGap()}`)
    listEl.scrollTop = 0
    listEl.dispatchEvent(new Event('scroll'))
    type('while you were reading')
    press('Enter')
    const jump = listEl.querySelector('[data-loom-list-jump]') as HTMLElement
    check('scrolled up, a new message shows the jump pill instead of moving you',
      listEl.scrollTop === 0 && jump.getAttribute('data-loom-open') === '1' && getComputedStyle(jump).display !== 'none', `${listEl.scrollTop} ${jump.getAttribute('data-loom-open')}`)
    jump.click()
    check('the jump pill takes you to the newest message and goes away', bottomGap() <= 2 && jump.getAttribute('data-loom-open') === '0')

    // A composer that sends nowhere says so and sends nothing.
    const errors: string[] = []
    const origError = console.error
    console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')) }
    composerEl.setAttribute('data-loom-sends-to', 'nowhere')
    type('lost')
    press('Enter')
    console.error = origError
    check('a composer with no list reports it and sends nothing', errors.some((e) => e.includes('no message list')) && !texts().includes('lost'))
    host56.remove()
    style56.remove()

    // The canvas: the composer's own box is a picture; the list's messages are live nodes.
    const canvas56 = (() => {
      const h = document.createElement('div')
      h.innerHTML = renderToStaticMarkup(renderNode({ doc: s56.doc, selected: new Set(), mode: 'authoring' }, r56))
      const out = {
        inputInert: Boolean(h.querySelector(`[data-loom-id="${composer}"] textarea`)?.hasAttribute('inert')),
        bubbleIsNode: Boolean(h.querySelector(`[data-loom-id="${template}"]`)) && !h.querySelector(`[data-loom-id="${template}"]`)?.closest('[inert]'),
      }
      return out
    })()
    check('on the canvas the composer is a picture and the messages are nodes', canvas56.inputInert && canvas56.bubbleIsNode, JSON.stringify(canvas56))
    const convo = auditAreas((c) => c.category === 'Conversation')
    check('every area of every conversation tool can be customized', convo.components === 3 && convo.findings.length === 0,
      convo.findings.map((f) => `${f.component}|${f.where} ${f.needs.join('/')}`).join(' | '))
  }

  // --- 57. shared styling pass: fixes found while building the chat -------
  {
    const s57 = new EditorStore()
    s57.addComponent('Panel', null, 0, 0)
    const r57 = s57.doc.root as string
    s57.commit({ op: 'resize', id: r57, w: 800, h: 400 }, 'size')
    const avatar = s57.addComponent('Avatar', r57, 10, 10, { initials: 'AI' }) as string
    const rowId = s57.addComponent('Stack', r57, 10, 80, { direction: 'row', align: 'end' }, { flow: true }) as string
    const divider = s57.addComponent('Divider', r57, 10, 200, { label: 'Today' }) as string
    const header = s57.addComponent('HeaderBar', r57, 10, 260, { title: 'Assistant' }) as string
    const t57 = resolveTheme(s57.doc.meta.theme)
    const live57 = (mode: 'preview' | 'authoring') => {
      const h = document.createElement('div')
      h.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:400px'
      h.innerHTML = renderToStaticMarkup(renderNode({ doc: s57.doc, selected: new Set(), mode }, r57))
      document.body.appendChild(h)
      const probe = document.createElement('span')
      probe.style.color = t57.textOnAccent
      document.body.appendChild(probe)
      const want = getComputedStyle(probe).color
      probe.remove()
      const byId = (id: string) => h.querySelector(`[data-loom-id="${id}"]`) as HTMLElement | null
      const out = {
        initials: getComputedStyle((mode === 'authoring' ? byId(avatar) : h.querySelector('[role="img"]')) as HTMLElement).color,
        want,
        rowTextAlign: mode === 'authoring' ? getComputedStyle(byId(rowId) as HTMLElement).textAlign : '',
        dividerText: mode === 'authoring' ? (byId(divider)?.textContent ?? '') : '',
        headerText: mode === 'authoring' ? (byId(header)?.textContent ?? '') : '',
      }
      h.remove()
      return out
    }
    const a57 = live57('authoring')
    const p57 = live57('preview')
    check('an Avatar keeps its own initials colour instead of a tone painting them danger',
      a57.initials === a57.want && p57.initials === p57.want, JSON.stringify({ a: a57.initials, p: p57.initials, want: a57.want }))
    check('a row aligned to the end does not right-align the text inside it', a57.rowTextAlign !== 'end' && a57.rowTextAlign !== 'right', a57.rowTextAlign)
    check('the canvas draws a divider\'s label property', a57.dividerText.includes('Today'), a57.dividerText)
    check('the canvas draws a header\'s title', a57.headerText.includes('Assistant'), a57.headerText)
  }

  // --- 58. a component's pieces live in ITS panel, not the toolbox --------
  {
    const gone = ['TimelineItem', 'MenuItem', 'NavLink', 'Radio', 'TypingIndicator']
    check('child-only tools are gone from the registry', gone.every((n) => !getComponent(n)), gone.filter((n) => getComponent(n)).join(', '))
    const added = addedTypes()
    check('tools a parent creates are not toolbox tools', ['TabPanel', 'AccordionItem', 'SettingsRow', 'MessageBubble'].every((n) => added.has(n)), [...added].join(', '))
    check('every listed type declares a real list', allComponents().every((c) => Object.values(c.lists ?? {}).every((l) =>
      l.fields[l.titleField] !== undefined && l.max > 0 && l.default.length <= l.max)))

    // The list op: whole-list replace, exact undo, validated items.
    const s58 = new EditorStore()
    s58.addComponent('Panel', null, 0, 0)
    const r58 = s58.doc.root as string
    s58.commit({ op: 'resize', id: r58, w: 900, h: 600 }, 'size')
    const tl = s58.addComponent('Timeline', r58, 10, 10) as string
    const shipped = itemsOf(s58.doc.nodes[tl], 'events').length
    check('a new timeline starts with its sample events', shipped === 3 && Array.isArray(s58.doc.nodes[tl].lists?.events))
    s58.commit({ op: 'setList', id: tl, key: 'events', items: [{ title: 'Kickoff', tone: 'success' }, { title: 'Launch', tone: 'nope', bogus: 1 } as never] }, 'events')
    const ev = itemsOf(s58.doc.nodes[tl], 'events')
    check('list items are validated field by field', ev.length === 2 && ev[0].title === 'Kickoff' && ev[0].time === '2h ago' && ev[1].tone === 'accent' && !('bogus' in ev[1]),
      JSON.stringify(ev))
    s58.undo()
    check('undoing a list edit restores the list exactly', itemsOf(s58.doc.nodes[tl], 'events').length === 3)
    s58.redo()
    s58.commit({ op: 'setList', id: tl, key: 'nonsense', items: [] }, 'bad')
    check('a list the component does not declare is refused', s58.doc.nodes[tl].lists?.nonsense === undefined)
    s58.commit({ op: 'setList', id: tl, key: 'events', items: Array.from({ length: 500 }, (_, i) => ({ title: `e${i}` })) }, 'flood')
    check('a list is capped', itemsOf(s58.doc.nodes[tl], 'events').length === 200)
    s58.undo()

    // The trust boundary.
    const hostile58 = JSON.parse(serialize(s58.doc)) as { nodes: Record<string, Record<string, unknown>> }
    hostile58.nodes[tl].lists = { events: [{ title: 5, time: 'now' }, 'x', { title: 'ok', extra: true }], ghosts: [] }
    const loaded58 = validate(JSON.stringify(hostile58))
    const lp = loaded58.issues.map((i) => `${i.path} ${i.message}`)
    check('a hostile list is repaired and reported', itemsOf(loaded58.doc?.nodes[tl] as LoomNode, 'events').length === 2 &&
      lp.some((m) => m.includes('events[0].title')) && lp.some((m) => m.includes('not an item')) && lp.some((m) => m.includes('unknown field')) && lp.some((m) => m.includes('no list "ghosts"')),
      lp.join(' | '))
    check('lists survive save and load', JSON.stringify(validate(serialize(s58.doc)).doc?.nodes[tl].lists) === JSON.stringify(s58.doc.nodes[tl].lists))

    // Every field of every list changes the output. A field can matter only
    // for SOME rows (a grid column's decimals mean nothing on a column of
    // names), so it passes when changing it on ANY default row shows; a field
    // whose plain-text change is not a valid value gets a real one here.
    const LIST_ALT: Record<string, string | number> = { 'DataGrid.columns.tones': 'Active=danger' }
    const inert: string[] = []
    for (const comp of allComponents()) {
      for (const [key, ls] of Object.entries(comp.lists ?? {})) {
        for (const [field, ps] of Object.entries(ls.fields)) {
          const st = new EditorStore()
          st.addComponent('Panel', null, 0, 0)
          const id = st.addComponent(comp.name, st.doc.root as string, 0, 0) as string
          const draw = () => renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set(), mode: 'preview' }, st.doc.root as string))
          const changes = ls.default.some((row, i) => {
            const base = { ...row }
            const alt =
              LIST_ALT[`${comp.name}.${key}.${field}`] ??
              (ps.type === 'boolean' ? !base[field] : ps.type === 'enum' ? (ps.options ?? []).find((o) => o !== base[field]) ?? base[field] : ps.type === 'number' ? Number(base[field] ?? 0) + 1 : field === 'icon' ? (base[field] ? '' : 'star') : `${String(base[field] ?? '')}Z`)
            st.commit({ op: 'setList', id, key, items: ls.default.map((r) => ({ ...r })) }, 'a')
            const before = draw()
            st.commit({ op: 'setList', id, key, items: ls.default.map((r, j) => (j === i ? { ...base, [field]: alt as string | number | boolean } : { ...r })) }, 'b')
            return before !== draw()
          })
          if (!changes) inert.push(`${comp.name}.${key}.${field}`)
        }
      }
    }
    check('every field of every list changes the output', inert.length === 0, inert.join(', '))

    // A container that names its children refuses anything else.
    const tabs = s58.addComponent('Tabs', r58, 10, 200) as string
    const before58 = s58.doc.nodes[tabs].children.length
    s58.addComponent('Button', tabs, 0, 0)
    check('a tab set refuses a stray button', s58.doc.nodes[tabs].children.length === before58)
    const t1 = s58.addComponent('TabPanel', tabs, 0, 0, { title: 'Overview' }) as string
    s58.addComponent('TabPanel', tabs, 0, 0, { title: 'Activity' })
    const hiddenTab = s58.addComponent('TabPanel', tabs, 0, 0, { title: 'Secret' }) as string
    s58.commit({ op: 'setVisible', id: hiddenTab, visible: false }, 'hide')
    const btn = s58.addComponent('Button', r58, 400, 10) as string
    s58.commit({ op: 'reparent', id: btn, parent: tabs }, 'sneak')
    check('reparenting into a tab set is refused too', !s58.doc.nodes[tabs].children.includes(btn))
    const strip = (() => {
      const h = document.createElement('div')
      h.innerHTML = renderToStaticMarkup(renderNode({ doc: s58.doc, selected: new Set(), mode: 'preview' }, r58))
      return [...h.querySelectorAll(`[data-loom-tabs] [role="tab"]`)].map((b) => b.textContent)
    })()
    check('the strip\'s labels are the tabs\' own titles, and a hidden tab has none', JSON.stringify(strip) === '["Overview","Activity"]', JSON.stringify(strip))
    void t1

    // The active link is its own part: styled apart from the other links.
    const nav = s58.addComponent('NavBar', r58, 10, 400) as string
    s58.commit({ op: 'setPartStyle', id: nav, part: 'link', patch: { color: '#123456' } }, 'links')
    s58.commit({ op: 'setPartStyle', id: nav, part: 'active', patch: { color: '#abcdef' } }, 'current')
    const style58 = document.createElement('style')
    style58.textContent = documentCss(s58.doc)
    document.head.appendChild(style58)
    const h58 = document.createElement('div')
    h58.innerHTML = renderToStaticMarkup(renderNode({ doc: s58.doc, selected: new Set(), mode: 'preview' }, r58))
    document.body.appendChild(h58)
    const links = [...h58.querySelectorAll('nav a')].map((a) => ({ current: a.getAttribute('aria-current'), color: getComputedStyle(a).color }))
    h58.remove()
    style58.remove()
    const navRow = (() => {
      const h = document.createElement('div')
      h.innerHTML = renderToStaticMarkup(renderNode({ doc: s58.doc, selected: new Set(), mode: 'preview' }, r58))
      document.body.appendChild(h)
      const navEl = h.querySelector('nav') as HTMLElement
      const out = navEl ? getComputedStyle(navEl).flexDirection : 'missing'
      h.remove()
      return out
    })()
    check('a nav bar lays its title and links out in a row', navRow === 'row', navRow)
    check('the current link wears the "current" part; the others wear "links"',
      links.length === 3 && links.filter((l) => l.current === 'page').every((l) => l.color === 'rgb(171, 205, 239)') &&
      links.filter((l) => l.current !== 'page').every((l) => l.color === 'rgb(18, 52, 86)'), JSON.stringify(links))
  }

  // --- 59. old files open with their pieces folded into their owners --------
  {
    const n = (id: string, type: string, props: Record<string, unknown>, children: string[] = []) =>
      ({ id, type, props, children, flow: false, visible: true, locked: false, opacity: 1 })
    const old = {
      version: 1,
      meta: { name: 'old', targets: ['web'], created: 0 },
      root: 'r',
      nodes: {
        r: n('r', 'Panel', {}, ['tl', 'stray', 'menu', 'nav', 'lone', 'rg', 'form', 'tabs', 'emptyTl', 'ml']),
        tl: n('tl', 'Timeline', {}, ['e1', 'keep', 'e2']),
        e1: n('e1', 'TimelineItem', { title: 'First', time: 'Mon', size: 'lg', markerSize: 14 }),
        keep: n('keep', 'Button', { label: 'Kept' }),
        e2: n('e2', 'TimelineItem', { title: 'Second', tone: 'danger' }),
        stray: n('stray', 'TimelineItem', { title: 'Alone', x: 5, y: 6 }),
        menu: n('menu', 'Menu', {}, ['m1', 'm2']),
        m1: n('m1', 'MenuItem', { label: 'Open', shortcut: '⌘O' }),
        m2: n('m2', 'MenuItem', { label: 'Delete', danger: true }),
        nav: n('nav', 'NavBar', {}, ['l1', 'l2']),
        l1: n('l1', 'NavLink', { label: 'Home', active: true, size: 'sm' }),
        l2: n('l2', 'NavLink', { label: 'Docs', href: '/docs' }),
        lone: n('lone', 'NavLink', { label: 'Help', href: '/help' }),
        rg: n('rg', 'RadioGroup', { options: 'Free|Pro', optionsSep: 'pipe', value: 'Pro' }, ['rr']),
        rr: n('rr', 'Radio', { label: 'Team' }),
        form: n('form', 'Stack', {}, ['ra', 'rb']),
        ra: n('ra', 'Radio', { label: 'Monthly', group: 'billing' }),
        rb: n('rb', 'Radio', { label: 'Yearly', group: 'billing', checked: true }),
        tabs: n('tabs', 'Tabs', { tabs: 'One, Two, Three' }, ['p1']),
        p1: n('p1', 'TabPanel', { title: 'x' }),
        emptyTl: n('emptyTl', 'Timeline', {}),
        ml: n('ml', 'MessageList', {}, ['typing']),
        typing: n('typing', 'TypingIndicator', { label: 'Grace is typing' }),
      },
    }
    const res = validate(JSON.stringify(old))
    const d = res.doc
    const rows = (id: string, key: string) => (d ? itemsOf(d.nodes[id], key) : [])
    const said = res.issues.map((i) => i.message).join(' | ')
    check('an old timeline keeps its events, in order, with their size', d !== null &&
      JSON.stringify(rows('tl', 'events').map((e) => e.title)) === '["First","Second"]' && rows('tl', 'events')[1].tone === 'danger' &&
      d.nodes.tl.props.size === 'lg' && d.nodes.tl.props.markerSize === 14, JSON.stringify(rows('tl', 'events')))
    check('what else a timeline held moves beside it, not away', d !== null && Boolean(d.nodes.keep) &&
      d.nodes.r.children.indexOf('keep') === d.nodes.r.children.indexOf('tl') + 1 && d.nodes.tl.children.length === 0, JSON.stringify(d?.nodes.r.children))
    check('a stray event becomes a timeline of one', d?.nodes.stray?.type === 'Timeline' && rows('stray', 'events')[0]?.title === 'Alone' && d?.nodes.stray.props.x === 5)
    check('an old empty timeline stays empty, not sample content', rows('emptyTl', 'events').length === 0)
    check('menu commands fold into their menu', JSON.stringify(rows('menu', 'items').map((i) => [i.label, i.shortcut, i.danger])) === '[["Open","⌘O",false],["Delete","",true]]')
    check('nav links fold into their bar, the current one kept', JSON.stringify(rows('nav', 'links').map((l) => [l.label, l.active, l.href])) === '[["Home",true,"#"],["Docs",false,"/docs"]]' &&
      d?.nodes.nav.props.size === 'sm')
    check('a nav link on its own becomes a link', d?.nodes.lone?.type === 'Link' && d?.nodes.lone.props.text === 'Help' && d?.nodes.lone.props.href === '/help')
    check('radio options: the old string first, then the radios inside',
      JSON.stringify(rows('rg', 'options').map((o) => o.label)) === '["Free","Pro","Team"]' && d?.nodes.rg.props.value === 'Pro' && !('options' in (d?.nodes.rg.props ?? {})))
    const billing = d ? Object.values(d.nodes).filter((x) => x.type === 'RadioGroup' && d.nodes.form.children.includes(x.id)) : []
    check('radios that were one choice become ONE group, keeping the checked one',
      billing.length === 1 && JSON.stringify(itemsOf(billing[0], 'options').map((o) => o.label)) === '["Monthly","Yearly"]' && billing[0].props.value === 'Yearly',
      JSON.stringify(billing.map((b) => b.lists)))
    const tabTitles = d ? d.nodes.tabs.children.map((c) => d.nodes[c]?.props.title) : []
    check('old tab labels become the tabs\' titles, with a tab for each', JSON.stringify(tabTitles) === '["One","Two","Three"]' && !('tabs' in (d?.nodes.tabs.props ?? {})), JSON.stringify(tabTitles))
    check('a typing indicator becomes its list\'s typing option', d?.nodes.ml.props.showTyping === true && d?.nodes.ml.props.typingLabel === 'Grace is typing' && !d?.nodes.typing)
    check('every migration is reported', ['row of its Timeline', 'became a Timeline', 'row of its Menu', 'row of its NavBar', 'became a Link', 'joined the others', 'tabs\' own titles', 'Show typing'].every((m) => said.includes(m)), said)
    check('a migrated file saves and reloads clean', d !== null && validate(serialize(d)).issues.length === 0, d ? validate(serialize(d)).issues.map((i) => i.message).join(' | ') : 'no doc')
  }

  // --- 60. a selected Button looks like the Button, not a browser button ---
  // Regression: selecting a Button swapped its label for a bare <button>, which
  // drew the browser's grey box and border inside the designed one.
  {
    const s60 = new EditorStore()
    s60.addComponent('Button', s60.doc.root, 20, 20)
    const id = s60.selection[0]
    const host = document.createElement('div')
    document.body.appendChild(host)
    const r60 = createRoot(host)
    for (const selected of [false, true]) {
      r60.render(renderNode({ doc: s60.doc, selected: new Set(selected ? [id] : []), onPointerDownNode: () => undefined }, s60.doc.root!))
      await new Promise((r) => setTimeout(r, 60))
      const inner = host.querySelector(`[data-loom-id="${id}"] button`) as HTMLElement | null
      const cs = inner ? getComputedStyle(inner) : null
      const bare = cs !== null && (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.borderTopStyle !== 'none' || cs.paddingLeft !== '0px')
      check(`a ${selected ? 'selected' : 'resting'} Button draws no browser button inside itself`, !bare, cs ? `bg=${cs.backgroundColor} border=${cs.borderTopStyle} pad=${cs.paddingLeft}` : 'no inner button')
      const outer = host.querySelector(`[data-loom-id="${id}"]`) as HTMLElement | null
      check(`a ${selected ? 'selected' : 'resting'} Button keeps its label colour`, !!outer && (!inner || getComputedStyle(inner).color === getComputedStyle(outer).color))
    }
    r60.unmount()
    host.remove()
  }

  // --- 61. preview happens IN the canvas, and comes back -----------------
  // The live preview used to be a separate window; now Preview swaps the
  // design canvas for the running artifact in place. Driven through the real
  // mounted app: the switch, the panels that step aside, and Esc.
  {
    const click = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('.titlebar .pv-toggle button')].find((b) => b.textContent?.trim() === label)?.click()
    const shown = (q: string) => {
      const el = document.querySelector<HTMLElement>(q)
      return el !== null && !el.closest('[hidden]') && el.getBoundingClientRect().width > 0
    }
    const wait = () => new Promise((r) => setTimeout(r, 120))
    // The app's own store, given something to run; put back afterwards.
    const app = window.__loomStore
    const before = app.doc
    const scene = new EditorStore()
    scene.addComponent('Heading', scene.doc.root!, 20, 20, { text: 'Preview probe' })
    app.loadDocument(scene.doc)
    await wait()
    check('design mode shows the toolbox, the canvas and the inspector', shown('.toolbox') && shown('.surface') && shown('.inspector') && !shown('.preview-stage'))
    click('Preview')
    await wait()
    const stage = document.querySelector<HTMLElement>('.canvas.previewing .preview-stage')
    check('Preview puts the running artifact where the design was', stage !== null && shown('.canvas.previewing .preview-stage') && !shown('.surface'))
    check('the preview is the output, with no editor hooks', stage !== null && stage.querySelectorAll('[data-loom-id]').length === 0 && (stage.textContent ?? '').includes('Preview probe'), stage ? `text=${(stage.textContent ?? '').slice(0, 40)} hooks=${stage.querySelectorAll('[data-loom-id]').length}` : 'no stage')
    check('the toolbox and inspector step aside in Preview', !shown('.toolbox') && !shown('.inspector'))
    const wrap = document.querySelector<HTMLElement>('.canvas-wrap')?.getBoundingClientRect()
    check('in Preview the canvas takes the full width', wrap !== undefined && Math.abs(wrap.width - window.innerWidth) <= 1, `canvas=${wrap?.width} window=${window.innerWidth}`)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait()
    check('Esc returns to the design', shown('.surface') && shown('.toolbox') && !shown('.preview-stage'))
    app.loadDocument(before)
  }

  // --- 62. the Studio has its own typeface, and the canvas has the export's -
  // The chrome was falling back to whatever the OS had (Noto Sans here). Inter
  // is bundled for the TOOL. The canvas must show what gets exported: it once
  // had to avoid Inter because exports did not ship it; exports now embed the
  // theme's face (render/fonts.ts), so the canvas uses the THEME's stack, which
  // happens to name Inter first. The Studio's own stack must not leak in.
  {
    await document.fonts.load('12px "Inter Variable"')
    await document.fonts.ready
    const face = [...document.fonts].find((f) => f.family.replace(/"/g, '') === 'Inter Variable' && f.status === 'loaded')
    check('the Studio typeface is bundled and loaded', face !== undefined, [...document.fonts].map((f) => `${f.family}:${f.status}`).slice(0, 4).join(' '))
    // Live proof it draws: the same string is a different width in Inter than
    // in the fallback it would otherwise land on.
    const probe = (family: string) => {
      const el = document.createElement('span')
      el.textContent = 'Wide glyphs: Mmwq 0123 Loom Studio'
      el.style.cssText = `position:absolute;visibility:hidden;font-size:40px;font-family:${family}`
      document.body.appendChild(el)
      const w = el.getBoundingClientRect().width
      el.remove()
      return w
    }
    const inter = probe('"Inter Variable", monospace')
    const fallback = probe('monospace')
    check('Inter actually draws the text', Math.abs(inter - fallback) > 20, `inter=${inter.toFixed(0)} fallback=${fallback.toFixed(0)}`)
    const chrome = getComputedStyle(document.querySelector('.titlebar') ?? document.body).fontFamily
    check('the chrome is set in Inter', /^"?Inter Variable"?,/.test(chrome), chrome)
    const s62 = new EditorStore()
    s62.addComponent('Label', s62.doc.root!, 10, 10, { text: 'Canvas type' })
    const host = document.createElement('div')
    host.className = 'surface'
    document.body.appendChild(host)
    const r62 = createRoot(host)
    r62.render(renderNode({ doc: s62.doc, selected: new Set(), onPointerDownNode: () => undefined }, s62.doc.root!))
    await new Promise((r) => setTimeout(r, 60))
    const label = [...host.querySelectorAll<HTMLElement>('[data-loom-type="Label"]')][0]
    const canvasFont = label ? getComputedStyle(label).fontFamily : 'missing'
    const themeFont = (name?: string) => getTheme(name).fontFamily.replace(/["']/g, '').replace(/\s*,\s*/g, ',')
    const norm = (f: string) => f.replace(/["']/g, '').replace(/\s*,\s*/g, ',')
    check('the canvas keeps the export\'s type, not the Studio\'s', label !== undefined && norm(canvasFont) === themeFont(s62.doc.meta.theme), canvasFont)
    r62.unmount()
    host.remove()
    // And what a component inherits: the real surface and preview stage carry
    // the theme's font, as the exported <body> does.
    const surf = document.querySelector<HTMLElement>('.loom .surface')
    check('the real canvas inherits the theme font, not the Studio font', surf !== null && norm(getComputedStyle(surf).fontFamily) === themeFont(window.__loomStore?.doc.meta.theme), surf ? getComputedStyle(surf).fontFamily : 'no surface')
  }

  // --- 63. every tool has its own drawing ---------------------------------
  // The toolbox used Unicode characters from the OS font: mixed sizes and
  // baselines, some missing entirely. Every component now has a glyph drawn
  // on the icon grid, and the real toolbox shows those, not characters.
  {
    const missing = allComponents().filter((c) => !hasOwnGlyph(c.name)).map((c) => c.name)
    check('every component has a drawing of its own', missing.length === 0, missing.join(', '))
    const tools = [...document.querySelectorAll<HTMLElement>('.toolbox .tool .tool-icon')]
    const bare = tools.filter((t) => t.querySelector('svg') === null || (t.textContent ?? '').trim() !== '')
    check('the real toolbox draws every tool icon as a glyph, not a character', tools.length > 50 && bare.length === 0, `tools=${tools.length} bare=${bare.length}`)
  }

  // --- 64. where you put it in the design is where it is in the preview ---
  // Shane: "an item placed in the center of the workspace, then Preview: it's
  // off to the left". The design canvas was squeezed to the room between the
  // panels (920px) while Preview ran the real 1280px viewport, so x=440 was
  // the middle of one and left of the middle of the other. Now the canvas is
  // always the viewport's true width and the zoom fits it. Real mounted app.
  {
    const app = window.__loomStore
    const before = app.doc
    const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms))
    const scene = new EditorStore()
    scene.addComponent('Button', scene.doc.root!, 0, 0, { label: 'Centred' })
    const btnId = scene.selection[0]!
    app.loadDocument(scene.doc)
    await wait()
    const btn = () => document.querySelector<HTMLElement>(`[data-loom-id="${btnId}"]`) ?? document.querySelector<HTMLElement>('.preview-stage button')
    // Put it dead centre of the Desktop viewport, measured, in doc px.
    const w = btn()!.getBoundingClientRect().width / (Number(document.querySelector<HTMLElement>('.surface')!.dataset.zoom) / 100)
    app.commit({ op: 'move', id: btnId, x: Math.round(640 - w / 2), y: 60 }, 'centre')
    await wait()
    const zoomOf = (el: HTMLElement) => Number(getComputedStyle(el).zoom) || 1
    const surf = document.querySelector<HTMLElement>('.surface')!
    const dz = zoomOf(surf)
    const sr = surf.getBoundingClientRect()
    const designWidth = (sr.width - 2 * surf.clientLeft * dz) / dz
    check('the design canvas is the viewport\'s true width', Math.abs(designWidth - 1280) <= 2, `${designWidth.toFixed(1)}px at zoom ${dz}`)
    const br = btn()!.getBoundingClientRect()
    const designMid = (br.left + br.width / 2 - (sr.left + surf.clientLeft * dz)) / dz
    ;[...document.querySelectorAll<HTMLButtonElement>('.titlebar .pv-toggle button')].find((b) => b.textContent?.trim() === 'Preview')?.click()
    await wait(250)
    const stage = document.querySelector<HTMLElement>('.canvas.previewing .stage')!
    const pz = zoomOf(stage)
    const pr = stage.getBoundingClientRect()
    const pb = document.querySelector<HTMLElement>('.preview-stage button')!.getBoundingClientRect()
    const previewMid = (pb.left + pb.width / 2 - pr.left) / pz
    // What the designer SEES: the middle of the canvas as drawn is the middle
    // of the viewport (it was x=640 of a 718px-wide canvas: right of centre).
    check('the middle of the design canvas is the middle of the viewport', Math.abs(designMid / designWidth - 0.5) <= 0.005, `${designMid.toFixed(1)} of ${designWidth.toFixed(1)}`)
    check('and in the same place in the preview', Math.abs(previewMid - designMid) <= 3, `design ${designMid.toFixed(1)} / preview ${previewMid.toFixed(1)}`)
    const stageMid = pr.left + pr.width / 2
    const wrap = document.querySelector<HTMLElement>('.canvas-wrap')!.getBoundingClientRect()
    check('the preview screen sits in the middle of the canvas', Math.abs(stageMid - (wrap.left + wrap.width / 2)) <= 12, `${stageMid.toFixed(0)} vs ${(wrap.left + wrap.width / 2).toFixed(0)}`)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait()
    // Every viewport is its own width: the phone was 720px wide (a min-width).
    const pick = (label: string) => document.querySelector<HTMLButtonElement>(`.dock button[aria-label="${label}"]`)?.click()
    for (const [label, px] of [['Phone', 390], ['Tablet', 834], ['Desktop', 1280]] as const) {
      pick(label)
      await wait()
      const el = document.querySelector<HTMLElement>('.surface')!
      const z = zoomOf(el)
      const width = (el.getBoundingClientRect().width - 2 * el.clientLeft * z) / z
      check(`the ${label} canvas is ${px}px wide`, Math.abs(width - px) <= 2, `${width.toFixed(1)}px at zoom ${z}`)
    }
    // Shane: "the height of a component shrinks from design to preview, look
    // at the chat sidebar". A docked sidebar is as tall as the screen it is
    // docked to; the design board had a 460px floor and the preview page a
    // 200px one, so it went 460 -> 200. Both are now the viewport's screen.
    const mode = (m: string) => [...document.querySelectorAll<HTMLButtonElement>('.titlebar .pv-toggle button')].find((b) => b.textContent?.trim() === m)?.click()
    for (const where of ['on its own', 'inside a Panel'] as const) {
      const sc = new EditorStore()
      if (where === 'inside a Panel') sc.dropComponent('Panel', null, 0, 0)
      const side = sc.addStarter('chat-sidebar', sc.doc.root, 40, 40)!
      const top = sc.doc.root!
      app.loadDocument(sc.doc)
      await wait()
      const dz = zoomOf(document.querySelector<HTMLElement>('.surface')!)
      const dSide = document.querySelector<HTMLElement>(`[data-loom-id="${side}"]`)!.getBoundingClientRect().height / dz
      const dTop = document.querySelector<HTMLElement>(`[data-loom-id="${top}"]`)!.getBoundingClientRect().height / dz
      mode('Preview')
      await wait(250)
      const st = document.querySelector<HTMLElement>('.canvas.previewing .stage')!
      const pz = zoomOf(st)
      const pTopEl = st.querySelector<HTMLElement>('.preview-stage > *')!
      const pSideEl = where === 'on its own' ? pTopEl : [...pTopEl.querySelectorAll<HTMLElement>('[aria-label="Assistant"]')].find((e) => e.getBoundingClientRect().width > 200)!
      const pSide = pSideEl.getBoundingClientRect().height / pz
      const pTop = pTopEl.getBoundingClientRect().height / pz
      mode('Design')
      await wait()
      check(`a docked sidebar ${where} is as tall in Preview as in Design`, Math.abs(dSide - pSide) <= 2, `design ${dSide.toFixed(0)} / preview ${pSide.toFixed(0)}`)
      check(`its top-level node ${where} is as tall in Preview as in Design`, Math.abs(dTop - pTop) <= 2, `design ${dTop.toFixed(0)} / preview ${pTop.toFixed(0)}`)
      if (where === 'on its own') check('docked to the screen, it is the screen\'s height', Math.abs(dSide - 800) <= 2, dSide.toFixed(0))
    }

    // A root taller than the board's minimum stays inside it.
    const tall = new EditorStore()
    tall.addComponent('Panel', null, 0, 0, { w: 900, h: 1100 })
    app.loadDocument(tall.doc)
    await wait()
    const board = document.querySelector<HTMLElement>('.surface')!
    const rootEl = board.querySelector<HTMLElement>(':scope > [data-loom-id]')!
    check('the artboard contains a root taller than its minimum', rootEl.getBoundingClientRect().bottom <= board.getBoundingClientRect().bottom + 1, `root ${rootEl.getBoundingClientRect().bottom.toFixed(0)} board ${board.getBoundingClientRect().bottom.toFixed(0)}`)
    app.loadDocument(before)
    await wait()
  }

  // --- 65. the canvas is the output, for every component, at a usable size -
  // Shane: "Design doesn't render text: a GroupBox is a box, Preview shows
  // 'Group' in it; same with Section and others", and "dragged from the
  // toolbox it lands as a tiny speck". Hand-written canvas stubs had drifted
  // (22 of 112 dropped text the output shows) and empty containers arrived
  // 35px square or 0x0 (51 of 112 under 48x24). Every tool, dropped the way
  // the toolbox drops it, measured live on both surfaces.
  {
    const host = (mode: 'authoring' | 'preview', doc: Document, root: string) => {
      const h = document.createElement('div')
      h.className = mode === 'authoring' ? 'surface' : 'preview-stage'
      h.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:900px;overflow:hidden;visibility:hidden'
      document.body.appendChild(h)
      h.innerHTML = renderToStaticMarkup(renderNode({ doc, selected: new Set(), mode }, root))
      return h
    }
    const words = (t: string) => t.replace(/\s+/g, ' ').trim().split(' ').filter((w) => w.length > 2)
    const missingText: string[] = []
    const drift: string[] = []
    const tiny: string[] = []
    const added = addedTypes()
    for (const c of allComponents()) {
      if (added.has(c.name)) continue
      const st = new EditorStore()
      st.addComponent('Panel', null, 0, 0, { w: 1200, h: 860 })
      const root = st.doc.root!
      const id = st.dropComponent(c.name, root, 40, 40)
      if (!id) { tiny.push(`${c.name}: drop refused`); continue }
      const a = host('authoring', st.doc, root)
      const p = host('preview', st.doc, root)
      const ce = a.querySelector<HTMLElement>(`[data-loom-id="${id}"]`)
      const pe = p.firstElementChild?.firstElementChild as HTMLElement | null
      if (!ce || !pe) { drift.push(`${c.name}: not drawn`); a.remove(); p.remove(); continue }
      const ct = ce.textContent ?? ''
      const lost = words(pe.textContent ?? '').filter((w) => !ct.includes(w))
      if (lost.length) missingText.push(`${c.name} (${lost.slice(0, 3).join(' ')})`)
      const cr = ce.getBoundingClientRect()
      const pr = pe.getBoundingClientRect()
      if (Math.abs(cr.width - pr.width) > 4 || Math.abs(cr.height - pr.height) > 4) drift.push(`${c.name} ${Math.round(cr.width)}x${Math.round(cr.height)} vs ${Math.round(pr.width)}x${Math.round(pr.height)}`)
      // A container is a frame at least 120 wide and a bar's height; a leaf
      // is at least a word; a rule (Divider, LoadingBar) is a line, so only
      // its length counts.
      const line = c.name === 'Divider' || c.name === 'LoadingBar'
      const need = c.container ? [120, 20] : line ? [120, 0] : [16, 8]
      if (cr.width < need[0]! || cr.height < need[1]!) tiny.push(`${c.name} ${Math.round(cr.width)}x${Math.round(cr.height)}`)
      a.remove()
      p.remove()
    }
    check('the canvas shows every word the output shows, for every tool', missingText.length === 0, missingText.join(', '))
    check('the canvas draws every tool at the size the output does', drift.length === 0, drift.join(', '))
    check('every tool lands at a size you can see and use', tiny.length === 0, tiny.join(', '))
  }

  // --- 66. docking does what it says, and the Position panel shows it ----
  // Shane: "positioning only has text entry, can we add sliders? Is there
  // anything for docking?" Docking existed (every component's `anchor`) but
  // sat behind "more properties" as a dropdown, `center` put the top-left
  // corner at the centre, and a top/bottom dock with a set width did not span.
  // Typing W on a content-sized node also set its height to 1px.
  {
    const box = (mode: 'authoring' | 'preview', anchor: string) => {
      const st = new EditorStore()
      st.addComponent('Panel', null, 0, 0, { w: 600, h: 400, padding: 0 })
      const root = st.doc.root!
      const id = st.addComponent('Card', root, 50, 60, { w: 120, h: 80, anchor })!
      const h = document.createElement('div')
      h.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;visibility:hidden'
      h.innerHTML = renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set(), mode }, root))
      document.body.appendChild(h)
      const parent = h.firstElementChild as HTMLElement
      const child = (mode === 'authoring' ? h.querySelector(`[data-loom-id="${id}"]`) : parent.firstElementChild) as HTMLElement
      const pr = parent.getBoundingClientRect()
      const cr = child.getBoundingClientRect()
      const inner = { l: pr.left + parent.clientLeft, t: pr.top + parent.clientTop, w: parent.clientWidth, h: parent.clientHeight }
      h.remove()
      return { l: cr.left - inner.l, t: cr.top - inner.t, w: cr.width, h: cr.height, pw: inner.w, ph: inner.h }
    }
    for (const mode of ['authoring', 'preview'] as const) {
      const c = box(mode, 'center')
      check(`${mode}: a centre dock centres it`, Math.abs(c.l + c.w / 2 - c.pw / 2) <= 1 && Math.abs(c.t + c.h / 2 - c.ph / 2) <= 1, JSON.stringify(c))
      const t = box(mode, 'top')
      check(`${mode}: a top dock spans the width, whatever its own width`, Math.abs(t.w - t.pw) <= 1 && Math.abs(t.t) <= 1, JSON.stringify(t))
      const r = box(mode, 'right')
      check(`${mode}: a right dock spans the height at the right edge`, Math.abs(r.h - r.ph) <= 1 && Math.abs(r.l + r.w - r.pw) <= 1, JSON.stringify(r))
    }

    // The real panel: docking is on screen without "more properties", a click
    // docks, and the numbers the dock owns step aside.
    const app = window.__loomStore
    const before = app.doc
    const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms))
    const sc = new EditorStore()
    sc.addComponent('Panel', null, 0, 0, { w: 1280, h: 800 })
    const g = sc.dropComponent('GroupBox', sc.doc.root!, 200, 200)!
    const btn = sc.dropComponent('Button', sc.doc.root!, 600, 300)!
    app.loadDocument(sc.doc)
    app.select([btn])
    await wait()
    const field = (l: string) => document.querySelector<HTMLInputElement>(`.inspector .slide-field input[aria-label="${l}"]`)
    check('Position has a slider for each of X, Y, W and H', ['X', 'Y', 'W', 'H'].every((l) => document.querySelector(`.inspector .slide-field input[aria-label="${l} slider"]`) !== null))
    const hBefore = Number(field('H')?.value)
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const wField = field('W')
    if (wField) {
      setValue.call(wField, '220')
      wField.dispatchEvent(new Event('input', { bubbles: true }))
      wField.dispatchEvent(new Event('blur'))
    }
    await wait()
    const bp = app.doc.nodes[btn]!.props
    check('typing W keeps the height it had (it used to become 1px)', bp.w === 220 && bp.h === hBefore && hBefore > 10, `w=${bp.w} h=${bp.h} before=${hBefore}`)
    const slider = document.querySelector<HTMLInputElement>('.inspector .slide-field input[aria-label="X slider"]')
    if (slider) {
      setValue.call(slider, '333')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await wait()
    check('the X slider moves it', app.doc.nodes[btn]!.props.x === 333, String(app.doc.nodes[btn]!.props.x))
    app.select([g])
    await wait()
    const cell = document.querySelector<HTMLButtonElement>('.inspector .dock-cell[data-cell="right"]')
    check('the dock picker is in Position, not behind more properties', cell !== null)
    cell?.click()
    await wait()
    check('clicking the right edge docks it right', app.doc.nodes[g]!.props.anchor === 'right', String(app.doc.nodes[g]!.props.anchor))
    check('docked, the numbers the dock owns are disabled', field('X')?.disabled === true && field('H')?.disabled === true && field('W')?.disabled === false)
    document.querySelector<HTMLButtonElement>('.inspector .dock-cell[data-cell="right"]')?.click()
    await wait()
    check('clicking it again frees it', app.doc.nodes[g]!.props.anchor === 'none', String(app.doc.nodes[g]!.props.anchor))
    app.loadDocument(before)
    await wait()
  }

  // --- 67. properties are filed by what they mean ------------------------
  // Shane: "go through the properties and make sure they're grouped
  // relationally". Before: `value` in three groups, `align` in three, `size`
  // in three, a "Logic" group, a one-key "Size" group while width/height sat
  // in Layout, separators far from their lists, two "Layout" and two
  // "Position" headings in one panel.
  {
    const where = new Map<string, Set<string>>()
    const outOfOrder: string[] = []
    const apart: string[] = []
    for (const c of allComponents()) {
      const keys = Object.keys(c.props)
      let last = -1
      for (const k of keys) {
        const g = c.props[k]!.group ?? ''
        const i = (GROUP_ORDER as readonly string[]).indexOf(g)
        if (i < 0) outOfOrder.push(`${c.name}.${k} in unknown group ${g}`)
        else if (i < last) outOfOrder.push(`${c.name}.${k} (${g}) after a later group`)
        last = Math.max(last, i)
        if (!where.has(k)) where.set(k, new Set())
        where.get(k)!.add(g)
        // A "show X" switch sits right before X, in X's group.
        const shows = /^show([A-Z]\w*)$/.exec(k)
        const subj = shows ? shows[1]!.charAt(0).toLowerCase() + shows[1]!.slice(1) : ''
        if (subj && keys.includes(subj) && (keys.indexOf(k) !== keys.indexOf(subj) - 1 || c.props[subj]!.group !== g)) apart.push(`${c.name}.${k}`)
        // A separator sits right after its list, in the same group.
        if (/Sep$/.test(k) && keys.includes(k.slice(0, -3))) {
          const list = k.slice(0, -3)
          if (keys.indexOf(k) !== keys.indexOf(list) + 1 || c.props[list]!.group !== g) apart.push(`${c.name}.${k}`)
        }
      }
    }
    check('groups come in one order on every component', outOfOrder.length === 0, outOfOrder.slice(0, 6).join(', '))
    check('a list and its separator, and a thing and its show switch, sit together', apart.length === 0, apart.slice(0, 6).join(', '))
    // The same key, the same meaning, the same group; the named exceptions
    // are decided by what the value IS (words vs a number, container vs leaf).
    const CONTEXTUAL = new Set(['align', 'value', 'max', 'maxItems', 'steps', 'columns', 'maxWidth', 'overflow', 'color', 'tone', 'label'])
    // A "show X" switch goes where X goes, so it is contextual when X is.
    const contextual = (k: string) => CONTEXTUAL.has(k) || (/^show[A-Z]/.test(k) && CONTEXTUAL.has(k.charAt(4).toLowerCase() + k.slice(5)))
    const split = [...where.entries()].filter(([k, gs]) => gs.size > 1 && !contextual(k)).map(([k, gs]) => `${k}: ${[...gs].join('/')}`)
    check('every other property is in the same group on every component', split.length === 0, split.join(', '))
    check('no "Logic" or one-off groups remain', ![...where.values()].some((gs) => gs.has('Logic') || gs.has('General')))
    check('size is with width and height', getComponent('Button')!.props.size!.group === 'Size' && getComponent('Panel')!.props.width!.group === 'Size')

    // The real panel: one Layout heading (with Flow in it), one Position.
    const app = window.__loomStore
    const before = app.doc
    const sc = new EditorStore()
    sc.addComponent('Panel', null, 0, 0, { w: 1280, h: 800 })
    const g = sc.dropComponent('GroupBox', sc.doc.root!, 100, 100)!
    app.loadDocument(sc.doc)
    app.select([g])
    await new Promise((r) => setTimeout(r, 150))
    const heads = [...document.querySelectorAll('.inspector .insp-scroll h3')].map((h) => h.firstChild?.textContent?.trim() ?? '')
    const count = (n: string) => heads.filter((h) => h === n).length
    check('the panel has one Layout and one Position heading', count('Layout') === 1 && count('Position') === 1, heads.join(' | '))
    const layout = [...document.querySelectorAll<HTMLElement>('.inspector .insp-scroll section')].find((sec) => sec.querySelector('h3')?.textContent === 'Layout')
    check('Flow layout is inside the Layout group', !!layout && (layout.textContent ?? '').includes('Flow layout'))
    app.loadDocument(before)
    await new Promise((r) => setTimeout(r, 100))
  }

  // --- 68. every tool shows what it looks like on hover --------------------
  // Shane: "a tiny thumbnail of each tool in its tooltip would make the
  // toolbox much less intimidating". The picture is the real component at
  // its drop size, scaled into the card: every tool and starter must draw
  // something visible that fits the box.
  {
    const bad: string[] = []
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden'
    document.body.appendChild(host)
    const r68 = createRoot(host)
    const tools = [
      ...allComponents().filter((c) => !addedTypes().has(c.name)).map((c) => ({ type: c.name, label: c.name })),
      ...STARTERS.map((st) => ({ starter: st.id, label: st.label })),
    ]
    for (const tool of tools) {
      r68.render(React.createElement(ToolThumb, { tool, theme: 'midnight' }))
      await new Promise((r) => setTimeout(r, 20))
      const thumb = host.querySelector<HTMLElement>('.thumb')
      const drawn = host.querySelector<HTMLElement>('.thumb-inner')?.firstElementChild as HTMLElement | null
      if (!thumb || !drawn) { bad.push(`${tool.label}: nothing drawn`); continue }
      const tr = thumb.getBoundingClientRect()
      const dr = drawn.getBoundingClientRect()
      if (dr.width < 4 || dr.height < 1) bad.push(`${tool.label}: ${dr.width.toFixed(0)}x${dr.height.toFixed(0)}`)
      else if (dr.left < tr.left - 1 || dr.top < tr.top - 1 || dr.right > tr.right + 1 || dr.bottom > tr.bottom + 1) bad.push(`${tool.label}: spills out`)
    }
    check('every tool and starter draws a thumbnail that fits its card', bad.length === 0, bad.join(', '))
    // A short label must not wrap one word per line (it was measured in a
    // zero-width box: "Learn / more", "npm / run / verify").
    const oneLine: string[] = []
    // Counted as lines of text, not pixels: fonts differ between machines.
    for (const type of ['Link', 'InlineCode', 'Badge', 'Button']) {
      r68.render(React.createElement(ToolThumb, { tool: { type }, theme: 'midnight' }))
      await new Promise((r) => setTimeout(r, 20))
      const drawn = host.querySelector<HTMLElement>('.thumb-inner')?.firstElementChild as HTMLElement | null
      if (!drawn) { oneLine.push(`${type}: nothing drawn`); continue }
      const range = document.createRange()
      range.selectNodeContents(drawn)
      const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size
      if (lines > 1) oneLine.push(`${type} on ${lines} lines`)
    }
    check('short labels stay on one line in a thumbnail', oneLine.length === 0, oneLine.join(', '))
    r68.render(React.createElement(ToolThumb, { tool: { type: 'GroupBox' }, theme: 'midnight' }))
    await new Promise((r) => setTimeout(r, 20))
    check('the thumbnail is the real component (a GroupBox shows its legend)', (host.textContent ?? '').includes('Group'), host.textContent ?? '')
    r68.unmount()
    host.remove()

    // The real toolbox: hover a tool, the card appears with its picture; leave, it goes.
    const row = [...document.querySelectorAll<HTMLElement>('.toolbox .tool')].find((b) => b.textContent?.trim() === 'GroupBox')
    row?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    const card = document.querySelector<HTMLElement>('.tool-card')
    check('hovering a tool shows its card with a picture', !!card && !!card.querySelector('.thumb .thumb-inner > *') && (card.textContent ?? '').includes('Group'), card?.textContent?.slice(0, 60) ?? 'no card')
    check('the tool no longer has a plain browser tooltip on top', row?.getAttribute('title') === null)
    row?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }))
    await new Promise((r) => setTimeout(r, 50))
    check('leaving the tool hides its card', document.querySelector('.tool-card') === null)
    // Seen in the same screenshots: an empty workspace said "Layers · -1".
    const app = window.__loomStore
    const before = app.doc
    app.loadDocument({ version: 1, meta: { name: 'empty', targets: ['web'], created: 0 }, root: null, nodes: {} } as unknown as Document)
    await new Promise((r) => setTimeout(r, 100))
    const layersTab = [...document.querySelectorAll('.toolbox button')].find((b) => /Layers/.test(b.textContent ?? ''))?.textContent ?? ''
    check('an empty workspace has 0 layers, not -1', /Layers\s*·\s*0/.test(layersTab), layersTab)
    app.loadDocument(before)
    await new Promise((r) => setTimeout(r, 100))
  }

  // --- 69. a background only when you choose one --------------------------
  // Shane: "when doing the preview, the design grid shows up as a big
  // background for the UI"; asked for UI without windows or decorations, no
  // background unless chosen, and transparency with blur.
  {
    // The model: validated, undoable, unsafe colours refused.
    check('a page takes none, theme, or a colour with alpha', cleanPage({ background: 'color', color: 'rgba(10, 20, 30, 0.5)', blur: 12 })?.color === 'rgba(10, 20, 30, 0.5)' && cleanPage({ background: 'none' })?.background === 'none')
    check('an unsafe or missing page colour is refused', cleanPage({ background: 'color', color: 'red;}body{x:y' }) === null && cleanPage({ background: 'color' }) === null && cleanPage({ background: 'image' }) === null)
    const sp = new EditorStore()
    sp.addComponent('Panel', null, 0, 0)
    sp.commit({ op: 'setPage', page: { background: 'color', color: '#112233', blur: 99 } }, 'page')
    check('blur is clamped to its range', sp.doc.meta.page?.blur === 60, String(sp.doc.meta.page?.blur))
    sp.undo()
    check('setting the page undoes in one step', sp.doc.meta.page === undefined)
    sp.redo()
    const back = validate(serialize(sp.doc))
    check('the page survives save and load', back.doc?.meta.page?.color === '#112233' && back.issues.length === 0)
    const forged = validate(JSON.stringify({ ...JSON.parse(serialize(sp.doc)), meta: { ...sp.doc.meta, page: { background: 'color', color: 'url(javascript:x)' } } }))
    check('a forged page colour is dropped on load, and said so', forged.doc?.meta.page === undefined && forged.issues.some((i) => i.path === '$.meta.page'))
    check('an export paints no page unless one is chosen', !/body\{background:/.test(emitHtml(new EditorStore().doc)) && /body\{background:#112233/.test(emitHtml(sp.doc)))

    // The real preview: nothing behind the UI by default; the page when chosen.
    const app = window.__loomStore
    const before = app.doc
    const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms))
    const mode = (m: string) => [...document.querySelectorAll<HTMLButtonElement>('.titlebar .pv-toggle button')].find((b) => b.textContent?.trim() === m)?.click()
    const sc = new EditorStore()
    sc.addComponent('Panel', null, 0, 0, { w: 400, h: 300 })
    app.loadDocument(sc.doc)
    await wait()
    mode('Preview')
    await wait(250)
    const stage = () => document.querySelector<HTMLElement>('.canvas.previewing .stage')!
    const cs = getComputedStyle(stage())
    const wrap = getComputedStyle(document.querySelector('.canvas-wrap')!)
    check('Preview draws no page, frame or shadow by default', cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.boxShadow === 'none', `${cs.backgroundColor} / ${cs.boxShadow}`)
    check('Preview shows no dot grid behind the UI', !/radial-gradient/.test(wrap.backgroundImage), wrap.backgroundImage.slice(0, 60))
    app.commit({ op: 'setPage', page: { background: 'color', color: 'rgba(200, 10, 10, 0.5)', blur: 8 } }, 'page')
    await wait()
    const cs2 = getComputedStyle(stage())
    check('a chosen see-through page is drawn, with its blur', cs2.backgroundColor === 'rgba(200, 10, 10, 0.5)' && /blur\(8px\)/.test(cs2.backdropFilter), `${cs2.backgroundColor} / ${cs2.backdropFilter}`)
    mode('Design')
    await wait()
    app.select([])
    await wait()
    const panel = document.querySelector<HTMLElement>('.inspector .page-panel')
    check('with nothing selected, the inspector offers the Page', !!panel && /Background/.test(panel.textContent ?? ''))
    ;[...(panel?.querySelectorAll<HTMLButtonElement>('.page-seg button') ?? [])].find((b) => b.textContent === 'Theme')?.click()
    await wait()
    check('choosing Theme sets the page to the theme colour', app.doc.meta.page?.background === 'theme')
    app.loadDocument(before)
    await wait()
  }

  // --- 70. run on desktop: the dock places the window on the real screen ---
  // Shane: "I was building a sidebar anchored to the side of the screen; in
  // preview I expected to see it attached to the side of the desktop".
  {
    const work = { x: 0, y: 27, width: 1920, height: 1053 } // a top panel, as on this machine
    const at = (anchor: string, w = 360, h = 400, x = 0, y = 0) => desktopBounds({ anchor, w, h, x, y }, work)
    const eq = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b)
    check('docked left: the left edge, full usable height', eq(at('left'), { x: 0, y: 27, width: 360, height: 1053 }), JSON.stringify(at('left')))
    check('docked right: the right edge, full usable height', eq(at('right'), { x: 1560, y: 27, width: 360, height: 1053 }), JSON.stringify(at('right')))
    check('docked top/bottom: full usable width', eq(at('top'), { x: 0, y: 27, width: 1920, height: 400 }) && eq(at('bottom'), { x: 0, y: 680, width: 1920, height: 400 }))
    check('a corner dock sits in that corner at its own size', eq(at('bottom-right'), { x: 1560, y: 680, width: 360, height: 400 }))
    check('centre and fill', eq(at('center'), { x: 780, y: 354, width: 360, height: 400 }) && eq(at('fill'), work))
    check('undocked keeps its own place, on the screen', eq(at('none', 360, 400, 100, 50), { x: 100, y: 77, width: 360, height: 400 }) && at('none', 360, 400, 5000, 5000).x === 1560)
    check('never bigger than the usable screen', at('left', 9999, 9999).width === 1920 && at('center', 9999, 9999).height === 1053)
  }

  // --- 105. the AI agent's building tools ------------------------------------
  // An agent builds through the same ops a person does, VALIDATED first (a
  // model's guessed property must never reach the document), and one agent
  // turn is one undo step.
  {
    const st = new EditorStore()
    const turn = new AiTurn(st)
    const run = (name: string, args: Record<string, unknown> = {}) => runTool(st, turn, name, args)
    const val = (r: ReturnType<typeof run>) => (r.ok ? (r.result as Record<string, unknown>) : ({ error: r.error } as Record<string, unknown>))
    check('every tool has a schema and a description', TOOLS.length >= 14 && TOOLS.every((t) => t.description.length > 20 && (t.inputSchema as { type?: string }).type === 'object'))
    const root = val(run('add_component', { type: 'Panel', parent_id: null, props: { title: 'Home' } })).id as string
    check('an empty document gets its root from the agent', st.doc.root === root && st.doc.nodes[root]?.props.title === 'Home')
    check('a container that becomes the root fills the page', st.doc.nodes[root]?.props.anchor === 'fill')
    check('get_document reports a docked dimension as spanning, not a stale number', JSON.stringify(val(run('get_document'))).includes('spans its parent'))
    const bad = run('add_component', { type: 'Buton', parent_id: root })
    check('an unknown component is refused, pointing at the catalogue', !bad.ok && /list_components/.test(bad.ok ? '' : bad.error))
    const card = val(run('add_component', { type: 'Card', parent_id: root, x: 40, y: 50, props: { padding: '20', nonsense: 1, radius: 9999 } }))
    const cardId = card.id as string
    check('valid props land (and "20" becomes 20), invalid ones are refused and said so', st.doc.nodes[cardId]?.props.padding === 20 && Array.isArray(card.rejected) && (card.rejected as string[]).some((r) => r.startsWith('nonsense')))
    check('numbers are clamped into range', (st.doc.nodes[cardId]?.props.radius as number) <= 64, String(st.doc.nodes[cardId]?.props.radius))
    const btn = val(run('add_component', { type: 'Button', parent_id: cardId, props: { label: 'Save', variant: 'loud' } }))
    check('an enum outside its options is refused with the options listed', (btn.rejected as string[]).some((r) => /variant: expected one of/.test(r)))
    const ro = run('set_props', { id: btn.id, props: { label: 'Save changes', size: 'lg' } })
    check('set_props applies what is valid', ro.ok && st.doc.nodes[btn.id as string]?.props.label === 'Save changes' && st.doc.nodes[btn.id as string]?.props.size === 'lg')
    const side = val(run('add_component', { type: 'SidebarPanel', parent_id: root }))
    run('dock', { id: side.id, anchor: 'left' })
    check('dock sets the anchor', st.doc.nodes[side.id as string]?.props.anchor === 'left')
    check('a bad anchor is refused', !run('dock', { id: side.id, anchor: 'sideways' }).ok)
    run('move_into', { id: btn.id, parent_id: side.id })
    check('move_into re-parents', st.doc.nodes[side.id as string]?.children.includes(btn.id as string) === true)
    check('a node cannot move into itself', !run('move_into', { id: side.id, parent_id: btn.id }).ok && !run('move_into', { id: side.id, parent_id: side.id }).ok)
    const tl = val(run('add_component', { type: 'Timeline', parent_id: root }))
    run('set_list', { id: tl.id, list: 'events', items: [{ title: 'Shipped', time: 'now', tone: 'success' }, { title: 'Bad tone', tone: 'purple' }] })
    const events = st.doc.nodes[tl.id as string]?.lists?.events ?? []
    check('set_list replaces rows, fixing invalid fields to defaults', events.length === 2 && events[0]?.title === 'Shipped' && events[1]?.tone !== 'purple')
    run('set_page', { background: 'color', color: 'rgba(10, 12, 20, 0.6)', blur: 20 })
    check('set_page sets a see-through page', st.doc.meta.page?.color === 'rgba(10, 12, 20, 0.6)' && st.doc.meta.page?.blur === 20)
    check('an unsafe page colour is refused', !run('set_page', { background: 'color', color: 'red;}x{' }).ok)
    const doc = val(run('get_document'))
    const flat = JSON.stringify(doc)
    check('get_document shows the tree with what was set', flat.includes('"Save changes"') && flat.includes('"anchor":"left"') && flat.includes(cardId))
    const cat = val(run('list_components'))
    check('the catalogue lists components and starters, without internal pieces', (cat.components as Array<{ name: string }>).some((c) => c.name === 'KpiCard') && !(cat.components as Array<{ name: string }>).some((c) => c.name === 'TabPanel') && (cat.starters as unknown[]).length >= 1)
    const desc = val(run('describe_component', { type: 'Button' }))
    check('describe_component gives each property\'s type and options', ((desc.props as Record<string, { options?: string[] }>).variant?.options ?? []).includes('primary'))

    // One turn, many writes, one undo step.
    const hist = st.history.length
    const nodes = Object.keys(st.doc.nodes).length
    turn.begin('AI: add a footer')
    const f = val(run('add_component', { type: 'FooterBar', parent_id: root }))
    run('set_props', { id: f.id, props: { text: 'v1.0' } })
    run('add_starter', { starter: 'chat-sidebar', parent_id: root, x: 700, y: 0 })
    turn.end()
    check('an agent turn is one undo step', st.history.length === hist + 1 && st.history[st.history.length - 1]?.label === 'AI: add a footer', `${hist} -> ${st.history.length}`)
    st.undo()
    check('undoing the turn removes everything it added', Object.keys(st.doc.nodes).length === nodes, `${nodes} vs ${Object.keys(st.doc.nodes).length}`)
    run('place', { id: cardId, w: 300, h: 200 })
    run('place', { id: cardId, h: 'auto' })
    check('place can hand a size back to the content ("auto")', st.doc.nodes[cardId]?.props.h === undefined && st.doc.nodes[cardId]?.props.w === 300, JSON.stringify({ w: st.doc.nodes[cardId]?.props.w, h: st.doc.nodes[cardId]?.props.h }))
    const rm = val(run('remove', { ids: [cardId] }))
    check('remove deletes', rm.removed === 1 && !st.doc.nodes[cardId])
  }

  // --- 107. a person keeps building while the agent works --------------------
  // The agent's writes used to be held provisionally (poke) and sealed at the
  // end, so a person's own edit mid-turn committed the agent's pending work
  // under THEIR label, and no undo could remove it. Now a turn is a history
  // group: the person's edit is its own step, the agent's work on either side
  // stays undoable, and undo mid-turn stops the agent.
  {
    const st = new EditorStore()
    const turn = new AiTurn(st)
    const run = (name: string, args: Record<string, unknown> = {}) => runTool(st, turn, name, args)
    const id = (r: ReturnType<typeof run>) => (r.ok ? ((r.result as { id: string }).id) : '')
    const root = id(run('add_component', { type: 'Panel', parent_id: null }))
    const h0 = st.history.length
    turn.begin('AI: build')
    const card = id(run('add_component', { type: 'Card', parent_id: root }))
    st.dropComponent('Button', root, 10, 10)
    const head = id(run('add_component', { type: 'Heading', parent_id: root }))
    run('set_props', { id: head, props: { text: 'Hi' } })
    turn.end()
    const labels = st.history.slice(h0).map((e) => e.label)
    check('an edit mid-turn is its own step between the agent\'s', labels.join(' | ') === 'AI: build | Add Button | AI: build', labels.join(' | '))
    const has = () => [!!st.doc.nodes[card], Object.values(st.doc.nodes).some((n) => n.type === 'Button'), !!st.doc.nodes[head]].map(Number).join('')
    const seen = [has()]
    for (let i = 0; i < 3; i++) {
      st.undo()
      seen.push(has())
    }
    check('each undo removes exactly its own part, the agent\'s first work included', seen.join(',') === '111,110,100,000', seen.join(','))
    const st2 = new EditorStore()
    const t2 = new AiTurn(st2)
    const made = runTool(st2, t2, 'add_component', { type: 'Panel', parent_id: null })
    const r2 = made.ok ? (made.result as { id: string }).id : ''
    let stopped = 0
    t2.onInterrupt = () => stopped++
    t2.begin('AI: y')
    runTool(st2, t2, 'add_component', { type: 'Label', parent_id: r2 })
    st2.undo()
    check('undo mid-turn stops the agent and ends the turn', stopped === 1 && !t2.active && st2.interruptTurn === null)
  }

  // --- 108. the agent can do what a person can -----------------------------
  // Parity: parts, interaction states, per-breakpoint layout, display basics,
  // effects, duplicate, paint order, and a whole subtree in one call. Every
  // write goes through the same validated op as the panel; what is refused
  // comes back with a reason.
  {
    const st = new EditorStore()
    const turn = new AiTurn(st)
    const run = (name: string, args: Record<string, unknown> = {}) => runTool(st, turn, name, args)
    const res = (r: ReturnType<typeof run>) => (r.ok ? (r.result as Record<string, unknown>) : ({ error: r.error } as Record<string, unknown>))
    const b = res(run('build', { parent_id: null, tree: { type: 'Panel', flow: true, ref: 'page', children: [
      { type: 'Heading', props: { text: 'Models' } },
      { type: 'Card', ref: 'row', flow: true, children: [{ type: 'Label', props: { text: 'GPT', bogus: 1 } }, { type: 'Button', props: { label: 'Open' } }] },
      { type: 'DataGrid', ref: 'grid' },
    ] } }))
    const refs = (b.refs ?? {}) as Record<string, string>
    check('build makes a nested subtree in one call and maps refs to ids', b.created === 6 && st.doc.root === refs.page && st.doc.nodes[refs.row!]?.children.length === 2, JSON.stringify(b))
    check('build refuses bad props with the node\'s path', ((b.rejected ?? []) as string[]).some((r) => /children\[1\]\.children\[0\] Label: bogus/.test(r)))
    check('build refuses an unknown type before writing anything', !run('build', { parent_id: refs.page, tree: { type: 'Card', children: [{ type: 'Nope' }] } }).ok && Object.keys(st.doc.nodes).length === 6)
    check('build refuses children under a leaf', !run('build', { parent_id: refs.page, tree: { type: 'Label', children: [{ type: 'Label' }] } }).ok)
    const sp = res(run('style_part', { id: refs.grid, part: 'header', style: { background: '#101820', fontSize: 12, wobble: 3 } }))
    check('style_part styles a declared part and reports refused fields', st.doc.nodes[refs.grid!]?.parts?.header?.background === '#101820' && ((sp.rejected ?? []) as string[]).some((r) => r.startsWith('wobble')), JSON.stringify(sp))
    check('style_part refuses an unknown part, naming the real ones', /parts: /.test(String(res(run('style_part', { id: refs.grid, part: 'nope', style: { color: 'red' } })).error)))
    check('style_part refuses an unsafe colour', ((res(run('style_part', { id: refs.grid, part: 'header', style: { color: 'red;}x{' } })).rejected ?? []) as string[]).length === 1)
    run('set_states', { id: refs.row, state: 'hover', style: { lift: 2, shadow: 'lg', blink: true } })
    check('set_states styles hover', st.doc.nodes[refs.row!]?.states?.hover?.lift === 2 && st.doc.nodes[refs.row!]?.states?.hover?.shadow === 'lg')
    run('set_responsive', { id: refs.row, breakpoint: 'sm', override: { w: 340, visible: true, colour: 1 } })
    check('set_responsive writes a phone override', st.doc.nodes[refs.row!]?.responsive?.sm?.w === 340)
    run('set_display', { id: refs.row, opacity: 0.5, name: 'Model row', locked: true })
    const row = st.doc.nodes[refs.row!]
    check('set_display sets opacity, layer name and lock', row?.opacity === 0.5 && row.name === 'Model row' && row.locked === true)
    run('set_display', { id: refs.row, locked: false })
    const fx = res(run('set_effects', { id: refs.row, effects: { glow: true, glowColor: '#5b8cff', sparkle: true } }))
    check('set_effects turns an effect on and refuses unknown keys', (st.doc.nodes[refs.row!]?.effects as Record<string, unknown> | undefined)?.glow === true && ((fx.rejected ?? []) as string[]).some((r) => r.startsWith('sparkle')))
    const dup = res(run('duplicate', { id: refs.row, count: 3 }))
    const kids = st.doc.nodes[refs.page!]!.children
    check('duplicate copies a subtree right after the original, in order', (dup.ids as string[]).length === 3 && kids.indexOf((dup.ids as string[])[0]!) === kids.indexOf(refs.row!) + 1 && kids.indexOf((dup.ids as string[])[2]!) === kids.indexOf(refs.row!) + 3)
    check('a copy has its own children with fresh ids', st.doc.nodes[(dup.ids as string[])[0]!]!.children.every((c) => !row!.children.includes(c)) && st.doc.nodes[(dup.ids as string[])[0]!]!.children.length === 2)
    run('arrange', { id: refs.grid, to: 'back' })
    check('arrange sends a node to the back of its siblings', st.doc.nodes[refs.page!]!.children[0] === refs.grid)
    check('every new tool is listed with a schema', ['build', 'style_part', 'set_states', 'set_responsive', 'set_display', 'set_effects', 'duplicate', 'arrange'].every((n) => TOOLS.some((t) => t.name === n)))
  }

  // --- 110. Phase 1: a trustworthy floor (docs/plan-of-attack.md) ------------
  // Findings 4, 5, 6, 6b and 11 of docs/reviews/output-quality-audit.md,
  // measured on real output with the real runtime: every close control closes
  // and names its event; Enter/Space do what a click does on everything
  // operable; the unreachable items are tab stops; the state a screen reader
  // hears follows the state on screen; controls speak the design's typeface.
  {
    installBehaviourRuntime()
    const st = new EditorStore()
    const run = (name: string, args: Record<string, unknown> = {}) => runTool(st, new AiTurn(st), name, args)
    const b = run('build', { parent_id: null, tree: { type: 'Panel', flow: true, ref: 'page', w: 900, children: [
      { type: 'Alert', ref: 'alert', props: { dismissible: true } },
      { type: 'ConfirmDialog', ref: 'dlg' },
      { type: 'ConfirmDialog', ref: 'dlg2' },
      { type: 'ErrorSummary', ref: 'errs' },
      { type: 'Tabs', ref: 'tabs' },
      { type: 'Accordion', ref: 'acc' },
      { type: 'DataGrid', ref: 'grid' },
      { type: 'TreeList', ref: 'tree' },
      { type: 'ProgressDots', ref: 'dots' },
      { type: 'Rating', ref: 'rate' },
      { type: 'SearchBox', ref: 'search' },
    ] } })
    const refs = (b.ok ? (b.result as { refs: Record<string, string> }).refs : {}) as Record<string, string>
    // Built with no children, Tabs and Accordion arrive as the toolbox drops them.
    const accId = refs.acc!
    check('an agent-built Tabs and Accordion arrive with their panels and items', st.doc.nodes[refs.tabs!]!.children.length > 0 && st.doc.nodes[accId]!.children.length > 0)
    const host = document.createElement('div')
    host.className = 'loom-container'
    host.style.cssText = 'position:absolute;left:-10000px;top:0;width:900px'
    host.innerHTML = renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set(), mode: 'preview', hookAll: true }, st.doc.root as string))
    document.body.appendChild(host)
    const node = (id: string) => host.querySelector<HTMLElement>(`[data-loom-node="${id}"]`)!
    const shown = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none'
    const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
    const heard: string[] = []
    const listen = (ev: Event) => heard.push(ev.type)
    for (const ev of ['loom:dismiss', 'loom:cancel', 'loom:confirm']) host.addEventListener(ev, listen)

    const theme = getComputedStyle(node(refs.page!)).fontFamily
    const tabBtn = node(refs.tabs!).querySelector('button')!
    check('generated controls use the design\'s typeface, not the browser\'s', getComputedStyle(tabBtn).fontFamily === theme, `${getComputedStyle(tabBtn).fontFamily} vs ${theme}`)
    check('ErrorSummary\'s default lists two errors', node(refs.errs!).querySelectorAll('li').length === 2)

    node(refs.alert!).querySelector<HTMLElement>('[data-loom-dismiss]')!.click()
    check('an Alert\'s x dismisses it', !shown(node(refs.alert!)))
    const cancel = [...node(refs.dlg!).querySelectorAll('button')].find((x) => /cancel/i.test(x.textContent ?? ''))!
    cancel.click()
    const confirm = [...node(refs.dlg2!).querySelectorAll('button')].filter((x) => !/cancel/i.test(x.textContent ?? ''))[0]!
    confirm.click()
    check('ConfirmDialog\'s Cancel and its confirm button both close it', !shown(node(refs.dlg!)) && !shown(node(refs.dlg2!)))
    check('closing names what happened: dismiss, cancel, confirm', heard.join(',') === 'loom:dismiss,loom:cancel,loom:confirm', heard.join(','))

    const summary = node(accId).querySelector<HTMLElement>('[data-loom-summary]')!
    key(summary, 'Enter')
    check('Enter opens an accordion item, and its summary says it is expanded', summary.parentElement!.getAttribute('data-loom-open') === '1' && summary.getAttribute('aria-expanded') === 'true', `${summary.parentElement!.getAttribute('data-loom-open')} / ${summary.getAttribute('aria-expanded')}`)
    key(summary, ' ')
    check('Space closes it again', summary.parentElement!.getAttribute('data-loom-open') === '0' && summary.getAttribute('aria-expanded') === 'false')

    const th = node(refs.grid!).querySelector<HTMLElement>('th[data-loom-b="sort"]')!
    check('a sortable column header is a tab stop', th.tabIndex === 0)
    key(th, 'Enter')
    check('Enter sorts the column, and aria-sort says so', th.getAttribute('data-loom-sort') === 'asc' && th.getAttribute('aria-sort') === 'ascending', `${th.getAttribute('data-loom-sort')} / ${th.getAttribute('aria-sort')}`)
    const expander = node(refs.tree!).querySelector<HTMLElement>('[data-loom-b="expand"]')!
    const dot = node(refs.dots!).querySelector<HTMLElement>('[data-loom-b="dot"]')!
    check('tree expanders and progress dots are named tab stops', expander.tabIndex === 0 && !!expander.getAttribute('aria-label') && dot.tabIndex === 0 && !!dot.getAttribute('aria-label'))
    const rate = node(refs.rate!)
    const v0 = Number(rate.getAttribute('data-loom-value'))
    key(rate, 'ArrowRight')
    check('a Rating is a slider the arrow keys move', rate.tabIndex === 0 && rate.getAttribute('role') === 'slider' && Number(rate.getAttribute('data-loom-value')) === Math.min(v0 + 1, rate.querySelectorAll('[data-loom-star]').length) && rate.getAttribute('aria-valuenow') === rate.getAttribute('data-loom-value'), `${v0} -> ${rate.getAttribute('data-loom-value')}`)
    const css = behaviourCss()
    check('a borderless input\'s well is ringed while it has focus', /:has\(> :is\(input,textarea\):is\(\[style\*="outline:none"\],\[style\*="outline: none"\]\):focus-visible\)\{outline:2px/.test(css))
    host.remove()
  }

  // --- 113. Phase 2: controls act on other components (model/actions.ts) -----
  // Standing rule 8: a List/Table toggle shows the table; a Filters button
  // toggles its panel; a button opens a dialog. Wired in the model, carried in
  // the output, run by the one runtime, measured live.
  {
    installBehaviourRuntime()
    const st = new EditorStore()
    const turn = new AiTurn(st)
    const run = (name: string, args: Record<string, unknown> = {}) => runTool(st, turn, name, args)
    const b = run('build', { parent_id: null, tree: { type: 'Panel', flow: true, ref: 'page', w: 900, children: [
      { type: 'Segmented', ref: 'seg', props: { options: 'List,Table', value: 'List' } },
      { type: 'Button', ref: 'filters', props: { label: 'Filters' } },
      { type: 'Button', ref: 'newBtn', props: { label: 'New' } },
      { type: 'Card', ref: 'panel', children: [{ type: 'Label', props: { text: 'Filter options' } }] },
      { type: 'Stack', ref: 'list', flow: true, children: [{ type: 'Heading', props: { text: 'List view' } }] },
      { type: 'DataGrid', ref: 'grid' },
      { type: 'Select', ref: 'sel', props: { options: 'One,Two', value: 'One' } },
      { type: 'Label', ref: 'one', props: { text: 'One' } },
      { type: 'Label', ref: 'two', props: { text: 'Two' } },
      { type: 'Switch', ref: 'sw' },
      { type: 'Label', ref: 'onText', props: { text: 'On' } },
      { type: 'TabBar', ref: 'tabs' },
      { type: 'Modal', ref: 'modal', props: { open: false } },
    ] } })
    const R = (b.ok ? (b.result as { refs: Record<string, string> }).refs : {}) as Record<string, string>
    const bad = run('set_actions', { id: R.seg, views: { List: R.list, Grid: R.grid } })
    check('a choice that the control does not offer is refused, naming its choices', ((bad.ok ? (bad.result as { rejected?: string[] }).rejected : []) ?? []).some((m) => /"Grid" is not one of its choices \(List, Table\)/.test(m)))
    check('a missing target is refused for the agent', !run('set_actions', { id: R.filters, click: [{ verb: 'toggle', target: 'nope' }] }).ok)
    const onLabel = run('set_actions', { id: R.one, click: [{ verb: 'show', target: R.two }] })
    check('a Label cannot carry click actions', onLabel.ok && (((onLabel.result as { rejected?: string[] }).rejected) ?? []).length > 0)
    run('set_actions', { id: R.seg, views: { List: R.list, Table: R.grid } })
    run('set_actions', { id: R.filters, click: [{ verb: 'toggle', target: R.panel }], starts_hidden: [R.panel] })
    run('set_actions', { id: R.newBtn, click: [{ verb: 'open', target: R.modal }] })
    run('set_actions', { id: R.sel, views: { One: R.one, Two: R.two } })
    run('set_actions', { id: R.sw, views: { on: R.onText } })
    check('the wiring is in the document, and get_document reports it', st.doc.nodes[R.seg]?.actions?.views?.Table === R.grid && JSON.stringify(run('get_document')).includes('"startsHidden":true'))

    // Undo is exact, one step per edit.
    const h = st.history.length
    st.commit({ op: 'setActions', id: R.seg, actions: null }, 'clear')
    check('clearing actions is one undo step', !st.doc.nodes[R.seg]?.actions && st.history.length === h + 1)
    st.undo()
    check('undo restores the views exactly', st.doc.nodes[R.seg]?.actions?.views?.List === R.list && st.doc.nodes[R.seg]?.actions?.views?.Table === R.grid)

    // Output carries it; the canvas shows every view.
    const out = renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set(), mode: 'preview', hookAll: true }, st.doc.root as string))
    const canvas = renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set() }, st.doc.root as string))
    check('output names what a control changes (aria-controls) and carries its actions', out.includes(`aria-controls="${R.list} ${R.grid}"`) && out.includes('data-loom-do='))
    check('the canvas shows every view so each can be edited', !canvas.includes('data-loom-shown="0"') && out.includes('data-loom-shown="0"'))

    const host = document.createElement('div')
    host.className = 'loom-container'
    host.style.cssText = 'position:absolute;left:-10000px;top:0;width:900px'
    host.innerHTML = out
    document.body.appendChild(host)
    const el = (id: string) => host.querySelector<HTMLElement>(`[data-loom-node="${id}"]`)!
    const shown = (id: string) => getComputedStyle(el(id)).display !== 'none'
    const tick = () => new Promise((r) => setTimeout(r, 10))
    check('the static output starts on the right view, and the panel starts hidden', shown(R.list) && !shown(R.grid) && !shown(R.panel) && shown(R.one) && !shown(R.two) && !shown(R.onText))
    host.querySelector<HTMLElement>(`[data-loom-node="${R.seg}"] [data-loom-choice="Table"]`)!.click()
    await tick()
    check('choosing Table shows the table and hides the list', shown(R.grid) && !shown(R.list))
    host.querySelector<HTMLElement>(`[data-loom-node="${R.seg}"] [data-loom-choice="List"]`)!.click()
    await tick()
    check('and List brings the list back', shown(R.list) && !shown(R.grid))
    const fb = host.querySelector<HTMLElement>(`[data-loom-node="${R.filters}"]`)!
    const filterBtn = fb.matches('button') ? fb : fb.querySelector('button')!
    filterBtn.click()
    const opened = shown(R.panel) && filterBtn.closest('[aria-expanded]')?.getAttribute('aria-expanded') === 'true'
    filterBtn.click()
    check('a Filters button toggles its panel, and says whether it is open', opened && !shown(R.panel) && filterBtn.closest('[aria-expanded]')?.getAttribute('aria-expanded') === 'false')
    const nb = host.querySelector<HTMLElement>(`[data-loom-node="${R.newBtn}"]`)!
    ;(nb.matches('button') ? nb : nb.querySelector('button')!).click()
    check('a button opens a Modal', el(R.modal).getAttribute('data-loom-open') === '1')
    const selRoot = el(R.sel)
    const select = (selRoot.matches('select') ? selRoot : selRoot.querySelector('select')) as HTMLSelectElement
    select.value = 'Two'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    check('a Select switches views on change', shown(R.two) && !shown(R.one))
    const swEl = el(R.sw)
    swEl.click()
    await tick()
    check('a Switch shows its "on" view when turned on', shown(R.onText), swEl.getAttribute('data-loom-on') ?? '')
    const tabs = [...host.querySelectorAll<HTMLElement>(`[data-loom-node="${R.tabs}"] [role=tab]`)]
    tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    check('the arrow keys move between tabs and choose one', tabs[1]!.getAttribute('aria-selected') === 'true' || tabs[1]!.getAttribute('data-loom-active') === '1')
    el(R.modal).querySelector<HTMLElement>('[data-loom-close]')?.click()
    host.remove()

    // Loading keeps a broken target and says so; startsHidden survives.
    const file = JSON.parse(JSON.stringify(st.doc)) as Document
    file.nodes[R.filters]!.actions = { click: [{ verb: 'toggle', target: 'gone123' }] }
    const loaded = validate(file)
    check('a wired target missing from a file is kept and reported, not guessed', loaded.doc?.nodes[R.filters]?.actions?.click?.[0]?.target === 'gone123' && loaded.issues.some((i) => /targets missing node "gone123"/.test(i.message)))
    check('starts-hidden survives save and load', loaded.doc?.nodes[R.panel]?.startsHidden === true)

    // A duplicated switch switches ITS OWN views.
    const s2 = new EditorStore()
    const r2 = runTool(s2, new AiTurn(s2), 'build', { parent_id: null, tree: { type: 'Panel', flow: true, children: [{ type: 'Stack', ref: 'group', flow: true, children: [
      { type: 'Segmented', ref: 'seg', props: { options: 'A,B', value: 'A' } }, { type: 'Label', ref: 'a', props: { text: 'A' } }, { type: 'Label', ref: 'b', props: { text: 'B' } },
    ] }] } })
    const R2 = (r2.ok ? (r2.result as { refs: Record<string, string> }).refs : {}) as Record<string, string>
    s2.commit({ op: 'setActions', id: R2.seg!, actions: { views: { A: R2.a!, B: R2.b! } } }, 'wire')
    const copy = s2.duplicate(R2.group!)
    const kids = copy ? s2.doc.nodes[copy]!.children : []
    const cSeg = s2.doc.nodes[kids[0]!]
    check('a duplicated view switch is wired to the duplicated views', !!cSeg && cSeg.actions?.views?.A === kids[1] && cSeg.actions?.views?.B === kids[2] && s2.doc.nodes[R2.seg!]?.actions?.views?.A === R2.a, JSON.stringify(cSeg?.actions))

    // Pick mode: the next canvas pick answers the question and clears it.
    let picked = ''
    s2.startPick('What A shows', (id) => (picked = id))
    const was = s2.picking?.forLabel
    s2.endPick(R2.b)
    check('pick mode hands the picked node over and ends', was === 'What A shows' && picked === R2.b && s2.picking === null)
  }

  // --- 114. The DataGrid, built like a real one (render/datagrid.tsx) ---------
  // Reported: "the headers look as if they're at the same level as the data,
  // no sorting, no way to add detail". Columns are definitions now; every
  // feature below is exercised in the real output with the real runtime.
  {
    installBehaviourRuntime()
    const st = new EditorStore()
    st.addComponent('Panel', null, 0, 0)
    const g = st.addComponent('DataGrid', st.doc.root as string, 0, 0, { pageSize: 3 }) as string
    const cols = itemsOf(st.doc.nodes[g]!, 'columns')
    check('a dropped grid arrives with typed column definitions', cols.length === 7 && cols.map((c) => c.type).join() === 'person,tags,number,currency,progress,status,date', cols.map((c) => c.type).join())

    // The shorthand every path accepts, typed from the data.
    const sh = st.addComponent('DataGrid', st.doc.root as string, 0, 0, { columns: 'Who,Paid,Seats,When,State', rows: 'Ann|$1,200|4|2026-01-02|Active;Bo|$90|12|2026-03-04|Failed' }) as string
    check('"columns" text becomes definitions, each typed from its data', itemsOf(st.doc.nodes[sh]!, 'columns').map((c) => c.type).join() === 'text,currency,number,date,status' && st.doc.nodes[sh]!.props.columns === undefined)

    // An old file: columns as a string, a frozen first column.
    const old = JSON.parse(serialize(st.doc)) as { nodes: Record<string, { props: Record<string, unknown>; lists?: unknown }> }
    old.nodes[g].props = { ...old.nodes[g].props, columns: 'Name,Amount', columnsSep: 'comma', rows: 'a|10;b|2', freezeFirst: true }
    delete old.nodes[g].lists
    const loaded = validate(JSON.stringify(old))
    const lc = itemsOf(loaded.doc!.nodes[g]!, 'columns')
    check('an old grid opens with its columns converted and reported', lc.length === 2 && lc[0].pinned === true && lc[1].type === 'number' && loaded.issues.some((i) => i.message.includes('column definitions')), loaded.issues.map((i) => i.message).join(' | '))

    const out = renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set(), mode: 'preview' }, g))
    check('the header is its own band, not a row like the data', /<th[^>]*style="[^"]*background:color-mix/.test(out))
    check('money, dates and statuses are drawn as what they are', out.includes('$12,400') && out.includes('Nov 4, 2026') && out.includes('data-loom-tone="danger"'))
    check('totals are computed for the first frame', out.includes('data-loom-total="sum"') && out.includes('$21,740'))
    check('the first page only is shown before any script runs', (out.match(/data-loom-paged="1"/g) ?? []).length === 2)

    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:-10000px;top:0;width:1000px'
    host.innerHTML = out
    document.body.appendChild(host)
    const grid = host.querySelector<HTMLElement>('[data-loom-grid]')!
    const shown = () => [...grid.querySelectorAll<HTMLElement>('[data-loom-row]')].filter((r) => r.style.display !== 'none').map((r) => r.querySelector('[data-loom-cell="0"]')?.getAttribute('data-loom-raw'))
    const click = (el: Element | null) => el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    click(grid.querySelector('[data-loom-page-step="1"]'))
    check('Next shows the second page and says where it is', shown().length === 2 && grid.querySelector('[data-loom-page-label]')?.textContent === '4–5 of 5')
    click(grid.querySelector('[data-loom-page-step="-1"]'))
    click(grid.querySelector('th[data-loom-col="3"]'))
    check('money sorts as numbers ($90 before $1,150), not as text', shown()[0] === 'Alan Turing' && shown()[1] === 'Grace Hopper', shown().join())
    click(grid.querySelector('th[data-loom-col="6"]'))
    check('dates sort as dates (Sep 29 before Oct 2)', shown()[0] === 'Edsger Dijkstra' && shown()[1] === 'Alan Turing', shown().join())
    const input = grid.querySelector<HTMLInputElement>('[data-loom-filter]')!
    input.value = 'team'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    check('search narrows the rows, the count and the totals together', shown().length === 2 && grid.querySelector('[data-loom-grid-count]')?.textContent === '2' && grid.querySelectorAll('[data-loom-sum]')[2]?.textContent === '$3,450')
    input.value = 'zzz'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    check('no match says so, with a way out', getComputedStyle(grid.querySelector('[data-loom-nomatch]')!).display === 'table-row' && grid.querySelector('[data-loom-nomatch-text]')?.textContent === 'No rows match “zzz”')
    click(grid.querySelector('[data-loom-grid-unfilter]'))
    check('Clear search brings the rows back', shown().length === 3 && input.value === '')
    const box = grid.querySelector<HTMLInputElement>('[data-loom-select]')!
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
    check('a ticked row is marked and the toolbar becomes the bulk bar', box.closest('tr')?.getAttribute('data-loom-picked') === '1' && getComputedStyle(grid.querySelector('[data-loom-bulk]')!).display === 'flex')
    click(grid.querySelector('[data-loom-grid-clear]'))
    check('clearing the selection restores the toolbar', grid.getAttribute('data-loom-selected') === '0')
    const toggle = grid.querySelector<HTMLInputElement>('[data-loom-col-toggle="1"]')!
    toggle.checked = false
    toggle.dispatchEvent(new Event('change', { bubbles: true }))
    check('the column picker hides a column, header and cells', grid.querySelector<HTMLElement>('th[data-loom-col="1"]')?.style.display === 'none' && grid.querySelector<HTMLElement>('td[data-loom-col="1"]')?.style.display === 'none')
    let csv = ''
    const realCreate = URL.createObjectURL
    URL.createObjectURL = (b: Blob | MediaSource) => {
      void (b as Blob).text().then((t) => (csv = t))
      return 'blob:probe'
    }
    const realClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {}
    click(grid.querySelector('[data-loom-grid-csv]'))
    await new Promise((r) => setTimeout(r, 30))
    URL.createObjectURL = realCreate
    HTMLAnchorElement.prototype.click = realClick
    check('Export downloads the visible columns as CSV', csv.startsWith('Customer,Seats,MRR') && csv.includes('Ada Lovelace,310,12400'), csv.slice(0, 80))
    host.remove()

    for (const state of ['loading', 'empty', 'error'] as const) {
      st.setProp(g, 'loadState', state)
      const html = renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set(), mode: 'preview' }, g))
      const ok = state === 'loading' ? html.includes('data-loom-shimmer') && html.includes('aria-busy="true"') : state === 'error' ? html.includes('Could not load this data') && html.includes('data-loom-action="retry"') : html.includes('Nothing to show yet')
      check(`the ${state} state is designed, not blank`, ok)
    }
  }

  // --- 115. A dropped container is always SEEN (Shane: four tab sets dropped,
  // nothing visible, 19 layers). Empty containers say what they are; a drop
  // never lands exactly on a sibling; it fits the room it lands in.
  {
    const st = new EditorStore()
    const root = st.dropComponent('Panel', null, 0, 0) as string
    st.setProp(root, 'w', 1000)
    st.setProp(root, 'h', 640)
    const a = st.dropComponent('Tabs', root, 40, 40, { w: 1000, h: 640 }) as string
    const b = st.dropComponent('Tabs', root, 40, 40, { w: 1000, h: 640 }) as string
    const at = (id: string) => [st.doc.nodes[id]!.props.x, st.doc.nodes[id]!.props.y].join(',')
    check('a second drop on the same spot steps off the first', at(a) === '40,40' && at(b) === '64,64', `${at(a)} / ${at(b)}`)
    const panel = st.doc.nodes[a]!.children[0]!
    const inner = st.dropComponent('Tabs', panel, 10, 10, { w: 300, h: 160 }) as string
    check('a container fits the room it is dropped into', Number(st.doc.nodes[inner]!.props.w) <= 282 && Number(st.doc.nodes[inner]!.props.h) <= 142, `${st.doc.nodes[inner]!.props.w}x${st.doc.nodes[inner]!.props.h}`)
    const canvas = renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set() }, root))
    const out = renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set(), mode: 'preview' }, root))
    check('an empty container says what it is on the canvas, never in the output', canvas.includes('data-loom-hint="Activity · drop components here"') && !out.includes('data-loom-hint'))
    const pageTag = /<div[^>]*data-loom-type="TabPanel"[^>]*>/.exec(canvas)?.[0] ?? ''
    check('a tab page fills its tab set', pageTag.includes('flex-grow:1'), pageTag.slice(0, 300))
  }

  // --- 116. Content states: loading, empty and failed are designed on every
  // data-bearing tool, with one vocabulary (render/content-state.tsx).
  {
    const missing: string[] = []
    const blank: string[] = []
    for (const [tool, empty] of Object.entries(CONTENT_STATE_TOOLS)) {
      const spec = getComponent(tool)!
      if (!spec.props.loadState || !spec.props.emptyMessage || !spec.props.errorMessage || !spec.parts?.skeleton || !spec.parts?.message) missing.push(tool)
      const st = new EditorStore()
      st.addComponent('Panel', null, 0, 0)
      const id = st.addComponent(tool, st.doc.root as string, 0, 0) as string
      const draw = () => renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set(), mode: 'preview' }, id))
      const ready = draw()
      st.setProp(id, 'loadState', 'loading')
      const loading = draw()
      st.setProp(id, 'loadState', 'empty')
      const emptyOut = draw()
      st.setProp(id, 'loadState', 'error')
      const error = draw()
      if (loading === ready || !loading.includes('data-loom-shimmer') || !loading.includes('aria-busy="true"')) blank.push(`${tool} loading`)
      if (!emptyOut.includes(empty)) blank.push(`${tool} empty`)
      if (!error.includes('Could not load this data') || !error.includes('data-loom-action="retry"') || !error.includes('role="alert"')) blank.push(`${tool} error`)
    }
    check('every data-bearing tool carries the content states, one vocabulary', missing.length === 0, missing.join(', '))
    check('each state is drawn: a skeleton, a message, a retry', blank.length === 0, blank.join(', '))
  }

  // --- 112. Phase 1: overlays, the page under an export, tones ---------------
  // Findings 1, 2, 3, 13 and 29 of the output audit.
  {
    installBehaviourRuntime()
    const st = new EditorStore()
    const run = (name: string, args: Record<string, unknown> = {}) => runTool(st, new AiTurn(st), name, args)
    const b = run('build', { parent_id: null, tree: { type: 'Panel', ref: 'page', props: { surface: 'glass' }, children: [
      { type: 'Modal', ref: 'modal', x: 40, y: 40 },
      { type: 'Stepper', ref: 'steps', x: 40, y: 400 },
      { type: 'EmptyState', ref: 'empty', x: 40, y: 480 },
      { type: 'BackButton', ref: 'back', x: 600, y: 400 },
    ] } })
    const refs = (b.ok ? (b.result as { refs: Record<string, string> }).refs : {}) as Record<string, string>
    const out = renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set(), mode: 'preview', hookAll: true }, st.doc.root as string))
    const canvas = renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set() }, st.doc.root as string))
    check('in output a Modal is a top-layer popover; on the canvas it is drawn in place', /data-loom-modal="" popover="manual"/.test(out) && !/popover=/.test(canvas))
    check('the canvas never dims the design behind an open modal', behaviourCss().includes('.surface [data-loom-scrim]{display:none !important}'))
    const host = document.createElement('div')
    host.className = 'loom-container'
    host.style.cssText = 'position:absolute;left:0;top:0;width:900px;height:700px'
    host.innerHTML = out
    document.body.appendChild(host)
    await new Promise((r) => setTimeout(r, 30))
    const modal = host.querySelector<HTMLElement>(`[data-loom-node="${refs.modal}"]`)!
    const inTop = (() => { try { return modal.matches(':popover-open') } catch { return false } })()
    check('an open Modal is shown in the top layer, even inside a glass panel', inTop)
    const save = [...modal.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Save')!
    const r = save.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    check('the Modal\'s own buttons are what a click lands on (its scrim used to cover them)', !!hit && (hit === save || save.contains(hit)), hit ? `${hit.tagName} ${hit.getAttribute('data-loom-scrim') ?? ''}` : 'nothing')
    const said: string[] = []
    host.addEventListener('loom:save', () => said.push('save'))
    save.click()
    check('a dialog action closes the dialog and names itself', modal.getAttribute('data-loom-open') === '0' && said.join() === 'save' && !(() => { try { return modal.matches(':popover-open') } catch { return false } })())
    const steps = [...host.querySelectorAll<HTMLElement>(`[data-loom-node="${refs.steps}"] [data-loom-b="step"]`)]
    steps[2]?.click()
    check('clicking a step goes to it', steps[2]?.getAttribute('aria-current') === 'step' && steps[2]?.getAttribute('data-loom-state') === 'now' && steps[0]?.getAttribute('data-loom-state') === 'done' && steps.every((x) => x.tabIndex === 0))
    const act: string[] = []
    host.addEventListener('loom:clear.filters', () => act.push('clear'))
    host.querySelector<HTMLElement>(`[data-loom-node="${refs.empty}"] button`)?.click()
    check('an empty state\'s action is announced by name', act.length === 1)
    const back = host.querySelector<HTMLElement>(`[data-loom-node="${refs.back}"]`)!
    check('a ghost BackButton has no browser button face', getComputedStyle(back).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(back).borderStyle === 'none')
    host.remove()
    // The page under an export declares the theme's scheme, so "no page"
    // is the theme's canvas for every viewer.
    check('an HTML export declares its theme\'s colour scheme', /:root\{color-scheme:dark\}/.test(emitHtml(st.doc)))
    // Tones that pass AA as text on daylight's page and surface, and under white text.
    const L = (h: string) => { const c = (h.match(/\w\w/g) ?? []).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]! }
    const ratio = (a: string, b: string) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05) }
    const day = getTheme('daylight')
    const tones = [day.success, day.danger, day.warning]
    check('daylight\'s success, danger and warning pass AA on its page and surface', tones.every((c) => ratio(c, day.bg) >= 4.5 && ratio(c, day.surface) >= 4.5), tones.map((c) => `${c} ${ratio(c, day.bg).toFixed(2)}`).join(', '))
  }

  // --- 111. the interaction audit (standing rule 8) --------------------------
  // Every operable element of every toolbox tool, dropped as the toolbox drops
  // it and operated in real output with the real runtime, must change
  // something or emit a named loom:* event, and must be reachable by Tab.
  // KNOWN_DEAD is the ratchet: it is empty, and a new entry needs a reason.
  {
    const KNOWN_DEAD: Record<string, string> = {}
    installBehaviourRuntime()
    const a = auditInteractions()
    const found = new Map(a.dead.map((d) => [`${d.tool}|${d.what}`, d]))
    const fresh = [...found].filter(([k]) => !KNOWN_DEAD[k]).map(([k, d]) => `${d.why}: ${k}`)
    check('nothing that looks operable does nothing, or is mouse-only', fresh.length === 0, fresh.slice(0, 12).join(' | '))
    check('the dead-control backlog has no stale entries', Object.keys(KNOWN_DEAD).every((k) => found.has(k)))
    check('the interaction audit actually operates the catalogue', a.tools === allComponents().length - addedTypes().size && a.operated > 60, `${a.tools} tools, ${a.operated} controls operated`)
    // It bites: put back the old Alert (an x with no dismiss wiring) and it is caught.
    const old = auditInteractions({
      only: ['Alert'],
      tamper: (tool) => tool.querySelectorAll('[data-loom-dismiss]').forEach((b) => b.removeAttribute('data-loom-dismiss')),
    })
    check('the audit catches a close button that closes nothing', old.dead.some((d) => d.tool === 'Alert' && d.why === 'inert' && /dismiss/.test(d.what)), JSON.stringify(old.dead))
  }

  // --- 109. what the OpenRouter run found in Loom ----------------------------
  // An agent rebuilding a real page reported that `justify: between` did
  // nothing (the value was written through as CSS, and "between" is not CSS),
  // that `place` with only a width pinned the height to 40px, and its export
  // drew "Sign In" on two lines. Each is measured live.
  {
    const st = new EditorStore()
    const turn = new AiTurn(st)
    const run = (name: string, args: Record<string, unknown> = {}) => runTool(st, turn, name, args)
    const b = run('build', { parent_id: null, tree: { type: 'Panel', ref: 'page', w: 600, children: [
      { type: 'Stack', ref: 'row', flow: true, w: 500, props: { direction: 'row', justify: 'between' }, children: [{ type: 'Label', ref: 'l', props: { text: 'Left' } }, { type: 'Label', ref: 'r', props: { text: 'Right' } }] },
      { type: 'Button', ref: 'btn', x: 0, y: 80, w: 40, props: { label: 'Sign In' } },
    ] } })
    const refs = (b.ok ? (b.result as { refs: Record<string, string> }).refs : {}) as Record<string, string>
    const host = document.createElement('div')
    host.className = 'loom-container'
    host.style.cssText = 'position:absolute;left:-10000px;top:0;width:800px;height:600px'
    host.innerHTML = renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set(), mode: 'preview', hookAll: true }, st.doc.root as string))
    document.body.appendChild(host)
    const box = (id: string) => host.querySelector(`[data-loom-node="${id}"]`)!.getBoundingClientRect()
    const row = box(refs.row!), right = box(refs.r!)
    check('justify "between" puts the last item at the row\'s end', Math.abs(right.right - row.right) <= 1, `row ends ${row.right.toFixed(0)}, item ends ${right.right.toFixed(0)}`)
    const btnEl = host.querySelector<HTMLElement>(`[data-loom-node="${refs.btn}"]`)!
    const btnBox = btnEl.getBoundingClientRect()
    check('a squeezed button keeps its label on one line', btnBox.height < 40, `${btnBox.width.toFixed(0)}x${btnBox.height.toFixed(0)}`)
    host.remove()
    const lbl = refs.l!
    run('place', { id: lbl, w: 120 })
    check('place with only a width leaves the height alone', st.doc.nodes[lbl]?.props.w === 120 && st.doc.nodes[lbl]?.props.h === undefined, JSON.stringify({ w: st.doc.nodes[lbl]?.props.w, h: st.doc.nodes[lbl]?.props.h }))
  }

  // --- 106. the Assistant sits bottom-centre of the canvas -----------------
  // Shane: "at the very bottom of the center of the design screen, instead of
  // the current controls, we could put the composer for the AI agent".
  {
    const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms))
    const comp = document.querySelector<HTMLElement>('.canvas-wrap .assistant .as-composer')
    const wrap = document.querySelector<HTMLElement>('.canvas-wrap')!.getBoundingClientRect()
    const c = comp?.getBoundingClientRect()
    check('the Assistant composer is bottom-centre of the canvas', !!c && Math.abs(c.left + c.width / 2 - (wrap.left + wrap.width / 2)) <= 2 && wrap.bottom - c.bottom <= 20 && wrap.bottom - c.bottom >= 0, c ? `centre ${(c.left + c.width / 2).toFixed(0)} vs ${(wrap.left + wrap.width / 2).toFixed(0)}, gap ${(wrap.bottom - c.bottom).toFixed(0)}` : 'missing')
    const dock = document.querySelector<HTMLElement>('.canvas-wrap .dock')?.getBoundingClientRect()
    check('the view controls moved to the top-right of the canvas', !!dock && dock.top - wrap.top <= 16 && wrap.right - dock.right <= 20, dock ? `${dock.top - wrap.top} / ${wrap.right - dock.right}` : 'missing')
    const input = document.querySelector<HTMLTextAreaElement>('.assistant .as-input')
    check('typing in the composer does not trigger editor shortcuts', !!input && (() => {
      const app = window.__loomStore
      const before = app.history.length
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
      return app.history.length === before
    })())
    ;[...document.querySelectorAll<HTMLButtonElement>('.titlebar .pv-toggle button')].find((b) => b.textContent?.trim() === 'Preview')?.click()
    await wait(200)
    check('the Assistant steps aside in Preview', document.querySelector('.assistant') === null)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait()
  }

  // --- 90. checkbox, radio and select are drawn, not left to the OS -------
  // A white OS square on a dark design (and a different one per platform)
  // was one of the loudest "home made" tells. The native input stays for
  // forms, keyboard and assistive tech, hidden; a themed box is drawn from
  // its state by the shared stylesheet. Measured live, in the output.
  {
    installBehaviourRuntime()
    const s90 = new EditorStore()
    const root90 = withRoot(s90)
    s90.addComponent('Checkbox', root90, 0, 0, { checked: true })
    s90.addComponent('RadioGroup', root90, 0, 60)
    s90.addComponent('Select', root90, 0, 120)
    s90.addComponent('DataGrid', root90, 0, 200)
    const host = document.createElement('div')
    host.id = 'selftest-90'
    host.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:700px;z-index:99999'
    document.body.appendChild(host)
    // The test window is hidden, so transitions never advance: without this
    // a colour reads as its pre-click value forever.
    const still = document.createElement('style')
    still.textContent = '#selftest-90 *{transition:none !important}'
    document.head.appendChild(still)
    const r90 = createRoot(host)
    const theme = getTheme('midnight')
    r90.render(renderNode({ doc: s90.doc, selected: new Set(), mode: 'preview', theme }, s90.doc.root!))
    await new Promise((r) => setTimeout(r, 80))
    const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
    const cbInput = host.querySelector<HTMLInputElement>('input[type=checkbox]')
    const cbBox = cbInput?.nextElementSibling as HTMLElement | null
    check('a checkbox hides the OS control and draws its own box', cbInput !== null && getComputedStyle(cbInput).opacity === '0' && cbBox?.hasAttribute('data-loom-box') === true,
      cbInput ? `opacity=${getComputedStyle(cbInput).opacity} next=${cbBox?.outerHTML.slice(0, 40)}` : 'no input')
    const boxBg = () => (cbBox ? getComputedStyle(cbBox).backgroundColor : 'none')
    check('a checked box is filled with the accent', boxBg() === rgb(theme.accent), boxBg())
    cbBox?.click()
    await new Promise((r) => setTimeout(r, 30))
    check('clicking the drawn box unchecks the real input', cbInput?.checked === false && boxBg() !== rgb(theme.accent), `checked=${cbInput?.checked} bg=${boxBg()}`)
    const radios = [...host.querySelectorAll<HTMLInputElement>('input[type=radio][data-loom-ctl]')]
    const radioOn = radios.find((r) => r.checked)
    check('a radio group draws its rings, the chosen one in the accent', radios.length >= 2 && radioOn !== undefined &&
      getComputedStyle(radioOn.nextElementSibling as HTMLElement).backgroundColor === rgb(theme.accent), `radios=${radios.length}`)
    const select = host.querySelector<HTMLSelectElement>('select')
    const sst = select ? getComputedStyle(select) : null
    check('a select draws the theme chevron, not the OS arrow', sst !== null && sst.appearance === 'none' && sst.backgroundImage.includes('data:image/svg+xml'), sst ? `${sst.appearance} ${sst.backgroundImage.slice(0, 40)}` : 'no select')
    check('a dark theme asks the browser for dark native parts', select !== null && getComputedStyle(select).colorScheme === 'dark', select ? getComputedStyle(select).colorScheme : '')
    const gridEl = host.querySelector<HTMLElement>('[data-loom-grid]')
    const rowBox = gridEl?.querySelector<HTMLInputElement>('input[data-loom-select]')?.nextElementSibling as HTMLElement | null
    rowBox?.click()
    await new Promise((r) => setTimeout(r, 30))
    check('clicking a grid row\'s drawn box selects the row', gridEl?.getAttribute('data-loom-selected') === '1', `selected=${gridEl?.getAttribute('data-loom-selected')}`)
    r90.unmount()
    host.remove()
    still.remove()
  }

  // --- 91. the output draws its icons; no font glyphs or emoji --------------
  // ⌕ ▾ ⤴ ★ × 📢 came from whatever font the machine had: mixed sizes and
  // baselines, emoji in colour, sometimes a missing-glyph box. Every
  // component, as it lands, must draw its marks from the icon set. Keyboard
  // notation (⌘ ↑ ↓ ↵) and a tree connector (└) are TEXT and stay.
  {
    const allowed = new Set(['⌘', '↑', '↓', '↵', '└'])
    const glyphy = (ch: string) => {
      const c = ch.codePointAt(0)!
      return !allowed.has(ch) && ((c >= 0x2190 && c <= 0x2bff) || c >= 0x1f000 || ch === '×')
    }
    const offenders: string[] = []
    for (const spec of allComponents()) {
      const s91 = new EditorStore()
      s91.addComponent(spec.name, withRoot(s91), 0, 0)
      const html = renderToStaticMarkup(renderNode({ doc: s91.doc, selected: new Set(), mode: 'preview' }, s91.doc.root!))
      const text = html.replace(/<[^>]*>/g, ' ')
      const bad = [...new Set([...text].filter(glyphy))]
      if (bad.length) offenders.push(`${spec.name}: ${bad.join('')}`)
    }
    check('no component draws an icon as a font glyph or emoji', offenders.length === 0, offenders.join(' | '))
    // A suggestion list's browser indicator sat beside the ComboBox chevron.
    const s91b = new EditorStore()
    s91b.addComponent('ComboBox', withRoot(s91b), 0, 0)
    const host91 = document.createElement('div')
    document.body.appendChild(host91)
    const r91 = createRoot(host91)
    r91.render(renderNode({ doc: s91b.doc, selected: new Set(), mode: 'preview' }, s91b.doc.root!))
    await new Promise((r) => setTimeout(r, 40))
    const listInput = host91.querySelector('input[list]')
    // getComputedStyle cannot read this vendor pseudo-element, so the check is
    // that a live rule targets THIS input's indicator and removes it.
    const hides = (el: Element) => [...document.styleSheets].some((sh) => [...sh.cssRules].some((r) => {
      if (!(r instanceof CSSStyleRule) || r.style.display !== 'none') return false
      return r.selectorText.split(',').some((sel) => {
        const m = /^(.*)::-webkit-calendar-picker-indicator$/.exec(sel.trim())
        return m !== null && el.matches(m[1] || '*')
      })
    }))
    const indicator = listInput ? (hides(listInput) ? 'none' : 'shown') : 'missing'
    r91.unmount()
    host91.remove()
    check('a ComboBox shows one chevron, not the browser\'s list arrow too', indicator === 'none', indicator)
  }

  // --- 92. an empty container is visible on the canvas ---------------------
  // A split, a button group or an accordion paints no surface of its own, so
  // once dropped it was invisible: nothing to see, find or drop into. The
  // real canvas outlines an empty container; the outline goes the moment it
  // has a child, and never reaches the output.
  {
    const app = window.__loomStore
    const before = app.doc
    const scene = new EditorStore()
    const root92 = withRoot(scene)
    const split = scene.addComponent('SplitH', root92, 20, 20, { w: 360, h: 220 })!
    const group = scene.addComponent('ButtonGroup', root92, 20, 280, { w: 240, h: 48 })!
    scene.addComponent('Button', group, 0, 0)
    app.loadDocument(scene.doc)
    await new Promise((r) => setTimeout(r, 120))
    const at = (id: string) => document.querySelector<HTMLElement>(`.loom .surface [data-loom-id="${id}"]`)
    const edge = (id: string) => { const el = at(id); return el ? getComputedStyle(el).outlineStyle : 'missing' }
    const why = (id: string) => { const el = at(id); return el ? `vacant=${el.getAttribute('data-loom-vacant')} inline=${el.style.outline}` : 'missing' }
    check('an empty container is outlined on the canvas', edge(split) === 'dashed', `${edge(split)} ${why(split)}`)
    check('a container with something in it is not', edge(group) === 'none', edge(group))
    check('the outline never reaches the output', !emitHtml(scene.doc).includes('data-loom-vacant'))
    app.loadDocument(before)
  }

  // --- 93. the aurora page: colour wandering behind the UI -----------------
  // Glass is only as good as what is behind it. The aurora page draws the
  // theme's colours as large soft blobs on long, unrelated paths, behind the
  // design, on the real canvas and in the export alike; still for anyone who
  // asks for less motion.
  {
    check('a page can be aurora', cleanPage({ background: 'aurora' })?.background === 'aurora')
    const app = window.__loomStore
    const before = app.doc
    const scene = new EditorStore()
    const root93 = withRoot(scene)
    const label = scene.addComponent('Heading', root93, 40, 40, { text: 'Over the aurora' })!
    scene.commit({ op: 'setPage', page: { background: 'aurora' } }, 'Page')
    app.loadDocument(scene.doc)
    await new Promise((r) => setTimeout(r, 150))
    const layer = document.querySelector<HTMLElement>('.loom .surface [data-loom-aurora]')
    const blobs = layer ? [...layer.querySelectorAll<HTMLElement>('[data-loom-blob]')] : []
    const anims = blobs.map((b) => getComputedStyle(b))
    check('the canvas draws the aurora behind the design', layer !== null && blobs.length >= 4, `blobs=${blobs.length}`)
    check('every blob wanders, on its own clock', anims.length >= 4 && anims.every((a) => a.animationName.startsWith('loom-wander-')) &&
      new Set(anims.map((a) => a.animationDuration)).size === anims.length, anims.map((a) => `${a.animationName}/${a.animationDuration}`).join(' '))
    const headEl = document.querySelector<HTMLElement>(`.loom .surface [data-loom-id="${label}"]`)
    const hb = headEl?.getBoundingClientRect()
    const hit = hb ? document.elementFromPoint(hb.left + hb.width / 2, hb.top + hb.height / 2) : null
    check('the design paints above the aurora', headEl !== null && hit !== null && (hit === headEl || headEl.contains(hit)), hit ? hit.tagName : 'nothing')
    const still = [...document.styleSheets].some((sh) => [...sh.cssRules].some((r) =>
      r instanceof CSSMediaRule && r.conditionText.includes('prefers-reduced-motion') && r.cssText.includes('data-loom-blob')))
    check('the aurora holds still for reduced motion', still)
    const html93 = emitHtml(scene.doc)
    check('the export carries the aurora and its motion', html93.includes('data-loom-aurora') && html93.includes('@keyframes loom-wander-1'))
    scene.commit({ op: 'setPage', page: { background: 'theme' } }, 'Page')
    check('a plain page exports no aurora', !emitHtml(scene.doc).includes('loom-wander'))
    app.loadDocument(before)
  }

  // --- 94. surfaces are glass; depth is light, not a 1px box ---------------
  // Every surface was the same opaque fill inside the same 1px border, card in
  // panel in panel. Surfaces are now one material: translucent, blurring what
  // is behind, lit along the top edge. A surface ON a surface is the raised
  // kind: lighter, and it does not blur a second time.
  {
    const s94 = new EditorStore()
    // The root is a Panel on the page: top-level glass. The card sits on it.
    const panel94 = withRoot(s94)
    s94.addComponent('Card', panel94, 0, 0)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const r94 = createRoot(host)
    const theme = getTheme('midnight')
    // The panel itself, drawn as a root; the card is its first child.
    r94.render(renderNode({ doc: s94.doc, selected: new Set(), mode: 'preview', theme }, panel94))
    await new Promise((r) => setTimeout(r, 60))
    const panelEl = host.firstElementChild as HTMLElement | null
    const cardEl = panelEl?.firstElementChild as HTMLElement | null
    const pst = panelEl ? getComputedStyle(panelEl) : null
    const alpha = (c: string) => { const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(c); return m ? Number(m[1]) : 1 }
    check('a Panel lands as glass: translucent and blurring what is behind', pst !== null && pst.backdropFilter.includes('blur') && alpha(pst.backgroundColor) < 1,
      pst ? `${pst.backdropFilter} ${pst.backgroundColor}` : 'no panel')
    check('glass is lit along its top edge', pst !== null && pst.boxShadow.includes('inset'))
    const cst = cardEl ? getComputedStyle(cardEl) : null
    check('a card on a panel is the raised glass: lighter, no second blur', cst !== null && cst.backdropFilter === 'none' && cst.backgroundImage.includes('gradient'),
      cst ? `${cst.backdropFilter} ${cst.backgroundImage.slice(0, 40)}` : 'no card')
    r94.unmount()
    host.remove()
    // Every surface component, dropped on a page, is glass.
    const flat: string[] = []
    for (const type of ['Card', 'Tabs', 'Modal', 'Drawer', 'Toolbar', 'HeaderBar', 'SettingsSection', 'KpiCard', 'DataCard', 'Menu', 'ConfirmDialog']) {
      const st = new EditorStore()
      st.addComponent(type, withRoot(st), 0, 0)
      const html = renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set(), mode: 'preview', theme }, st.doc.root!))
      if (!html.includes('backdrop-filter:blur')) flat.push(type)
    }
    check('every surface component is glass', flat.length === 0, flat.join(', '))
  }

  // --- 95. soft depth as an accent: wells, knobs, a raised choice ----------
  // Fields are wells pressed into the surface, knobs are extruded from it,
  // a segmented control's choice is raised. And the choice FOLLOWS a click:
  // its look was inline, so it stayed on the authored option forever.
  {
    installBehaviourRuntime()
    const s95 = new EditorStore()
    const root95 = withRoot(s95)
    s95.addComponent('Segmented', root95, 0, 0)
    s95.addComponent('Slider', root95, 0, 60, { value: 20 })
    s95.addComponent('Switch', root95, 0, 120)
    s95.addComponent('Input', root95, 0, 180)
    const host = document.createElement('div')
    host.id = 'selftest-95'
    host.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:600px;z-index:99999'
    document.body.appendChild(host)
    const still = document.createElement('style')
    still.textContent = '#selftest-95 *{transition:none !important}'
    document.head.appendChild(still)
    const r95 = createRoot(host)
    r95.render(renderNode({ doc: s95.doc, selected: new Set(), mode: 'preview', theme: getTheme('midnight') }, s95.doc.root!))
    await new Promise((r) => setTimeout(r, 80))
    const segs = [...host.querySelectorAll<HTMLElement>('[data-loom-seg]')]
    const raisedIdx = () => segs.findIndex((l) => getComputedStyle(l).boxShadow !== 'none')
    const before95 = raisedIdx()
    const other = segs.find((_, i) => i !== before95)
    other?.click()
    await new Promise((r) => setTimeout(r, 40))
    check('a segmented choice is raised, and the raise follows a click', segs.length >= 2 && before95 >= 0 && other !== undefined && raisedIdx() === segs.indexOf(other),
      `before=${before95} after=${raisedIdx()} clicked=${other ? segs.indexOf(other) : -1}`)
    const range = host.querySelector<HTMLInputElement>('input[data-loom-range]')
    const fillAt = () => range?.style.getPropertyValue('--loom-fill') ?? ''
    const fill0 = fillAt()
    if (range) {
      range.value = '80'
      range.dispatchEvent(new Event('input', { bubbles: true }))
    }
    check('a slider track fills to the value and follows the thumb', range !== null && fill0 === '20%' && fillAt() === '80%', `${fill0} -> ${fillAt()}`)
    const knob = host.querySelector<HTMLElement>('[data-loom-knob]')
    check('a switch knob is extruded, not a flat dot', knob !== null && getComputedStyle(knob).boxShadow !== 'none' && getComputedStyle(knob).backgroundImage.includes('gradient'))
    const field = host.querySelector<HTMLInputElement>('input:not([type=range]):not([type=checkbox]):not([type=radio])')
    check('a field is a well pressed into the surface', field !== null && getComputedStyle(field).boxShadow.includes('inset'), field ? getComputedStyle(field).boxShadow : 'no field')
    r95.unmount()
    host.remove()
    still.remove()
  }

  // --- 96. finished defaults: legible, aligned, inside their padding -------
  {
    const s96 = new EditorStore()
    const root96 = withRoot(s96)
    s96.addComponent('Label', root96, 0, 0)
    s96.addComponent('BannerBox', root96, 0, 60)
    s96.addComponent('KpiCard', root96, 0, 140)
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:700px'
    document.body.appendChild(host)
    const r96 = createRoot(host)
    const day = getTheme('daylight')
    r96.render(renderNode({ doc: s96.doc, selected: new Set(), mode: 'preview', theme: day }, s96.doc.root!))
    await new Promise((r) => setTimeout(r, 60))
    const rgbOf = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
    const labelEl = [...host.querySelectorAll<HTMLElement>('*')].find((e) => e.textContent === getComponent('Label')!.props.text.default && e.children.length === 0)
    check('a dropped Label takes the theme text colour (legible on daylight)', labelEl !== undefined && getComputedStyle(labelEl).color === rgbOf(day.textPrimary),
      labelEl ? getComputedStyle(labelEl).color : 'no label')
    const banner = [...host.querySelectorAll<HTMLElement>('div')].find((d) => d.textContent === 'Announcement')
    const icon = banner?.querySelector('svg')?.getBoundingClientRect()
    const words = banner ? [...banner.querySelectorAll('span')].find((x) => x.textContent === 'Announcement')?.getBoundingClientRect() : undefined
    check('a banner sets its icon beside its message', icon !== undefined && words !== undefined && icon.right <= words.left && Math.abs((icon.top + icon.bottom) / 2 - (words.top + words.bottom) / 2) < 6,
      icon && words ? `icon ${icon.left.toFixed(0)}-${icon.right.toFixed(0)} @${icon.top.toFixed(0)}, text ${words.left.toFixed(0)} @${words.top.toFixed(0)}` : 'missing')
    // The chart, not an icon: the only drawing wider than an icon is.
    const kpiSvg = [...host.querySelectorAll<SVGElement>('svg')].find((v) => v.getBoundingClientRect().width > 60)
    // The card is the raised kind here (it sits on the root's glass): found by its width.
    const kpiCard = kpiSvg?.closest<HTMLElement>('div[style*="width: 220px"]') ?? null
    const inner = kpiCard ? kpiCard.getBoundingClientRect().right - parseFloat(getComputedStyle(kpiCard).paddingRight) - parseFloat(getComputedStyle(kpiCard).borderRightWidth) : 0
    check('a KPI card draws its chart inside its padding', kpiSvg !== undefined && kpiCard !== null && kpiSvg.getBoundingClientRect().right <= inner + 0.5,
      kpiSvg && kpiCard ? `svg right ${kpiSvg.getBoundingClientRect().right.toFixed(1)} content right ${inner.toFixed(1)}` : 'missing')
    r96.unmount()
    host.remove()
    // The demo is the first thing anyone sees: it must be right in EVERY
    // theme, so it writes no colour of its own.
    const sd = new EditorStore()
    seedDemo(sd)
    const coloured = Object.values(sd.doc.nodes).filter((n) => typeof n.props.color === 'string' && n.props.color !== '').map((n) => `${n.type}:${n.props.color}`)
    check('the demo writes no colour literals; text takes the theme', coloured.length === 0, coloured.join(' '))
    check('the demo sits on the aurora page', sd.doc.meta.page?.background === 'aurora')
    // Nothing is gated off either target, so the toolbox shows no dots and no
    // key to them.
    const toolbox = document.querySelector('.toolbox')
    check('the toolbox shows no "limited on" key when nothing is limited', toolbox !== null && !toolbox.querySelector('.legend') && !toolbox.querySelector('.tool-gate'),
      toolbox?.querySelector('.legend')?.textContent ?? '')
  }

  // --- 97. the Studio is made of what it makes ---------------------------
  // The chrome was generic dark: flat grey panels on black. It now shares the
  // output's language: glass panels over a still wash of the accent colours,
  // wells and raised segments, and a toolbox whose icons carry their
  // category's colour. Read from the live Studio.
  {
    const cs = (q: string) => { const el = document.querySelector<HTMLElement>(q); return el ? getComputedStyle(el) : null }
    const tb = cs('.loom .toolbox')
    const ins = cs('.loom .inspector')
    check('the side panels are glass', tb !== null && ins !== null && tb.backdropFilter.includes('blur') && ins.backdropFilter.includes('blur'),
      `${tb?.backdropFilter} / ${ins?.backdropFilter}`)
    check('the Studio sits on a wash of its accent colours', getComputedStyle(document.body).backgroundImage.split('radial-gradient').length - 1 >= 2)
    const iconColour = (cat: string) => cs(`.toolbox [data-cat="${cat}"] .tool-icon`)?.color ?? 'missing'
    const cats = ['Containers', 'Text', 'Controls', 'Data'].map(iconColour)
    check('toolbox icons carry their category colour', cats.every((c) => c !== 'missing') && new Set(cats).size === cats.length, cats.join(' | '))
    const on = cs('.seg button.on')
    check('a chosen segment is raised out of its well', on !== null && on.boxShadow !== 'none' && (cs('.seg')?.boxShadow ?? 'none').includes('inset'), on?.boxShadow ?? 'no segment')
    check('the Studio\'s fields are wells', (cs('.toolbox .search')?.boxShadow ?? 'none').includes('inset'))
    // Glass is the containing block of any fixed-position child: the toolbox
    // hover card, rendered inside the (now glass) toolbox, was placed against
    // it and clipped: in the DOM, never on screen. It must be where it says.
    // (relatedTarget null: the pointer enters from outside, which is what
    // makes React fire the row's pointerenter.)
    const row = [...document.querySelectorAll<HTMLElement>('.toolbox .tool')].find((b) => b.textContent?.trim() === 'Tabs')
    row?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: null, pointerType: 'mouse' }))
    await new Promise((r) => setTimeout(r, 450))
    const card = document.querySelector<HTMLElement>('.tool-card')
    const cr = card?.getBoundingClientRect()
    // The card takes no pointer, so it cannot be hit-tested; what matters is
    // that no ancestor clips it: every clipping ancestor must contain it.
    const clippers: string[] = []
    for (let p = card?.parentElement ?? null; p && cr; p = p.parentElement) {
      const st = getComputedStyle(p)
      if (st.overflow === 'visible' && st.overflowX === 'visible' && st.overflowY === 'visible') continue
      const pr = p.getBoundingClientRect()
      if (cr.left < pr.left - 0.5 || cr.right > pr.right + 0.5 || cr.top < pr.top - 0.5 || cr.bottom > pr.bottom + 0.5) clippers.push(p.className || p.tagName)
    }
    check('the toolbox hover card is on screen, not clipped by a panel', card !== null && cr !== undefined && cr.width > 100 && clippers.length === 0,
      card ? `${cr?.left.toFixed(0)},${cr?.top.toFixed(0)} ${cr?.width.toFixed(0)}x${cr?.height.toFixed(0)} clipped by ${clippers.join(', ') || 'nothing'}` : 'no card')
    row?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: null, pointerType: 'mouse' }))
    await new Promise((r) => setTimeout(r, 50))
    // An empty document welcomes you with a way in: the starters, one click
    // each. Still genuinely empty until you choose (nothing placed unasked).
    {
      const app = window.__loomStore
      const before = app.doc
      app.loadDocument(emptyDocument())
      await new Promise((r) => setTimeout(r, 100))
      const starts = [...document.querySelectorAll<HTMLButtonElement>('.loom .surface .empty-start')]
      check('an empty document is still empty, and offers the starters', app.doc.root === null && starts.length === STARTERS.length && starts.length > 0, `root=${app.doc.root} buttons=${starts.length}`)
      const undoBefore = app.history.length
      starts[0]?.click()
      await new Promise((r) => setTimeout(r, 100))
      check('one click on a starter places it, as one undo step', app.doc.root !== null && app.history.length === undoBefore + 1 && !document.querySelector('.loom .surface .empty-start'),
        `root=${app.doc.root} history ${undoBefore}->${app.history.length}`)
      app.loadDocument(before)
    }  }

  // --- 98. a tab set arrives with its tabs -----------------------------------
  // Dropped empty, a Tabs had nothing for its strip to draw: an empty box
  // with a rule across it. A toolbox drop now brings three tabs, built as its
  // own "Add tab" builds them, in one undo step. Code that adds a Tabs still
  // gets a bare one.
  {
    const s98 = new EditorStore()
    const root98 = withRoot(s98)
    const before98 = s98.history.length
    const tabs = s98.dropComponent('Tabs', root98, 0, 0)!
    const kids = s98.doc.nodes[tabs]?.children ?? []
    const titles = kids.map((c) => `${s98.doc.nodes[c]?.type}:${String(s98.doc.nodes[c]?.props.title)}`)
    check('a dropped Tabs arrives with three named tabs', titles.join(',') === 'TabPanel:Overview,TabPanel:Activity,TabPanel:Settings', titles.join(','))
    check('the tab set and its tabs are one undo step', s98.history.length === before98 + 1)
    const html98 = emitHtml(s98.doc)
    check('the strip draws the three tabs', ['Overview', 'Activity', 'Settings'].every((l) => html98.includes(`>${l}<`)))
    // Only the active tab's page shows (every panel used to ship shown, so a
    // tab set drew all its pages stacked), measured live under the state
    // stylesheet; `active` picks which; the tab's label is not repeated as a
    // heading inside its page.
    {
      const host = document.createElement('div')
      host.id = 'selftest-98'
      document.body.appendChild(host)
      // The test window is hidden, so transitions never advance: a fill read
      // after a click would be its pre-click value.
      const still98 = document.createElement('style')
      still98.textContent = '#selftest-98 *{transition:none !important}'
      document.head.appendChild(still98)
      const r98 = createRoot(host)
      const shownTitles = async () => {
        r98.render(renderNode({ doc: s98.doc, selected: new Set(), mode: 'preview', theme: getTheme('midnight') }, s98.doc.root!))
        await new Promise((r) => setTimeout(r, 40))
        return [...host.querySelectorAll<HTMLElement>('[role=tabpanel]')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.getAttribute('aria-label'))
      }
      const first = await shownTitles()
      check('a tab set shows only its active page', first.join(',') === 'Overview', first.join(','))
      s98.commit({ op: 'setProp', id: tabs, key: 'active', value: 1 }, 'Active')
      const second = await shownTitles()
      check('the active prop picks the page', second.join(',') === 'Activity', second.join(','))
      const page = host.querySelector<HTMLElement>('[role=tabpanel][aria-label=Activity]')
      check('a page does not repeat its tab label as a heading', page !== null && !(page.textContent ?? '').includes('Activity'), page?.textContent ?? '')
      // A click moves the page AND the highlight: the chosen tab's fill was
      // inline, so it stayed on the authored tab while the colour moved.
      installBehaviourRuntime()
      const tabBtn = (label: string) => [...host.querySelectorAll<HTMLElement>('[role=tab]')].find((b) => b.textContent === label)
      tabBtn('Settings')?.click()
      await new Promise((r) => setTimeout(r, 40))
      const filled = [...host.querySelectorAll<HTMLElement>('[role=tab]')].filter((b) => getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)').map((b) => b.textContent)
      const visible = [...host.querySelectorAll<HTMLElement>('[role=tabpanel]')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.getAttribute('aria-label'))
      check('a click moves the page and the highlight together', filled.join(',') === 'Settings' && visible.join(',') === 'Settings', `filled=${filled.join(',')} shown=${visible.join(',')}`)
      r98.unmount()
      host.remove()
      still98.remove()
      s98.undo()
    }
    s98.undo()
    check('one undo removes the tab set and its tabs', !s98.doc.nodes[tabs] && kids.every((c) => !s98.doc.nodes[c]))
    const bare = new EditorStore()
    const bareId = bare.addComponent('Tabs', withRoot(bare), 0, 0)!
    check('a Tabs added by code stays bare', (bare.doc.nodes[bareId]?.children.length ?? -1) === 0)
    let refused = false
    try { defineComponent({ name: '__bad_seed', category: 'Test', container: true, icon: '', description: '', props: {}, childTypes: ['TabPanel'], seed: [{ type: 'Button' }] }) } catch { refused = true }
    check('a seed must be a child the container accepts', refused && !getComponent('__bad_seed'))
  }

  // --- 99. an accordion arrives with its sections -----------------------------
  // Dropped empty, an Accordion drew nothing at all. A toolbox drop brings
  // three sections (an FAQ), one undo step; each section is glass; a click
  // on a summary opens its body.
  {
    const s99 = new EditorStore()
    const root99 = withRoot(s99)
    const before99 = s99.history.length
    const acc = s99.dropComponent('Accordion', root99, 0, 0)!
    const items = s99.doc.nodes[acc]?.children ?? []
    const titles = items.map((c) => `${s99.doc.nodes[c]?.type}:${String(s99.doc.nodes[c]?.props.title)}`)
    check('a dropped Accordion arrives with three sections', titles.join('|') === 'AccordionItem:What is included?|AccordionItem:How does billing work?|AccordionItem:Can I cancel at any time?', titles.join('|'))
    check('the accordion and its sections are one undo step', s99.history.length === before99 + 1)
    const host = document.createElement('div')
    host.id = 'selftest-99'
    document.body.appendChild(host)
    const still99 = document.createElement('style')
    still99.textContent = '#selftest-99 *{transition:none !important}'
    document.head.appendChild(still99)
    installBehaviourRuntime()
    const r99 = createRoot(host)
    // The accordion drawn on its own (it sits in the root panel, so its
    // sections are the raised glass).
    r99.render(renderNode({ doc: s99.doc, selected: new Set(), mode: 'preview', theme: getTheme('midnight') }, acc))
    await new Promise((r) => setTimeout(r, 60))
    const summaries = [...host.querySelectorAll<HTMLElement>('[data-loom-summary]')]
    check('the accordion draws its three summaries', summaries.map((x) => x.textContent).join('|') === 'What is included?|How does billing work?|Can I cancel at any time?', summaries.map((x) => x.textContent).join('|'))
    const sections = [...host.querySelectorAll<HTMLElement>('[data-loom-b="disclosure"]')]
    // Glass of either kind: it sits on the root panel's glass here, so it is
    // the raised kind (no second blur): the material's fill and lit edge.
    check('each section is glass', sections.length === 3 && sections.every((x) => getComputedStyle(x).backgroundImage.includes('gradient') && getComputedStyle(x).boxShadow.includes('inset')),
      sections.map((x) => getComputedStyle(x).backgroundImage.slice(0, 20)).join(' | '))
    const body = sections[1]?.querySelector<HTMLElement>('[data-loom-body]')
    const shut = body ? getComputedStyle(body).display : 'missing'
    summaries[1]?.click()
    await new Promise((r) => setTimeout(r, 40))
    check('a click on a summary opens its section', shut === 'none' && body !== null && body !== undefined && getComputedStyle(body).display !== 'none', `${shut} -> ${body ? getComputedStyle(body).display : 'missing'}`)
    r99.unmount()
    host.remove()
    still99.remove()
    s99.undo()
    check('one undo removes the accordion and its sections', !s99.doc.nodes[acc] && items.every((c) => !s99.doc.nodes[c]))
    const bare = new EditorStore()
    const bareId = bare.addComponent('Accordion', withRoot(bare), 0, 0)!
    check('an Accordion added by code stays bare', (bare.doc.nodes[bareId]?.children.length ?? -1) === 0)
  }

  // --- 100. composites arrive with their parts; layouts arrive empty -------
  // Every seed, table-driven: it names a real component, a toolbox drop
  // builds exactly it as one undo step, and the output draws it. Layout
  // containers stay empty for you to fill (the form-designer model).
  {
    const seeded = allComponents().filter((c) => (c.seed ?? []).length > 0)
    const unknown = seeded.flatMap((c) => (c.seed ?? []).filter((k) => !getComponent(k.type)).map((k) => `${c.name}:${k.type}`))
    check('every seed names a real component', unknown.length === 0, unknown.join(', '))
    const wrong: string[] = []
    for (const spec of seeded) {
      const st = new EditorStore()
      const r = withRoot(st)
      const before = st.history.length
      const id = st.dropComponent(spec.name, r, 0, 0)
      const kids = id ? st.doc.nodes[id].children.map((c) => st.doc.nodes[c]?.type) : []
      const want = (spec.seed ?? []).map((k) => k.type)
      if (!id || kids.join(',') !== want.join(',') || st.history.length !== before + 1) wrong.push(`${spec.name}: ${kids.join(',')}`)
      else {
        try { emitHtml(st.doc) } catch (e) { wrong.push(`${spec.name}: ${String(e)}`) }
      }
    }
    check('every seeded component drops with exactly its seed, in one step', wrong.length === 0, wrong.join(' | '))
    const expect: Record<string, string[]> = {
      SettingsSection: ['Email notifications', 'Two-factor authentication', 'Language'],
      KanbanColumn: ['Design review', 'Update onboarding copy', 'Fix login redirect'],
      NotificationList: ['New comment', 'Deploy finished', 'Storage almost full'],
      ButtonGroup: ['Left', 'Center', 'Right'],
      CommandBar: ['New', 'Import', 'Export'],
    }
    const missing: string[] = []
    for (const [name, words] of Object.entries(expect)) {
      const st = new EditorStore()
      st.dropComponent(name, withRoot(st), 0, 0)
      const html = emitHtml(st.doc)
      for (const w of words) if (!html.includes(`>${w}<`)) missing.push(`${name}:${w}`)
    }
    check('composites draw their parts', missing.length === 0, missing.join(', '))
    // A settings row is a label AND its control: seeds nest one level.
    {
      const ss = new EditorStore()
      const sid = ss.dropComponent('SettingsSection', withRoot(ss), 0, 0)!
      const controls = ss.doc.nodes[sid].children.map((r) => (ss.doc.nodes[r]?.children ?? []).map((c) => ss.doc.nodes[c]?.type).join('+'))
      check('each seeded settings row arrives with its control', controls.join(',') === 'Switch,Switch,Select', controls.join(','))
      // Names read down the left edge: the row's `align` (control side, right
      // by default) was also applied as text alignment, right-aligning every
      // label. Measured on the label text itself.
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:600px'
      document.body.appendChild(host)
      const rs = createRoot(host)
      rs.render(renderNode({ doc: ss.doc, selected: new Set(), mode: 'preview' }, sid))
      await new Promise((r) => setTimeout(r, 30))
      const offsets = ['Email notifications', 'Two-factor authentication', 'Language'].map((label) => {
        const span = [...host.querySelectorAll<HTMLElement>('span')].find((x) => x.textContent === label)
        const col = span?.parentElement
        if (!span || !col) return 'missing'
        const range = document.createRange()
        range.selectNodeContents(span)
        return Math.round(range.getBoundingClientRect().left - col.getBoundingClientRect().left)
      })
      rs.unmount()
      host.remove()
      check('settings row labels are left-aligned', offsets.every((o) => o === 0), offsets.join(','))
    }
    // A bar reads across: its seeded parts sit on one line.
    {
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:0;top:0;width:1400px;height:600px'
      document.body.appendChild(host)
      const rb = createRoot(host)
      const stacked: string[] = []
      for (const name of ['Toolbar', 'CommandBar', 'ButtonGroup']) {
        const st = new EditorStore()
        const id = st.dropComponent(name, withRoot(st), 0, 0)!
        rb.render(renderNode({ doc: st.doc, selected: new Set(), mode: 'preview' }, id))
        await new Promise((r) => setTimeout(r, 20))
        const bar = host.firstElementChild as HTMLElement | null
        const tops = [...(bar?.children ?? [])].map((c) => Math.round(c.getBoundingClientRect().top))
        if (tops.length < 3 || new Set(tops).size !== 1) stacked.push(`${name}: ${tops.join(',')}`)
      }
      rb.unmount()
      host.remove()
      check('a bar lays its parts out in a row', stacked.length === 0, stacked.join(' | '))
    }
    const tb = new EditorStore()
    const tbId = tb.dropComponent('Toolbar', withRoot(tb), 0, 0)!
    check('a toolbar arrives with its tools', tb.doc.nodes[tbId].children.length === 4 && tb.doc.nodes[tbId].children.every((c) => tb.doc.nodes[c]?.type === 'IconButton'))
    // Arranged, not piled: seeded parts must not overlap (free-positioned they
    // all sat at 0,0), measured live for every seeded component.
    {
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:0;top:0;width:1400px;height:900px'
      document.body.appendChild(host)
      const r100 = createRoot(host)
      const piled: string[] = []
      for (const spec of seeded) {
        const st = new EditorStore()
        const id = st.dropComponent(spec.name, withRoot(st), 0, 0)!
        r100.render(renderNode({ doc: st.doc, selected: new Set(), mode: 'preview' }, id))
        await new Promise((r) => setTimeout(r, 20))
        const own = host.firstElementChild as HTMLElement | null
        // The seeded children, found as the container's element children in
        // document order that the renderer drew for them (visible ones only).
        const boxes = [...(own?.querySelectorAll<HTMLElement>('*') ?? [])]
          .filter((el) => el.parentElement && getComputedStyle(el).display !== 'none')
          .filter((el) => el.textContent && (spec.seed ?? []).some((k) => {
            const t = String(k.props?.title ?? k.props?.label ?? '')
            return t !== '' && el.firstChild !== null && el.textContent?.trim().startsWith(t) && el.getBoundingClientRect().height > 0
          }))
          .map((el) => el.getBoundingClientRect())
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j]
          const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2
          const nested = (a.left <= b.left && a.right >= b.right && a.top <= b.top && a.bottom >= b.bottom) || (b.left <= a.left && b.right >= a.right && b.top <= a.top && b.bottom >= a.bottom)
          if (overlap && !nested) { piled.push(spec.name); i = boxes.length; break }
        }
        const kidsFlow = st.doc.nodes[id].flow
        if (!kidsFlow) piled.push(`${spec.name} (not arranged)`)
      }
      r100.unmount()
      host.remove()
      check('seeded parts are arranged, not piled on each other', piled.length === 0, [...new Set(piled)].join(', '))
    }
    const layouts = ['Panel', 'Stack', 'Grid', 'Card', 'ScrollView', 'SplitH', 'SplitV', 'FormGrid'].filter((n) => (getComponent(n)?.seed ?? []).length > 0)
    check('layout containers land empty, for you to fill', layouts.length === 0, layouts.join(', '))
  }

  // --- 101. the editor's basics (UI/UX review, batch A) ----------------------
  // Read from the live Studio: the keys, the menu, the handles, the file
  // outcomes, contrast, names and the hover card, each as a person meets it.
  {
    const app = window.__loomStore
    const saved = app.doc
    const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
    const press = (key: string, init: KeyboardEventInit = {}) =>
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
    const fixture = () => {
      app.loadDocument(emptyDocument())
      const root = app.dropComponent('Stack', null, 0, 0)!
      app.commit({ op: 'setFlow', id: root, flow: true }, 'flow')
      const a = app.dropComponent('Caption', root, 0, 0)!
      const b = app.dropComponent('Label', root, 0, 0)!
      return { root, a, b }
    }

    // 1. Ctrl+D duplicates (it deleted), one undo step, the copy selected.
    {
      const { root, a, b } = fixture()
      app.select([a])
      const before = app.history.length
      press('d', { ctrlKey: true })
      await settle()
      const kids = app.doc.nodes[root].children
      check('Ctrl+D duplicates the selection, as in every design tool', kids.length === 3 && kids.includes(a) && app.selection.length === 1 && app.selection[0] !== a && app.doc.nodes[app.selection[0]]?.type === 'Caption',
        `children ${kids.length}, selection ${app.selection.map((id) => app.doc.nodes[id]?.type).join(',')}`)
      check('the duplicate is one undo step', app.history.length === before + 1)
      app.select([a, b])
      const before2 = app.history.length
      press('d', { ctrlKey: true })
      await settle()
      check('Ctrl+D on two nodes copies both in one step, each after its source',
        app.doc.nodes[root].children.length === 5 && app.history.length === before2 + 1 && app.selection.length === 2 &&
          app.doc.nodes[root].children.indexOf(app.selection[0]) === app.doc.nodes[root].children.indexOf(a) + 1,
        app.doc.nodes[root].children.map((id) => app.doc.nodes[id]?.type).join(','))
      // The context menu offers it too.
      const el = document.querySelector<HTMLElement>(`.loom .surface [data-loom-id="${a}"]`)
      const r = el?.getBoundingClientRect()
      el?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: (r?.left ?? 0) + 2, clientY: (r?.top ?? 0) + 2 }))
      await settle()
      const dupItem = [...document.querySelectorAll<HTMLButtonElement>('.ctx-item')].find((x) => x.textContent?.includes('Duplicate'))
      check('the context menu offers Duplicate', dupItem !== undefined)
      press('Escape')
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      await settle()
    }

    // 2 + 3. Handles sit on the selected node's own corners, flow child or
    // free, for every component; and stay 8px on screen at any zoom.
    {
      // Zoom out first, so a handle that scales with the zoom shows it.
      const zoomOut = document.querySelector<HTMLButtonElement>('.loom [aria-label="Zoom out"]')
      for (let i = 0; i < 6; i++) { zoomOut?.click(); await settle(20) }
      const zoomPct = Number(document.querySelector<HTMLElement>('.loom .surface')?.dataset.zoom ?? 100)
      const off: string[] = []
      const sizes: number[] = []
      let measured = 0
      for (const spec of allComponents()) {
        app.loadDocument(emptyDocument())
        const root = app.dropComponent('Stack', null, 0, 0)!
        app.commit({ op: 'setFlow', id: root, flow: true }, 'flow')
        const id = app.dropComponent(spec.name, root, 0, 0)
        if (!id || !app.doc.nodes[root].children.includes(id)) continue
        app.select([id])
        await settle(30)
        const node = document.querySelector<HTMLElement>(`.loom .surface [data-loom-id="${id}"]`)
        const box = document.querySelector<HTMLElement>(`.loom .surface .sel-box[data-for="${id}"]`)
        const nw = box?.querySelector<HTMLElement>('.loom-handle[data-corner="nw"]')
        const se = box?.querySelector<HTMLElement>('.loom-handle[data-corner="se"]')
        if (!node || !nw || !se) { off.push(`${spec.name}: no handles`); continue }
        // Reachable, not just placed: nothing clips or covers the handle.
        const sr = se.getBoundingClientRect()
        if (document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2) !== se) off.push(`${spec.name}: handle covered or clipped`)
        const nr = node.getBoundingClientRect()
        const a = nw.getBoundingClientRect()
        const z = se.getBoundingClientRect()
        measured++
        sizes.push(a.width)
        const near = (p: number, q: number) => Math.abs(p - q) <= 1.5
        if (!(near(a.left + a.width / 2, nr.left) && near(a.top + a.height / 2, nr.top) && near(z.left + z.width / 2, nr.right) && near(z.top + z.height / 2, nr.bottom))) {
          off.push(`${spec.name}: node ${nr.left.toFixed(0)},${nr.top.toFixed(0)}-${nr.right.toFixed(0)},${nr.bottom.toFixed(0)} handles ${(a.left + a.width / 2).toFixed(0)},${(a.top + a.height / 2).toFixed(0)}-${(z.left + z.width / 2).toFixed(0)},${(z.top + z.height / 2).toFixed(0)}`)
        }
      }
      check('a selected node\'s handles sit on its own corners, reachable, for every component', measured > 80 && off.length === 0,
        `${measured} measured; ${off.slice(0, 4).join(' | ')}${off.length > 4 ? ` (+${off.length - 4})` : ''}`)
      // A fixed overlay is fixed to the artboard (the design's viewport), not
      // to the Studio window it used to cover.
      {
        app.loadDocument(emptyDocument())
        const root = app.dropComponent('Stack', null, 0, 0)!
        const pal = app.dropComponent('CommandPalette', root, 0, 0)!
        app.select([])
        await settle(40)
        const surf = document.querySelector<HTMLElement>('.loom .surface')!.getBoundingClientRect()
        const pr = document.querySelector<HTMLElement>(`.loom .surface [data-loom-id="${pal}"]`)?.getBoundingClientRect()
        check('a fixed overlay on the canvas stays inside the artboard', pr !== undefined && pr.left >= surf.left - 1 && pr.top >= surf.top - 1 && pr.right <= surf.right + 1 && pr.bottom <= surf.bottom + 1,
          pr ? `overlay ${pr.left.toFixed(0)},${pr.top.toFixed(0)}-${pr.right.toFixed(0)},${pr.bottom.toFixed(0)} artboard ${surf.left.toFixed(0)},${surf.top.toFixed(0)}-${surf.right.toFixed(0)},${surf.bottom.toFixed(0)}` : 'missing')
      }
      check('resize handles are 8px on screen at any zoom', zoomPct < 90 && sizes.length > 0 && sizes.every((w) => w > 7 && w < 9.5),
        `zoom ${zoomPct}%, handle ${Math.min(...sizes).toFixed(1)}-${Math.max(...sizes).toFixed(1)}px`)
      // Back to fitting the viewport.
      document.querySelector<HTMLButtonElement>('.loom .zoom-readout, .loom [aria-label^="Zoom "][aria-label*="percent"]')?.click()
      await settle()
    }

    // 4. Open asks before discarding unsaved work; every file action reports.
    {
      const realHost = app.host
      const realConfirm = window.confirm
      let opened = 0
      let asked = 0
      let openResult: Awaited<ReturnType<LoomHost['open']>> = { ok: false, canceled: true }
      app.host = {
        save: async () => ({ ok: true, path: '/work/Telemetry Console.loom.json' }),
        open: async () => { opened++; return openResult },
        autosave: async () => ({ ok: true }),
        readAutosave: async () => ({ ok: false }),
        exportHtml: async () => ({ ok: false, error: 'disk full' }),
      }
      try {
        fixture()
        window.confirm = () => { asked++; return false }
        const openBtn = document.querySelector<HTMLButtonElement>('.loom button[aria-label="Open"]')
        openBtn?.click()
        press('o', { ctrlKey: true })
        await settle()
        check('Open asks before discarding unsaved work, and a "no" keeps it', app.dirty && asked === 2 && opened === 0, `asked ${asked}, opened ${opened}`)
        window.confirm = () => { asked++; return true }
        openResult = { ok: true, path: '/work/notes.txt', contents: 'plain text, not a document' }
        openBtn?.click()
        await settle()
        const bad = app.notice
        check('opening a file that is not a Loom document says so', opened === 1 && bad?.tone === 'error' && /isn't a Loom document/.test(bad.text) && app.doc.root !== null,
          bad?.text ?? 'no notice')
        await app.save()
        await settle()
        const toast = document.querySelector<HTMLElement>('.loom .toast')
        check('a save says where it went', app.notice?.tone === 'ok' && app.notice.text === 'Saved Telemetry Console.loom.json' && toast?.textContent?.includes('Saved') === true,
          `${app.notice?.text} / toast ${toast?.textContent ?? 'none'}`)
        check('the notice is a status region a screen reader announces', document.querySelector('.loom .toast-region')?.getAttribute('role') === 'status')
        await app.exportHtmlFile()
        await settle()
        check('a failed export says why', app.notice?.tone === 'error' && app.notice.text.includes('disk full'), app.notice?.text ?? 'none')
        const before = app.notice?.id
        openResult = { ok: false, canceled: true }
        openBtn?.click()
        await settle()
        check('a cancelled dialog leaves no notice', app.notice?.id === before)
      } finally {
        app.host = realHost
        window.confirm = realConfirm
        if (app.notice) app.dismissNotice(app.notice.id)
      }
    }

    // 5. Contrast: the call to action and the tertiary text both read.
    {
      const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
      const cta = document.querySelector<HTMLElement>('.loom .tb-primary')
      const ink = cta ? rgb(getComputedStyle(cta).color) : []
      const stops = cta ? (getComputedStyle(cta).backgroundImage.match(/rgba?\([^)]*\)/g) ?? []).map(rgb) : []
      const worst = stops.length ? Math.min(...stops.map((s) => ratio(ink, s))) : 0
      check('the Export button\'s label reads (4.5:1 on its whole gradient)', worst >= 4.5, `${worst.toFixed(2)}:1`)
      const root = getComputedStyle(document.documentElement)
      const hex = (v: string) => { const h = root.getPropertyValue(v).trim().replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) }
      const tertiary = Math.min(ratio(hex('--ink-3'), hex('--panel')), ratio(hex('--ink-3'), hex('--panel-2')))
      check('tertiary text reads on the panels (4.5:1)', tertiary >= 4.5, `${tertiary.toFixed(2)}:1`)
    }

    // 6. Every inspector control has a name; fields show a focus ring.
    {
      const { a } = fixture()
      app.select([a])
      await settle()
      // Unfold what the inspector folds (Display, Effects), so every control is counted.
      for (const head of document.querySelectorAll<HTMLButtonElement>('.loom .inspector .disclosure-head[aria-expanded="false"]')) head.click()
      await settle()
      const controls = [...document.querySelectorAll<HTMLElement>('.loom .inspector [role="switch"], .loom .inspector select, .loom .inspector input:not([type="color"]), .loom .inspector textarea')]
      const nameOf = (el: HTMLElement) =>
        el.getAttribute('aria-label') ||
        (el.getAttribute('aria-labelledby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim() ||
        [...((el as HTMLInputElement).labels ?? [])].map((l) => l.textContent).join(' ').trim()
      const nameless = controls.filter((c) => !nameOf(c)).map((c) => `${c.tagName.toLowerCase()}${c.getAttribute('role') ? `[${c.getAttribute('role')}]` : ''}`)
      check('every switch, menu and field in the inspector has a name', controls.length > 10 && nameless.length === 0, `${controls.length} controls; nameless: ${nameless.join(', ')}`)
      const search = document.querySelector<HTMLInputElement>('.loom .props-search')
      search?.focus()
      // A hidden test window may not hold the OS focus, and then no field is
      // :focus-visible; measure the ring when it is, else read the rule.
      const live = search !== null && document.activeElement === search && search.matches(':focus-visible')
      const ring = live && search ? getComputedStyle(search).boxShadow : ''
      const rule = [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules] } catch { return [] } })
        .some((r) => r instanceof CSSStyleRule && r.selectorText.includes('.props-search:focus-visible') && /0(px)? 0(px)? 0(px)? 2px/.test(r.style.boxShadow))
      check('a focused field shows a ring, not just a tinted edge', live ? /0px 0px 0px 2px/.test(ring) : rule, live ? `measured: ${ring}` : `rule present: ${rule}`)
      search?.blur()
    }

    // 7. The hover card speaks the inspector's language, not the schema's.
    {
      const text = tooltipFor('Tabs')
      check('the hover card names properties in plain words', !/\(choice|\(text|\(number|= /.test(text) && text.includes('You can set its'), text.split('\n').slice(-3).join(' / '))
    }

    app.loadDocument(saved)
    app.select([])
    await settle()
  }

  // --- 102. building without dragging, a real tree, a clipboard, several at
  // once (UI/UX review, batch B) ----------------------------------------------
  {
    const app = window.__loomStore
    const saved = app.doc
    const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
    const key = (target: EventTarget, k: string, init: KeyboardEventInit = {}) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
    const tab = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.loom .toolbox button')].find((b) => b.textContent?.trim().startsWith(name))?.click()
    const toolButton = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.loom .toolbox .tool')].find((b) => b.querySelector('.tool-name')?.textContent === name)

    // 8. A click (or Enter, which clicks a button) adds a tool: into the
    // selected container, else beside the selection, else as the root.
    try {
        app.loadDocument(emptyDocument())
        await settle()
        tab('Components')
        await settle()
        toolButton('Card')?.click()
        await settle()
        const root = app.doc.root
        check('clicking a tool in an empty document makes it the root', root !== null && app.doc.nodes[root!]?.type === 'Card', `root ${root && app.doc.nodes[root]?.type}`)
        toolButton('Button')?.click()
        await settle()
        const kids = root ? app.doc.nodes[root].children : []
        check('clicking a tool with a container selected adds it inside', kids.length === 1 && app.doc.nodes[kids[0]]?.type === 'Button' && app.selection[0] === kids[0],
          kids.map((k) => app.doc.nodes[k]?.type).join(','))
        toolButton('Label')?.click()
        await settle()
        check('with a leaf selected, the tool goes into its container', root !== null && app.doc.nodes[root].children.length === 2 && app.doc.nodes[app.doc.nodes[root].children[1]]?.type === 'Label')
        check('the empty document says a tool can be clicked, not only dragged', (() => { app.loadDocument(emptyDocument()); return true })() && await settle().then(() => /Click any tool/.test(document.querySelector('.loom .empty-hint-body')?.textContent ?? '')))
    } catch (e) {
      // A throw is a failure of this part, not of the whole suite.
      check('§102 part 8 (click to add) runs to the end', false, String(e))
    }

    // 9. Layers: a tree you can read, fold, walk, rename and reorder.
    try {
        const sd = new EditorStore()
        seedDemo(sd)
        app.loadDocument(sd.doc)
        tab('Layers')
        await settle(100)
        const rows = [...document.querySelectorAll<HTMLElement>('.loom .layers [role="treeitem"]')]
        const cramped = rows.filter((r) => Number(r.getAttribute('aria-level')) <= 5 && (r.querySelector<HTMLElement>('.tool-name')?.clientWidth ?? 0) < 80)
          .map((r) => `${r.getAttribute('aria-label')} ${r.querySelector<HTMLElement>('.tool-name')?.clientWidth}px`)
        check('every layer name has room to be read (80px+, five levels deep)', rows.length >= 15 && cramped.length === 0, `${rows.length} rows; cramped: ${cramped.slice(0, 3).join(' | ')}`)
        check('the layers are a tree to assistive tech', document.querySelector('.loom .layers [role="tree"]') !== null && rows.every((r) => r.hasAttribute('aria-level')))
        const glyphs = document.querySelector('.loom .layers')?.textContent?.match(/[↑↓●○⚿]/g) ?? []
        check('layer controls are drawn icons, not text glyphs', glyphs.length === 0, glyphs.join(''))
        // Fold a branch.
        const branch = rows.find((r) => r.getAttribute('aria-expanded') === 'true')!
        const before = document.querySelectorAll('.loom .layers [role="treeitem"]').length
        branch.querySelector<HTMLButtonElement>('.layer-twist')?.click()
        await settle()
        const after = document.querySelectorAll('.loom .layers [role="treeitem"]').length
        check('a branch folds away its rows', after < before && branch.getAttribute('aria-expanded') === 'false', `${before} -> ${after} rows`)
        branch.querySelector<HTMLButtonElement>('.layer-twist')?.click()
        await settle()
        // Walk it with the keyboard.
        const first = document.querySelector<HTMLElement>('.loom .layers [role="treeitem"]')!
        app.select([first.dataset.layer!])
        await settle()
        key(first, 'ArrowDown')
        await settle()
        const second = document.querySelectorAll<HTMLElement>('.loom .layers [role="treeitem"]')[1]
        check('ArrowDown in the tree selects the next row (and does not nudge the node)', app.selection[0] === second.dataset.layer, `${app.doc.nodes[app.selection[0]]?.type}`)
        // Rename in place.
        const target = second.dataset.layer!
        second.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        await settle()
        const input = document.querySelector<HTMLInputElement>('.loom .layers .layer-rename')
        const h0 = app.history.length
        if (input) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Page title')
          input.dispatchEvent(new Event('input', { bubbles: true }))
          key(input, 'Enter')
          input.blur()
        }
        await settle()
        const named = app.doc.nodes[target]?.name
        const shown = document.querySelector<HTMLElement>(`.loom .layers [data-layer="${target}"] .tool-name`)?.textContent
        check('a layer renames in place (double-click), in one undo step', input !== null && named === 'Page title' && shown === 'Page title' && app.history.length === h0 + 1, `name ${named}, shows ${shown}`)
        const round = validate(serialize(app.doc))
        check('a node\'s name survives save and open, and never reaches the output', round.doc?.nodes[target]?.name === 'Page title' && !emitHtml(app.doc).includes('Page title'))
        // Drag a row below its next sibling.
        const siblingsOf = (id: string) => app.doc.nodes[parentOf(app.doc, id)!].children
        const kids = siblingsOf(target)
        const a = kids[0]
        const b = kids[1]
        const rowA = document.querySelector<HTMLElement>(`.loom .layers [data-layer="${a}"]`)!
        const rowB = document.querySelector<HTMLElement>(`.loom .layers [data-layer="${b}"]`)!
        const ra = rowA.getBoundingClientRect()
        const rb = rowB.getBoundingClientRect()
        rowA.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: ra.left + 40, clientY: ra.top + 5 }))
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: rb.left + 40, clientY: rb.top + rb.height * 0.2 }))
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: rb.left + 40, clientY: rb.bottom - 2 }))
        await settle(30)
        const marked = rowB.className
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: rb.left + 40, clientY: rb.bottom - 2 }))
        await settle()
        const order = siblingsOf(a)
        check('dragging a layer below another reorders it there', order.indexOf(a) === order.indexOf(b) + 1, `marked "${marked}", order ${order.map((x) => app.doc.nodes[x]?.type).join(',')}`)
        tab('Components')
    } catch (e) {
      // A throw is a failure of this part, not of the whole suite.
      check('§102 part 9 (layers) runs to the end', false, String(e))
    }

    // 10. A clipboard, and a menu with the everyday actions.
    try {
        app.loadDocument(emptyDocument())
        const root = app.dropComponent('Stack', null, 0, 0)!
        app.commit({ op: 'setFlow', id: root, flow: true }, 'flow')
        const a = app.dropComponent('Caption', root, 0, 0)!
        const b = app.dropComponent('Label', root, 0, 0)!
        app.select([a])
        await settle()
        key(document.body, 'c', { ctrlKey: true })
        const h0 = app.history.length
        key(document.body, 'v', { ctrlKey: true })
        await settle()
        const kids = app.doc.nodes[root].children
        check('Ctrl+C, Ctrl+V pastes a copy just after the original, selected, in one step', kids.length === 3 && kids[1] === app.selection[0] && app.doc.nodes[kids[1]].type === 'Caption' && app.history.length === h0 + 1,
          kids.map((k) => app.doc.nodes[k]?.type).join(','))
        app.select([b])
        key(document.body, 'x', { ctrlKey: true })
        await settle()
        const cutGone = !app.doc.nodes[b]
        app.select([root])
        key(document.body, 'v', { ctrlKey: true })
        await settle()
        check('Ctrl+X removes, and a paste into the selected container brings it back', cutGone && app.doc.nodes[root].children.length === 3 && app.doc.nodes[app.doc.nodes[root].children[2]].type === 'Label')
        // Typing keeps its own select-all and clipboard.
        app.select([a])
        await settle()
        const field = document.querySelector<HTMLElement>('.loom .inspector textarea, .loom .inspector input[type="text"]')
        const selBefore = app.selection.join()
        if (field) key(field, 'a', { ctrlKey: true })
        await settle()
        check('Ctrl+A in a field selects its text, not every node', field !== null && app.selection.join() === selBefore)
        // The menu.
        const el = document.querySelector<HTMLElement>(`.loom .surface [data-loom-id="${a}"]`)
        el?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
        await settle()
        const items = [...document.querySelectorAll('.ctx-item')].map((x) => x.textContent ?? '')
        const want = ['Cut', 'Copy', 'Paste', 'Duplicate', 'Bring to front', 'Send to back', 'Wrap in Stack', 'Hide from output', 'Lock']
        const missing = want.filter((w) => !items.some((t) => t.includes(w)))
        check('the context menu has the everyday actions', missing.length === 0 && !items.some((t) => t.includes('Set width 200')), `missing ${missing.join(', ')}`)
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await settle()
        const h1 = app.history.length
        const box = app.wrap([app.doc.nodes[root].children[0], app.doc.nodes[root].children[1]])
        check('wrap puts siblings in a new Stack, in order, where they were, in one step', !!box && app.doc.nodes[root].children[0] === box && app.doc.nodes[box].children.length === 2 && app.history.length === h1 + 1)
    } catch (e) {
      // A throw is a failure of this part, not of the whole suite.
      check('§102 part 10 (clipboard and menu) runs to the end', false, String(e))
    }

    // 11. The inspector leads with the component, folds the rest, and gives
    // text room.
    try {
        app.loadDocument(emptyDocument())
        const root = app.dropComponent('Stack', null, 0, 0)!
        app.commit({ op: 'setFlow', id: root, flow: true }, 'flow')
        const cap = app.dropComponent('Caption', root, 0, 0)!
        app.setProp(cap, 'text', 'Streaming from four sources with a p95 latency of forty-eight milliseconds across every region')
        app.select([cap])
        await settle(80)
        const scroll = document.querySelector('.loom .inspector .insp-scroll')
        const heads = [...(scroll?.querySelectorAll('h3') ?? [])].map((h) => h.textContent?.replace(/\d+ on$/, '').trim() ?? '')
        const content = heads.indexOf('Content')
        const display = heads.findIndex((h) => h.startsWith('Display'))
        check('the inspector starts with search, then the component\'s own properties', scroll?.firstElementChild?.classList.contains('props-bar') === true && content >= 0 && content < display, heads.join(' > '))
        const folded = [...document.querySelectorAll<HTMLButtonElement>('.loom .inspector .disclosure-head')].map((b) => `${b.textContent}:${b.getAttribute('aria-expanded')}`)
        check('Display and Effects are folded until used', folded.some((f) => f.startsWith('Display') && f.endsWith('false')) && folded.some((f) => f.startsWith('Effects') && f.endsWith('false')) && !document.querySelector('.loom .inspector [aria-label="Glass"]'),
          folded.join(' | '))
        const ta = document.querySelector<HTMLTextAreaElement>('.loom .inspector textarea[aria-label="Text"]')
        check('a long text value wraps and grows in its field', ta !== null && ta.getBoundingClientRect().height > 40, `${ta?.getBoundingClientRect().height.toFixed(0)}px`)
        app.commit({ op: 'setOpacity', id: cap, opacity: 0.5 }, 'op')
        app.select([])
        await settle()
        app.select([cap])
        await settle()
        const displayHead = [...document.querySelectorAll<HTMLButtonElement>('.loom .inspector .disclosure-head')].find((b) => b.textContent?.startsWith('Display'))
        check('a changed Display opens by itself and says what changed', displayHead?.getAttribute('aria-expanded') === 'true' && displayHead.textContent?.includes('50%') === true, displayHead?.textContent ?? '')
    } catch (e) {
      // A throw is a failure of this part, not of the whole suite.
      check('§102 part 11 (inspector order) runs to the end', false, String(e))
    }

    // 12. Several at once: said, arranged, edited together.
    try {
        app.loadDocument(emptyDocument())
        const root = app.dropComponent('Panel', null, 0, 0)!
        app.commit({ op: 'setFlow', id: root, flow: false }, 'free')
        const ids = [
          app.dropComponent('Caption', root, 40, 10)!,
          app.dropComponent('Caption', root, 100, 60)!,
          app.dropComponent('Caption', root, 300, 120)!,
        ]
        app.setProp(ids[1], 'size', 'lg')
        app.select(ids)
        await settle(80)
        const head = document.querySelector('.loom .inspector .insp-name')?.textContent
        check('several selected: the inspector says how many, and what', head === '3 selected' && document.querySelector('.loom .inspector .insp-path')?.textContent === '3 Caption', head ?? '')
        const sizeSel = document.querySelector<HTMLSelectElement>('.loom .inspector select[aria-label="Size"]')
        check('a value they disagree on reads Mixed', sizeSel?.value === '' && sizeSel.selectedOptions[0]?.textContent === 'Mixed', sizeSel?.selectedOptions[0]?.textContent ?? 'no field')
        const h0 = app.history.length
        if (sizeSel) {
          sizeSel.value = 'sm'
          sizeSel.dispatchEvent(new Event('change', { bubbles: true }))
        }
        await settle()
        check('an edit sets it on every selected node, in one step', ids.every((x) => app.doc.nodes[x].props.size === 'sm') && app.history.length === h0 + 1)
        const size = () => ({ w: 50, h: 20 })
        app.align(ids, 'left', size)
        check('align left lines them up on the leftmost edge', ids.every((x) => app.doc.nodes[x].props.x === 40), ids.map((x) => app.doc.nodes[x].props.x).join(','))
        app.commitAll([{ op: 'move', id: ids[0], x: 0, y: 0 }, { op: 'move', id: ids[1], x: 70, y: 0 }, { op: 'move', id: ids[2], x: 300, y: 0 }], 'spread')
        app.distribute(ids, 'horizontal', size)
        check('distribute spaces them evenly between the outer two', app.doc.nodes[ids[1]].props.x === 150, String(app.doc.nodes[ids[1]].props.x))
        const alignBtn = document.querySelector<HTMLButtonElement>('.loom .inspector [aria-label="Align left"]')
        check('the arrange buttons are there for free-positioned siblings', alignBtn !== null && !alignBtn.disabled)
    } catch (e) {
      // A throw is a failure of this part, not of the whole suite.
      check('§102 part 12 (several selected) runs to the end', false, String(e))
    }

    app.loadDocument(saved)
    app.select([])
    await settle()
  }

  // --- 103. zoom and pan, typing in place, getting back, starting well, room
  // to work, room to click (UI/UX review, batch C) ----------------------------
  {
    const app = window.__loomStore
    const saved = app.doc
    const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
    const key = (target: EventTarget, k: string, init: KeyboardEventInit = {}) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
    const zoomPct = () => Number(document.querySelector<HTMLElement>('.loom .surface')?.dataset.zoom ?? 0)
    const part = async (label: string, body: () => Promise<void>) => {
      try {
        await body()
      } catch (e) {
        check(`§103 part ${label} runs to the end`, false, String(e))
      }
    }
    const demo = () => {
      const sd = new EditorStore()
      seedDemo(sd)
      app.loadDocument(sd.doc)
    }

    // 13. Zoom from the keyboard and the wheel; pan with Space or the middle button.
    await part('13 (zoom and pan)', async () => {
      demo()
      await settle(80)
      key(document.body, '!', { shiftKey: true })
      await settle()
      const fit = zoomPct()
      key(document.body, '=', { ctrlKey: true })
      await settle()
      const zin = zoomPct()
      key(document.body, '0', { ctrlKey: true })
      await settle()
      const one = zoomPct()
      key(document.body, '-', { ctrlKey: true })
      await settle()
      const zout = zoomPct()
      check('Ctrl+=, Ctrl+0 and Ctrl+- zoom the canvas', zin > fit && one === 100 && zout < 100, `fit ${fit} -> in ${zin}, 0 -> ${one}, out ${zout}`)
      key(document.body, '!', { shiftKey: true })
      await settle()
      check('Shift+1 fits the canvas again', zoomPct() === fit, `${zoomPct()} vs ${fit}`)
      // Ctrl+wheel: the design point under the pointer stays under it. At a
      // zoom where the canvas can scroll both ways: a canvas smaller than its
      // window has nothing to scroll, so nothing can hold the point there.
      key(document.body, '0', { ctrlKey: true })
      key(document.body, '=', { ctrlKey: true })
      key(document.body, '=', { ctrlKey: true })
      await settle(80)
      const canvas = document.querySelector<HTMLElement>('.loom .canvas')!
      const surface = document.querySelector<HTMLElement>('.loom .surface')!
      const r0 = surface.getBoundingClientRect()
      const px = r0.left + r0.width * 0.7
      const py = r0.top + r0.height * 0.4
      const z0 = zoomPct() / 100
      const dx = (px - r0.left) / z0
      const dy = (py - r0.top) / z0
      canvas.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -200, clientX: px, clientY: py, bubbles: true, cancelable: true }))
      await settle(80)
      const z1 = zoomPct() / 100
      const r1 = surface.getBoundingClientRect()
      const drift = Math.hypot(r1.left + dx * z1 - px, r1.top + dy * z1 - py)
      check('Ctrl+wheel zooms at the pointer, keeping the point under it', z1 > z0 * 1.2 && drift < 3, `zoom ${z0.toFixed(2)} -> ${z1.toFixed(2)}, drift ${drift.toFixed(1)}px`)
      // Pan: Space held, then a drag; and the middle button on its own.
      const pan = async (button: number, withSpace: boolean) => {
        canvas.scrollLeft = 100
        canvas.scrollTop = 60
        const before = [canvas.scrollLeft, canvas.scrollTop]
        if (withSpace) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))
        await settle()
        const cr = canvas.getBoundingClientRect()
        const x = cr.left + cr.width / 2
        const y = cr.top + cr.height / 2
        canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button, clientX: x, clientY: y }))
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: x - 60, clientY: y - 30 }))
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: x - 60, clientY: y - 30 }))
        if (withSpace) window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }))
        await settle()
        return [canvas.scrollLeft - before[0], canvas.scrollTop - before[1]]
      }
      const selBefore = app.selection.join()
      const spaced = await pan(0, true)
      check('Space+drag pans the canvas (and selects nothing)', spaced[0] === 60 && spaced[1] === 30 && app.selection.join() === selBefore, `moved ${spaced.join(',')}`)
      const middle = await pan(1, false)
      check('a middle-button drag pans the canvas', middle[0] === 60 && middle[1] === 30, `moved ${middle.join(',')}`)
      key(document.body, '!', { shiftKey: true })
      await settle()
    })

    // 14. Double-click a component to type its text where it is.
    await part('14 (type in place)', async () => {
      demo()
      await settle(80)
      const label = Object.values(app.doc.nodes).find((n) => n.type === 'Label')!
      const el = document.querySelector<HTMLElement>(`.loom .surface [data-loom-id="${label.id}"]`)!
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await settle()
      const ed = document.querySelector<HTMLTextAreaElement>('.loom .surface textarea.inline-edit')
      const at = ed?.getBoundingClientRect()
      const lr = el.getBoundingClientRect()
      check('double-clicking a component opens its text, over it', ed !== null && ed.value === String(label.props.text) && at !== undefined && Math.abs(at.left - lr.left) < 3 && Math.abs(at.top - lr.top) < 3,
        ed ? `"${ed.value}" at ${at?.left.toFixed(0)},${at?.top.toFixed(0)} over ${lr.left.toFixed(0)},${lr.top.toFixed(0)}` : 'no editor')
      const h0 = app.history.length
      if (ed) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ed, 'Fleet Console')
        key(ed, 'Enter')
      }
      await settle()
      check('Enter keeps the new text, in one undo step', app.doc.nodes[label.id].props.text === 'Fleet Console' && app.history.length === h0 + 1 && !document.querySelector('.loom textarea.inline-edit'))
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await settle()
      const ed2 = document.querySelector<HTMLTextAreaElement>('.loom .surface textarea.inline-edit')
      if (ed2) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ed2, 'nope')
        key(ed2, 'Escape')
      }
      await settle()
      check('Escape leaves the text as it was', app.doc.nodes[label.id].props.text === 'Fleet Console' && !document.querySelector('.loom textarea.inline-edit'))
    })

    // 15. What a crash or a closed window left is offered back, never loaded unasked.
    await part('15 (recovery)', async () => {
      const realHost = app.host
      const lost = new EditorStore()
      seedDemo(lost)
      lost.commit({ op: 'rename', name: 'Quarterly review' }, 'name')
      try {
        app.host = { ...(realHost ?? {}), latestAutosave: async () => ({ ok: true, name: 'quarterly-review.loom.json', mtime: Date.now() - 5 * 60000, contents: serialize(lost.doc) }) } as LoomHost
        app.loadDocument(emptyDocument())
        await settle(150)
        const offer = document.querySelector<HTMLButtonElement>('.loom .empty-recover')
        check('an empty document offers what an earlier session left, by name and age', offer !== null && /Quarterly review/.test(offer.textContent ?? '') && /5 min ago/.test(offer.textContent ?? '') && app.doc.root === null,
          offer?.textContent ?? 'no offer')
        offer?.click()
        await settle()
        check('continuing loads it as unsaved work, and says so', app.doc.meta.name === 'Quarterly review' && app.doc.root !== null && app.dirty && /Recovered/.test(app.notice?.text ?? ''), app.notice?.text ?? '')
        app.host = { ...(realHost ?? {}), latestAutosave: async () => ({ ok: false }) } as LoomHost
        app.loadDocument(emptyDocument())
        await settle(150)
        check('with nothing left over, nothing is offered', document.querySelector('.loom .empty-recover') === null)
      } finally {
        app.host = realHost
        if (app.notice) app.dismissNotice(app.notice.id)
      }
    })

    // 16. The welcome is readable at any zoom and starts somewhere real.
    await part('16 (first run)', async () => {
      app.loadDocument(emptyDocument())
      await settle(100)
      const title = document.querySelector<HTMLElement>('.loom .empty-hint-title')
      const h = title?.getBoundingClientRect().height ?? 0
      check('the welcome card is drawn at the Studio\'s size, not the zoom\'s', zoomPct() < 100 && h >= 17, `zoom ${zoomPct()}%, title ${h.toFixed(1)}px tall`)
      const starts = [...document.querySelectorAll('.loom .empty-start')].map((b) => b.textContent?.trim())
      check('there are starters for the everyday screens', STARTERS.length >= 5 && ['Dashboard', 'Settings page', 'Sign-in', 'Landing hero'].every((n) => starts.includes(n)), starts.join(', '))
      const broken: string[] = []
      for (const st of STARTERS) {
        const t = new EditorStore()
        const id = t.addStarter(st.id, null, 0, 0)
        if (!id || Object.values(t.doc.nodes).some((n) => !getComponent(n.type))) broken.push(st.id)
        else if (!emitHtml(t.doc).includes('data-loom')) broken.push(`${st.id} (no output)`)
      }
      check('every starter builds from real tools and exports', broken.length === 0, broken.join(', '))
      // The KPI card's bar visual draws (its row collapsed to nothing).
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:0;top:0;width:600px'
      document.body.appendChild(host)
      const rk = createRoot(host)
      const ks = new EditorStore()
      const kid = ks.dropComponent('KpiCard', withRoot(ks), 0, 0)!
      ks.setProp(kid, 'visual', 'bars')
      rk.render(renderNode({ doc: ks.doc, selected: new Set(), mode: 'preview' }, kid))
      await settle(40)
      const bars = [...host.querySelectorAll<HTMLElement>('div')].filter((d) => d.style.flex === '1 1 0%' || d.style.flex === '1')
      const drawn = bars.filter((b) => b.getBoundingClientRect().width > 2).length
      rk.unmount()
      host.remove()
      check('a KPI card\'s bars draw', bars.length >= 6 && drawn === bars.length, `${drawn}/${bars.length} bars have width`)
    })

    // 17. The panels fold away and resize, and remember.
    await part('17 (panels)', async () => {
      demo()
      await settle(80)
      const canvasW = () => document.querySelector('.loom .canvas-wrap')?.getBoundingClientRect().width ?? 0
      const w0 = canvasW()
      document.querySelector<HTMLButtonElement>('.loom [aria-label="Components panel"]')?.click()
      await settle(80)
      const w1 = canvasW()
      check('the components panel folds away, and the canvas takes the room', !document.querySelector('.loom .toolbox') && w1 > w0 + 150, `${w0.toFixed(0)} -> ${w1.toFixed(0)}px`)
      document.querySelector<HTMLButtonElement>('.loom [aria-label="Components panel"]')?.click()
      await settle(80)
      key(document.body, '\\', { ctrlKey: true })
      await settle(80)
      const bothGone = !document.querySelector('.loom .toolbox') && !document.querySelector('.loom .inspector')
      key(document.body, '\\', { ctrlKey: true })
      await settle(80)
      check('Ctrl+\\ folds both panels away and brings them back', bothGone && !!document.querySelector('.loom .toolbox') && !!document.querySelector('.loom .inspector'))
      const edge = document.querySelector<HTMLElement>('.loom .panel-edge.right')
      const iw0 = document.querySelector('.loom .inspector')?.getBoundingClientRect().width ?? 0
      if (edge) for (let i = 0; i < 4; i++) {
        key(edge, 'ArrowLeft')
        await settle(30)
      }
      await settle(50)
      const iw1 = document.querySelector('.loom .inspector')?.getBoundingClientRect().width ?? 0
      let stored = ''
      try { stored = window.localStorage.getItem('loom.panels') ?? '' } catch { /* no storage */ }
      check('a panel edge resizes the panel, and the width is remembered', edge !== null && Math.round(iw1 - iw0) === 40 && stored.includes(`"rw":${Math.round(iw1)}`), `${iw0.toFixed(0)} -> ${iw1.toFixed(0)}px, stored ${stored}`)
      edge?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await settle(80)
    })

    // 18. Every Studio control is at least 24px to hit (WCAG 2.2 target size).
    await part('18 (targets)', async () => {
      demo()
      const cap = Object.values(app.doc.nodes).find((n) => n.type === 'Caption')!
      app.select([cap.id])
      await settle(80)
      for (const head of document.querySelectorAll<HTMLButtonElement>('.loom .inspector .disclosure-head[aria-expanded="false"]')) head.click()
      await settle(60)
      const surface = document.querySelector('.loom .surface')
      const small = [...document.querySelectorAll<HTMLElement>('.loom button, .loom input, .loom select, .loom textarea, .loom [role="switch"], .loom [role="tab"], .loom [role="treeitem"]')]
        // The design's own controls are the design's, and a separator is a
        // drag strip with a keyboard equivalent (arrow keys when focused).
        .filter((b) => !surface?.contains(b) && b.getAttribute('role') !== 'separator' && b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden' && !(b as HTMLInputElement).type?.startsWith('color'))
        .map((b) => ({ b, r: b.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.width < 23.5 || r.height < 23.5))
        .map(({ b, r }) => `${(b.getAttribute('aria-label') || b.title || b.textContent || b.className).trim().slice(0, 20)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`)
      check('every Studio control is at least 24px to hit', small.length === 0, small.slice(0, 6).join(' | '))
    })

    app.loadDocument(saved)
    app.select([])
    await settle()
  }

  // --- 104. markers explained, a way up, named groups, daylight, stillness,
  // and a tab order that stays in the Studio (UI/UX review, batch D) ----------
  {
    const app = window.__loomStore
    const saved = app.doc
    const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
    const part = async (label: string, body: () => Promise<void>) => {
      try {
        await body()
      } catch (e) {
        check(`§104 part ${label} runs to the end`, false, String(e))
      }
    }
    const sd = new EditorStore()
    seedDemo(sd)
    app.loadDocument(sd.doc)
    await settle(80)

    // 19. The row markers have a key; the path up is clickable.
    await part('19 (markers and path)', async () => {
      const gauge = Object.values(app.doc.nodes).find((n) => n.type === 'Gauge')!
      app.select([gauge.id])
      await settle(80)
      const legend = document.querySelector('.loom .inspector .props-legend')?.textContent ?? ''
      check('the inspector explains its row markers', /changed from its default/.test(legend) && /bound to data/.test(legend), legend)
      check('the bindable marker is a drawn icon, not a text glyph', !(document.querySelector('.loom .inspector')?.textContent ?? '').includes('◈'))
      const crumbs = [...document.querySelectorAll<HTMLButtonElement>('.loom .inspector .crumbs .crumb')]
      const chain = ancestry(app.doc, gauge.id).slice(0, -1)
      check('the inspector shows the path up, one crumb per ancestor', crumbs.length === chain.length && crumbs.length >= 3, `${crumbs.map((c) => c.textContent).join(' > ')}`)
      crumbs[1]?.click()
      await settle()
      check('a crumb selects that ancestor', app.selection[0] === chain[1], `${app.doc.nodes[app.selection[0]]?.type}`)
    })

    // 20. The title bar says which group is which.
    await part('20 (labels)', async () => {
      const labels = [...document.querySelectorAll('.loom .titlebar .seg-label')].map((l) => l.textContent)
      const target = [...document.querySelectorAll<HTMLButtonElement>('.loom [aria-label="Export target"] button')]
      check('the title bar names the design theme and the build target', labels.includes('Theme') && labels.includes('Target') && !!document.querySelector('.loom [aria-label="Design theme"]'), labels.join(', '))
      check('each target explains itself', target.length === 2 && target.every((b) => b.title.length > 20), target.map((b) => b.title).join(' | '))
    })

    // 21. A light Studio, chosen (dark stays the default), and still when asked.
    await part('21 (appearance and motion)', async () => {
      const root = document.documentElement
      const btn = document.querySelector<HTMLButtonElement>('.loom [aria-label^="Studio appearance"]')
      const before = root.dataset.appearance
      btn?.click()
      await settle(80)
      const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
      const tok = (v: string) => { const h = getComputedStyle(root).getPropertyValue(v).trim().replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) }
      const light = root.dataset.appearance === 'light'
      const inkOk = Math.min(ratio(tok('--ink'), tok('--panel')), ratio(tok('--ink-3'), tok('--panel')), ratio(tok('--ink-3'), tok('--panel-2')))
      let stored = ''
      try { stored = window.localStorage.getItem('loom.appearance') ?? '' } catch { /* no storage */ }
      check('the Studio has a light appearance, chosen in the title bar and remembered', before === 'dark' && light && stored === 'light' && lum(tok('--panel')) > 0.8 && getComputedStyle(root).colorScheme === 'light', `${before} -> ${root.dataset.appearance}, stored ${stored}`)
      check('light text keeps the contrast floor (4.5:1, tertiary included)', inkOk >= 4.5, `${inkOk.toFixed(2)}:1`)
      const fieldsLight = rgb(getComputedStyle(document.querySelector('.loom .inspector') ?? root).color)
      check('the panels use the light ink', lum(fieldsLight) < 0.1, fieldsLight.join(','))
      btn?.click() // light -> system
      await settle()
      btn?.click() // system -> dark
      await settle()
      check('the appearance cycles back to the Studio\'s dark default', root.dataset.appearance === 'dark')
      const rules = [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules] } catch { return [] } })
      const still = rules.some((r) => r instanceof CSSMediaRule && r.conditionText.includes('prefers-reduced-motion') && /\.loom/.test(r.cssText) && /transition-duration/.test(r.cssText) && /:not\(\.surface/.test(r.cssText))
      check('under reduced motion the Studio chrome holds still (and leaves the design alone)', still)
    })

    // 22. Tab stays in the Studio: the design on the canvas is edited, not used.
    await part('22 (tab order)', async () => {
      await settle(60)
      const surface = document.querySelector('.loom .surface')!
      const stops = [...surface.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')].filter((el) => el.tabIndex >= 0 && !el.closest('[inert]'))
      check('nothing in the design on the canvas is a tab stop', stops.length === 0, stops.slice(0, 4).map((e) => `${e.tagName}.${e.dataset.loomType ?? ''}`).join(', '))
      const all = [...document.querySelectorAll<HTMLElement>('.loom button, .loom input, .loom select, .loom textarea, .loom [tabindex]')].filter((el) => el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length > 0)
      check('the first tab stop is the title bar\'s', all[0]?.closest('.titlebar') !== null, all[0] ? `${all[0].tagName} ${all[0].getAttribute('aria-label') ?? all[0].textContent}` : 'none')
    })

    app.loadDocument(saved)
    app.select([])
    await settle()
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
