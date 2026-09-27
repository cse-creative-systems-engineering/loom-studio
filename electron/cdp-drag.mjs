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
async function drag(ws, x0, y0, x1, y1, stepsN = 12) {
  await rpc(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 })
  await sleep(150)
  for (let i = 1; i <= stepsN; i++) {
    const x = x0 + ((x1 - x0) * i) / stepsN
    const y = y0 + ((y1 - y0) * i) / stepsN
    await rpc(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' })
    await sleep(30)
  }
  await sleep(150)
  await rpc(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 })
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
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, x: n.props.x, y: n.props.y, hist: window.__loomStore.history.length }; })()`,
  )
  await drag(ews, g0.cx, g0.cy, g0.cx + 140, g0.cy + 90)
  const g1 = await evaluate(
    ews,
    `(() => { const n = window.__loomStore.doc.nodes[${JSON.stringify(ids.gauge)}];
      return { x: n.props.x, y: n.props.y, hist: window.__loomStore.history.length }; })()`,
  )
  step('free drag moves the node',
    Math.abs(g1.x - (g0.x + 140)) <= 8 && Math.abs(g1.y - (g0.y + 90)) <= 8,
    `(${g0.x},${g0.y}) -> (${g1.x},${g1.y})`)
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
