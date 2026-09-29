/**
 * Drag E2E (CDP, real trusted mouse input through Chromium).
 *
 * 1. Free context: toggle a demo card to free via the REAL Inspector
 *    switch, then drag its gauge — node x/y must change, history +1.
 * 2. Flow context: drag the footer label above the stats panel — root
 *    children must reorder, history +1, no phantom entries.
 *
 * Self-contained: spawns its own Electron (demo scene, X11, unique debug
 * port) and kills exactly what it spawned — never pkill, never a fixed
 * victim. Usage: `npm run probe:drag` (builds first). Needs an X display.
 */
import { spawn } from 'node:child_process'
import electronPath from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const PORT = Number(process.env.LOOM_CDP_PORT || 9335)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const step = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function targets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`)
  return r.json()
}
function rpc(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`cdp timeout: ${method}`)), 20000)
    const onMsg = (ev) => {
      let m
      try {
        m = JSON.parse(ev.data)
      } catch {
        return
      }
      if (m.id === id) {
        clearTimeout(to)
        ws.removeEventListener('message', onMsg)
        if (m.error) reject(new Error(JSON.stringify(m.error)))
        else resolve(m.result)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const evaluate = (ws, expression) =>
  rpc(ws, 'Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value)
async function attach(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  return ws
}
async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout: ${label}`)
    await sleep(500)
  }
}
// `held` = modifier keys held while moving and on release (8 = Shift),
// the way a person presses Shift partway through a drag.
async function drag(ws, x0, y0, x1, y1, stepsN = 12, held = 0) {
  await rpc(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 })
  await sleep(150)
  for (let i = 1; i <= stepsN; i++) {
    const x = x0 + ((x1 - x0) * i) / stepsN
    const y = y0 + ((y1 - y0) * i) / stepsN
    await rpc(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', modifiers: held })
    await sleep(30)
  }
  await sleep(150)
  await rpc(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1, modifiers: held })
  await sleep(600)
}

let child = null
try {
  const env = { ...process.env }
  delete env.WAYLAND_DISPLAY
  env.XDG_SESSION_TYPE = 'x11'
  env.ELECTRON_OZONE_PLATFORM_HINT = 'x11'
  env.LOOM_DEMO = '1'
  env.DISPLAY = env.DISPLAY || ':0'
  // Spawn Electron DIRECTLY and in its own process group. Going through `npx`
  // put a node wrapper between us and the Electron main process, so killing
  // the wrapper orphaned the app: every failed probe left a live instance
  // holding port 9335, and the next run attached to that stale window instead
  // of its own. A group leader can be killed as a unit, children included.
  child = spawn(electronPath, ['.', `--remote-debugging-port=${PORT}`], {
    cwd: root,
    env,
    stdio: 'ignore',
    detached: true,
  })

  const editor = await waitFor(async () => {
    try {
      const ts = await targets()
      return ts.find((t) => t.type === 'page' && t.url.includes('index.html') && !t.url.includes('preview'))
    } catch {
      return null
    }
  }, 90000, 'editor')
  step('editor target listed', Boolean(editor))
  const ews = await attach(editor)

  // The target exists before the renderer has run: the page is listed while
  // its bundle is still booting, so probing the store immediately races the
  // app and reports a phantom failure. Wait for a SEEDED document.
  await waitFor(
    async () => evaluate(ews, 'Boolean(window.__loomStore && Object.keys(window.__loomStore.doc.nodes).length > 1)'),
    60000,
    'seeded document',
  )

  const ids = await evaluate(
    ews,
    `(() => { const d = window.__loomStore.doc; const gauge = Object.keys(d.nodes).find((k) => d.nodes[k].type === 'Gauge');
      const card = gauge ? Object.keys(d.nodes).find((k) => d.nodes[k].children.includes(gauge)) : null;
      const footer = d.nodes[d.root].children[d.nodes[d.root].children.length - 1];
      return { gauge, card, footer, rootKids: d.nodes[d.root].children }; })()`,
  )
  step('demo fixture located', Boolean(ids?.gauge && ids?.card && ids?.footer))

  await evaluate(ews, `window.__loomStore.select(${JSON.stringify([ids.card])})`)
  await sleep(500)
  const toggled = await evaluate(
    ews,
    `(() => { const secs = [...document.querySelectorAll('.inspector section')];
      const lay = secs.find((s) => s.querySelector('h3')?.textContent === 'Layout');
      const sw = lay?.querySelector('button[role="switch"]');
      if (!sw) return 'no-switch'; sw.click(); return 'clicked'; })()`,
  )
  step('inspector Flow toggle clicked', toggled === 'clicked', String(toggled))
  await sleep(500)
  const freeNow = await evaluate(ews, `window.__loomStore.doc.nodes[${JSON.stringify(ids.card)}].flow === false`)
  step('card is free after toggle', freeNow === true)

  const g0 = await evaluate(
    ews,
    `(() => { const r = document.querySelector('[data-loom-id="${ids.gauge}"]').getBoundingClientRect();
      const n = window.__loomStore.doc.nodes[${JSON.stringify(ids.gauge)}];
      const z = Number(document.querySelector('.surface').dataset.zoom) / 100;
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, x: n.props.x, y: n.props.y, z, hist: window.__loomStore.history.length }; })()`,
  )
  await drag(ews, g0.cx, g0.cy, g0.cx + 140, g0.cy + 90)
  const g1 = await evaluate(
    ews,
    `(() => { const n = window.__loomStore.doc.nodes[${JSON.stringify(ids.gauge)}];
      return { x: n.props.x, y: n.props.y, hist: window.__loomStore.history.length }; })()`,
  )
  // Screen pixels are doc pixels times the zoom (the canvas opens at Fit).
  const ex = g0.x + 140 / g0.z, ey = g0.y + 90 / g0.z
  step('free drag moves the node',
    Math.abs(g1.x - ex) <= 8 && Math.abs(g1.y - ey) <= 8,
    `(${g0.x},${g0.y}) -> (${g1.x},${g1.y}), expected (${ex.toFixed(0)},${ey.toFixed(0)}) at zoom ${g0.z}`)
  step('free drag seals to exactly one history entry', g1.hist === g0.hist + 1, `${g0.hist} -> ${g1.hist}`)

  const f0 = await evaluate(
    ews,
    `(() => { const d = window.__loomStore.doc;
      const stats = d.nodes[d.root].children[1];
      const sr = document.querySelector('[data-loom-id="' + stats + '"]').getBoundingClientRect();
      const fr = document.querySelector('[data-loom-id="${ids.footer}"]').getBoundingClientRect();
      return { fx: fr.left + fr.width / 2, fy: fr.top + fr.height / 2, tx: sr.left + sr.width / 2, ty: sr.top + 12,
        order: d.nodes[d.root].children, hist: window.__loomStore.history.length }; })()`,
  )
  await drag(ews, f0.fx, f0.fy, f0.tx, f0.ty)
  const f1 = await evaluate(
    ews,
    `(() => { const d = window.__loomStore.doc;
      return { order: d.nodes[d.root].children, hist: window.__loomStore.history.length }; })()`,
  )
  const expectOrder = [f0.order[0], f0.order[2], f0.order[1]]
  step('flow drag reorders siblings', JSON.stringify(f1.order) === JSON.stringify(expectOrder),
    `${JSON.stringify(f0.order)} -> ${JSON.stringify(f1.order)}`)
  step('reorder commits exactly one history entry', f1.hist === f0.hist + 1, `${f0.hist} -> ${f1.hist}`)

  // Hover outlines only the element under the pointer. `:hover` also matches
  // every ancestor, which outlined the gauge, its card and the panel at once:
  // boxes in boxes over the design. Real pointer, measured outlines.
  await evaluate(ews, 'window.__loomStore.select([])')
  await sleep(200)
  const h0 = await evaluate(
    ews,
    `(() => { const r = document.querySelector('[data-loom-id="${ids.gauge}"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
  )
  await rpc(ews, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: h0.x, y: h0.y })
  await sleep(250)
  const outlined = await evaluate(
    ews,
    `[...document.querySelectorAll('.surface [data-loom-id]')].filter((el) => { const cs = getComputedStyle(el); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 }).map((el) => el.getAttribute('data-loom-type'))`,
  )
  step('hover outlines only the element under the pointer',
    outlined.length === 1 && outlined[0] === 'Gauge', JSON.stringify(outlined))

  // Dropping onto a container puts the node INSIDE it (Shane: "moving items
  // into group boxes just sits them over it"); Shift on release keeps it
  // outside, floating above. Real pointer, fresh scene.
  const sc = await evaluate(
    ews,
    `(() => { const s = window.__loomStore;
      s.loadDocument({ version: 1, meta: { name: 'into', targets: ['web'], created: 0 }, root: null, nodes: {} });
      s.addComponent('Panel', null, 0, 0, { w: 1280, h: 800 });
      const root = s.doc.root;
      const box = s.dropComponent('GroupBox', root, 500, 120);
      const a = s.dropComponent('Button', root, 80, 80);
      const b = s.dropComponent('Button', root, 80, 400);
      s.select([]);
      return { root, box, a, b }; })()`,
  )
  await sleep(600)
  const box = async (id) =>
    evaluate(ews, '(() => { const r = document.querySelector(\'.surface [data-loom-id="' + id + '"]\').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 } })()')
  const parent = async (id) =>
    evaluate(ews, '(() => { const d = window.__loomStore.doc; return Object.keys(d.nodes).find((k) => d.nodes[k].children.includes("' + id + '")) })()')
  const hist = async () => evaluate(ews, 'window.__loomStore.history.length')

  const gb = await box(sc.box)
  const a0 = await box(sc.a)
  const hBefore = await hist()
  const tx = gb.x + gb.w * 0.4, ty = gb.y + gb.h * 0.55
  await drag(ews, a0.cx, a0.cy, tx, ty)
  const a1 = await box(sc.a)
  step('dropped on a GroupBox, it goes inside it', (await parent(sc.a)) === sc.box, `parent ${await parent(sc.a)}`)
  step('and stays where it was dropped', Math.abs(a1.cx - tx) <= 4 && Math.abs(a1.cy - ty) <= 4, `centre (${a1.cx.toFixed(0)},${a1.cy.toFixed(0)}) vs drop (${tx.toFixed(0)},${ty.toFixed(0)})`)
  step('moving in is one undo step', (await hist()) === hBefore + 1, `${hBefore} -> ${await hist()}`)

  const b0 = await box(sc.b)
  await drag(ews, b0.cx, b0.cy, gb.x + gb.w * 0.6, gb.y + gb.h * 0.3, 12, 8)
  step('with Shift held on release, it stays outside, above', (await parent(sc.b)) === sc.root, `parent ${await parent(sc.b)}`)

  const a2 = await box(sc.a)
  await drag(ews, a2.cx, a2.cy, gb.x - 200, gb.y + gb.h + 120)
  step('dragged back out onto the page, it leaves the GroupBox', (await parent(sc.a)) === sc.root, `parent ${await parent(sc.a)}`)

  // Every container, not just GroupBox: drop a Button on each and check it
  // lands inside (containers that only take one kind of child, like Tabs,
  // are skipped: a Button is not a tab).
  const kinds = await evaluate(
    ews,
    `(() => { const seen = new Set(); return [...document.querySelectorAll('.toolbox .tool .tool-name')].map((e) => e.textContent.trim()).filter((n) => !/ /.test(n) && !seen.has(n) && seen.add(n)) })()`,
  )
  const refused = []
  let tried = 0
  for (const kind of kinds) {
    const made = await evaluate(
      ews,
      `(() => { const s = window.__loomStore;
        s.loadDocument({ version: 1, meta: { name: 'k', targets: ['web', 'desktop'], created: 0 }, root: null, nodes: {} });
        s.addComponent('Panel', null, 0, 0, { w: 1280, h: 800 });
        const root = s.doc.root;
        const c = s.dropComponent(${JSON.stringify(kind)}, root, 420, 140);
        // A tab set or an accordion takes only its own sections; the Button
        // belongs INSIDE one of those. A container that arrives with its
        // sections (Tabs brings three) takes the drop in the one you can see,
        // its first (active) section; otherwise give it one to land in.
        const inner = { Tabs: 'TabPanel', Accordion: 'AccordionItem' }[${JSON.stringify(kind)}];
        const into = inner ? (s.doc.nodes[c].children[0] ?? s.addComponent(inner, c, 0, 0)) : c;
        const b = s.dropComponent('Button', root, 40, 40);
        s.select([]);
        return { c, b, root, into }; })()`,
    )
    await sleep(250)
    const isHost = await evaluate(ews, `document.querySelector('.surface [data-loom-id="${made.c}"]')?.dataset.loomContainer === 'true'`)
    if (!isHost) continue
    const hostBox = await box(made.c)
    const b0 = await box(made.b)
    const tx = hostBox.x + Math.min(40, hostBox.w / 2), ty = hostBox.y + hostBox.h - Math.min(20, hostBox.h / 2)
    await drag(ews, b0.cx, b0.cy, tx, ty, 8)
    tried++
    const p = await parent(made.b)
    // Inside means the container or, for one that arrives with its own
    // children (a settings section's rows), the one under the pointer.
    const inside = p === made.into || (made.into === made.c && await evaluate(ews, `(() => { const d = window.__loomStore.doc; let k = ${JSON.stringify(p)}; while (k) { if (k === ${JSON.stringify(made.c)}) return true; k = Object.keys(d.nodes).find((n) => d.nodes[n].children.includes(k)) } return false })()`))
    if (!inside) refused.push(`${kind} (in ${p === made.root ? 'the page' : p})`)
  }
  step(`a drop goes inside every container (${tried} tried)`, tried > 20 && refused.length === 0, refused.join(', '))

  ews.close()
} catch (e) {
  console.error('DRAG-PROBE-THREW', e)
  results.push(false)
} finally {
  // Kill the whole group: the Electron main plus its renderer/GPU children.
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
}

const failed = results.filter((p) => !p).length
console.log(`\n${results.length - failed}/${results.length} drag E2E steps pass`)
process.exit(failed === 0 ? 0 : 1)
