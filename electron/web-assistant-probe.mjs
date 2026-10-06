/**
 * The Assistant on the web (CDP): the editor with NO desktop app behind it,
 * Claude connected the way a claude.ai page does it (`__loomConnectClaude`),
 * here a scripted stand-in that calls Loom's tools like Claude would.
 *
 * 1. Without a host, there is no Assistant (nothing that cannot work).
 * 2. A host connects Claude: the composer appears, on "Claude".
 * 3. What Claude is given: only page-runnable tools, within the host's
 *    count and description limits, and the web brief.
 * 4. A message builds through the real tools; the reply shows; the whole
 *    turn is ONE undo step.
 * 5. A follow-up carries the conversation (the host's Claude keeps none).
 * 6. A refused call says why. 7. Stop stops.
 * 8. Watching it build: what the Assistant adds is revealed piece by piece in
 *    build order (a person's own edit is not); Stop shows everything at once,
 *    and "continue" tells Claude it was stopped and to re-read the canvas.
 *
 * Self-contained: its own Electron (a bare window, no preload), user data and
 * debug port. Usage: `npm run probe:web-assistant`. Needs X.
 */
import { spawn } from 'node:child_process'
import electronPath from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertFreshBuild } from './fresh-build.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
try {
  assertFreshBuild(root)
} catch (e) {
  console.error(`FAIL  ${e.message}`)
  process.exit(1)
}
const PORT = Number(process.env.LOOM_CDP_PORT || 9338)
const MAX_TOOLS = 40

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const step = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
function rpc(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`cdp timeout: ${method}`)), 20000)
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id !== id) return
      clearTimeout(to)
      ws.removeEventListener('message', onMsg)
      if (m.error) reject(new Error(JSON.stringify(m.error)))
      else resolve(m.result)
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const evaluate = (ws, expression) =>
  rpc(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => {
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate threw')
    return r?.result?.value
  })
async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout: ${label}`)
    await sleep(200)
  }
}

/** The stand-in host: records what it is given, and plays Claude by prompt. */
const FAKE_CLAUDE = `(() => {
  const log = window.__fakeClaude = { calls: [] }
  return window.__loomConnectClaude({
    maxTools: ${MAX_TOOLS},
    ask(turns, opts) {
      let stop
      const stopped = new Promise((_, reject) => { stop = () => reject({ code: 'cancelled', message: 'stopped' }) })
      log.calls.push({ turns: turns.map((t) => ({ ...t })), tier: opts.modelTier, tools: opts.tools.map((t) => ({ name: t.name, description: t.description, schema: t.inputSchema })) })
      const prompt = turns[turns.length - 1].content
      const tool = (name) => opts.tools.find((t) => t.name === name)
      const run = (async () => {
        if (prompt.startsWith('deny')) throw { code: 'not_granted', message: 'declined' }
        if (prompt.startsWith('slow')) {
          const doc = await tool('get_document').execute({})
          await tool('add_starter').execute({ starter: 'dashboard', parent_id: doc.root.id })
          opts.onText('Working on it')
          await stopped
        }
        if (prompt.startsWith('bad tool')) {
          let err = ''
          try { await tool('set_props').execute({ id: 'nope', props: {} }) } catch (e) { err = String(e.message) }
          log.toolError = err
          opts.onText('Could not.')
          return { text: 'Could not.' }
        }
        const doc = await tool('get_document').execute({})
        log.sawEmpty = doc.root === null
        const made = await tool('add_starter').execute({ starter: 'dashboard', parent_id: null })
        log.made = made
        opts.onText('Built a dashboard.')
        return { text: 'Built a dashboard.' }
      })()
      return { result: Promise.race([run, stopped]), cancel: () => stop() }
    },
  })
})()`

const ui = {
  composer: `(() => { const t = document.querySelector('.as-input'); return t ? (t.disabled ? 'disabled' : 'enabled') : 'none' })()`,
  chip: `document.querySelector('.as-pick .as-chip')?.textContent ?? ''`,
  lastAgent: `(() => { const m = [...document.querySelectorAll('.as-msg.from-agent')].pop(); return m ? { text: m.querySelector('p:not(.as-error):not(.as-working)')?.textContent ?? '', error: m.querySelector('.as-error')?.textContent ?? '', steps: [...m.querySelectorAll('.as-step')].map((x) => x.textContent) } : null })()`,
  idle: `!!document.querySelector('.as-send:not(.stop)')`,
}
const say = (text) => `(async () => {
  const t = document.querySelector('.as-input')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(text)})
  t.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 50))
  document.querySelector('.as-send').click()
  return true
})()`

let child = null
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-web-ai-'))
try {
  // A bare window on the built editor: no preload, so no desktop Assistant.
  const mainFile = path.join(tmp, 'main.cjs')
  fs.writeFileSync(
    mainFile,
    `const { app, BrowserWindow } = require('electron')
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1440, height: 900, webPreferences: { contextIsolation: true, sandbox: true } })
  w.loadFile(${JSON.stringify(path.join(root, 'dist', 'renderer', 'index.html'))})
})
`,
  )
  const env = { ...process.env }
  delete env.WAYLAND_DISPLAY
  env.DISPLAY = env.DISPLAY || ':0'
  const args = [mainFile, `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(tmp, 'user-data')}`]
  if (process.getuid?.() === 0) args.push('--no-sandbox')
  child = spawn(electronPath, args, { cwd: tmp, env, stdio: 'ignore', detached: true })

  const editor = await waitFor(async () => {
    const ts = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    return ts.find((t) => t.type === 'page' && t.url.includes('index.html'))
  }, 90000, 'editor')
  const ws = new WebSocket(editor.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  await waitFor(() => evaluate(ws, `typeof window.__loomConnectClaude === 'function' && !!window.__loomStore`), 30000, 'editor booted')
  await sleep(500)

  step('without a host there is no Assistant', (await evaluate(ws, ui.composer)) === 'none')

  step('a host connects Claude', (await evaluate(ws, FAKE_CLAUDE)) === true)
  const on = await waitFor(async () => ((await evaluate(ws, ui.composer)) === 'enabled' ? true : null), 5000, 'composer').catch(() => false)
  step('the composer appears, ready', !!on)
  const chip = await evaluate(ws, ui.chip)
  step('Claude is the chosen assistant', /^Claude/.test(chip), chip)

  // Record every animation the canvas starts: which node, and its delay.
  await evaluate(ws, `(() => {
    const rec = window.__reveals = []
    const orig = Element.prototype.animate
    Element.prototype.animate = function (k, o) {
      rec.push({ id: this.getAttribute('data-loom-id'), trace: this.classList.contains('ai-reveal-box'), delay: (o && o.delay) || 0 })
      return orig.call(this, k, o)
    }
    return true
  })()`)
  const history0 = await evaluate(ws, 'window.__loomStore.history.length')
  await evaluate(ws, say('Build me a dashboard'))
  await waitFor(() => evaluate(ws, ui.idle), 10000, 'turn done')
  await sleep(150)
  const reveal = await evaluate(ws, `(() => {
    const s = window.__loomStore, order = []
    const walk = (id) => { order.push(id); s.doc.nodes[id].children.forEach(walk) }
    walk(s.doc.root)
    const byId = new Map(window.__reveals.filter((r) => r.id).map((r) => [r.id, r.delay]))
    const delays = order.map((id) => byId.get(id))
    return { nodes: order.length, revealed: delays.filter((d) => d !== undefined).length, delays, traces: window.__reveals.filter((r) => r.trace).length }
  })()`)
  step('it builds visibly: every new piece is revealed', reveal.revealed === reveal.nodes && reveal.nodes > 5, `${reveal.revealed}/${reveal.nodes}`)
  step('in build order, a container before what it holds', reveal.delays[0] === 0 && reveal.delays.every((d, i) => i === 0 || d >= reveal.delays[i - 1]) && reveal.delays[reveal.delays.length - 1] > 0, reveal.delays.join(','))
  step('each piece is traced as it lands', reveal.traces > 0 && reveal.traces <= reveal.nodes, `${reveal.traces} traces`)
  const reply = await evaluate(ws, ui.lastAgent)
  const fake = await evaluate(ws, `(() => { const c = window.__fakeClaude; return { ...c, calls: c.calls.map((x) => ({ tier: x.tier, tools: x.tools, turns: x.turns })) } })()`)
  const first = fake.calls[0]
  const names = first.tools.map((t) => t.name)
  step('Claude gets only tools the page can run', names.length > 20 && !names.includes('render') && !names.includes('check_layout'), `${names.length} tools`)
  step('within the host\'s limits', names.length <= MAX_TOOLS && first.tools.every((t) => t.description.length <= 1000 && JSON.stringify(t.schema).length <= 4096))
  const brief = first.turns[0].content
  step('the brief is the web one, with the long tool reference', first.turns[0].role === 'user' && /few rounds/.test(brief) && !/check_layout/.test(brief.split('Tool notes:')[0]) && /Tool notes:[\s\S]*set_look:/.test(brief))
  step('the message is the last turn', first.turns[first.turns.length - 1].content.startsWith('Build me a dashboard'))
  step('it builds through the real tools', fake.sawEmpty === true && typeof fake.made?.id === 'string' && (await evaluate(ws, `Object.keys(window.__loomStore.doc.nodes).length`)) > 5)
  step('the reply shows, with its steps', reply?.text === 'Built a dashboard.' && reply.steps.length >= 2, JSON.stringify(reply))
  const history1 = await evaluate(ws, 'window.__loomStore.history.length')
  await evaluate(ws, 'window.__loomStore.undo()')
  const empty = await evaluate(ws, 'window.__loomStore.doc.root === null')
  step('the whole turn is one undo step', history1 === history0 + 1 && empty, `${history0} -> ${history1}`)
  await evaluate(ws, 'window.__loomStore.redo()')

  await evaluate(ws, 'window.__reveals.length = 0')
  await evaluate(ws, `window.__loomStore.addComponent('Button', window.__loomStore.doc.root, 0, 0)`)
  await sleep(150)
  step('a person\'s own edit appears at once, not revealed', (await evaluate(ws, 'window.__reveals.length')) === 0)

  await evaluate(ws, say('bad tool please'))
  await waitFor(() => evaluate(ws, ui.idle), 10000, 'turn 2 done')
  const fake2 = await evaluate(ws, `({ n: window.__fakeClaude.calls.length, turns: window.__fakeClaude.calls[1]?.turns, toolError: window.__fakeClaude.toolError })`)
  const t2 = fake2.turns ?? []
  step('a follow-up carries the conversation', t2.length === 4 && t2[2].role === 'assistant' && t2[2].content === 'Built a dashboard.', `${t2.length} turns`)
  step('a refused tool call reaches Claude as an error', /no node "nope"/.test(fake2.toolError ?? ''), fake2.toolError)

  await evaluate(ws, say('deny this'))
  await waitFor(() => evaluate(ws, ui.idle), 10000, 'turn 3 done')
  const denied = await evaluate(ws, ui.lastAgent)
  step('a refused call says why', /not allowed on this page/.test(denied?.error ?? ''), denied?.error)

  await evaluate(ws, say('slow one'))
  await waitFor(() => evaluate(ws, `!!document.querySelector('.as-send.stop')`), 5000, 'running')
  await sleep(120)
  const revealing = `document.getAnimations().filter((a) => (a.playState === 'running' || a.pending) && a.effect?.target?.closest?.('[data-loom-id], .ai-reveal-box')).length`
  const midway = await evaluate(ws, revealing)
  await evaluate(ws, `document.querySelector('.as-send.stop').click()`)
  await waitFor(() => evaluate(ws, ui.idle), 5000, 'stopped')
  const stopped = await evaluate(ws, ui.lastAgent)
  step('Stop stops', stopped?.error === 'Stopped.', JSON.stringify(stopped))
  const after = await evaluate(ws, revealing)
  step('Stop shows everything built so far, at once', midway > 0 && after === 0, `${midway} revealing -> ${after}`)

  await evaluate(ws, say('continue'))
  await waitFor(() => evaluate(ws, ui.idle), 10000, 'continued')
  const resumed = await evaluate(ws, `window.__fakeClaude.calls[window.__fakeClaude.calls.length - 1].turns`)
  const stoppedTurn = resumed.find((t) => t.role === 'user' && t.content.startsWith('slow one'))
  step('"continue" tells Claude it was stopped and to re-read the canvas', /pressed Stop/.test(stoppedTurn?.content ?? '') && /get_document/.test(stoppedTurn?.content ?? '') && resumed[resumed.length - 1].content.startsWith('continue'))

  ws.close()
} catch (e) {
  console.error('WEB-ASSISTANT-PROBE-THREW', e)
  results.push(false)
} finally {
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
  await sleep(500)
  fs.rmSync(tmp, { recursive: true, force: true })
}

const failed = results.filter((p) => !p).length
console.log(`\n${results.length - failed}/${results.length} web Assistant E2E steps pass`)
process.exit(failed === 0 ? 0 : 1)
