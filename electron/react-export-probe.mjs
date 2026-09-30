/**
 * React export E2E: the exported module compiles, renders and runs.
 *
 * The React export once compiled for nothing at all (every `style` attribute
 * was `style={"k": v}`, a syntax error), then crashed on import (its
 * behaviour runtime ran as a script touching `window`, leaving nothing to
 * call on mount). Neither shows up in the selftest, which never compiles the
 * output. This does, for real:
 *
 * 1. Exports the demo and a document per toolbox tool from the live app.
 * 2. Compiles each with esbuild (JSX).
 * 3. Server-renders each with React; any React warning is a failure.
 * 4. Mounts the Tabs export in a FRESH blank document (so only the exported
 *    module can install behaviour), clicks the second tab, and checks the
 *    page switched.
 * 5. Mounts the demo export (an aurora page) and checks the page travels
 *    with it: text set in the embedded typeface (measured), the aurora drawn
 *    and moving, and the host page's body left untouched.
 *
 * Self-contained: spawns its own Electron (demo scene, unique debug port)
 * and kills exactly what it spawned. Usage: `npm run probe:react` (builds
 * first). Needs an X display.
 */
import { spawn } from 'node:child_process'
import electronPath from 'electron'
import { build } from 'esbuild'
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
const PORT = Number(process.env.LOOM_CDP_PORT || 9347)
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-react-probe-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const step = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 1 << 28 })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let seq = 1
  const rpc = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = seq++
      const on = (m) => {
        const d = JSON.parse(m.data)
        if (d.id !== id) return
        ws.removeEventListener('message', on)
        if (d.error) rej(new Error(JSON.stringify(d.error)))
        else res(d.result)
      }
      ws.addEventListener('message', on)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const ev = async (expression) => {
    const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result?.value
  }
  return { ws, rpc, ev }
}

const child = spawn(electronPath, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(work, 'profile')}`], {
  cwd: root,
  env: { ...process.env, LOOM_DEMO: '1' },
  stdio: 'ignore',
  detached: true,
})

try {
  let page
  for (let i = 0; i < 120 && !page; i++) {
    await sleep(500)
    try {
      page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page' && t.url.includes('index.html'))
    } catch {}
  }
  if (!page) throw new Error('the app never opened')
  const app = await connect(page)
  for (let i = 0; i < 60 && !(await app.ev('Boolean(window.__loomStore && document.querySelector(".toolbox .tool"))')); i++) await sleep(500)

  // 1. Export the demo and one document per toolbox tool.
  const exports = { demo: await app.ev('window.__loomStore.emitReact()') }
  // Component tools only: their sections carry a category (the starters' does not).
  const names = await app.ev(`[...document.querySelectorAll('.toolbox section[data-cat]:not([data-cat="Starters"]) .tool .tool-name')].map((e) => e.textContent.trim())`)
  for (const n of names) {
    exports[n] = await app.ev(`(() => { const s = window.__loomStore;
      s.loadDocument({ version: 1, meta: { name: ${JSON.stringify(n)}, targets: ['web', 'desktop'], created: 0 }, root: null, nodes: {} });
      s.addComponent('Panel', null, 0, 0, { w: 1280, h: 800 });
      s.dropComponent(${JSON.stringify(n)}, s.doc.root, 40, 40);
      return s.emitReact() })()`)
  }
  app.ws.close()
  for (const [n, src] of Object.entries(exports)) fs.writeFileSync(path.join(work, `${n}.jsx`), src)
  step(`exported the demo and every tool (${Object.keys(exports).length})`, Object.keys(exports).length > 100)

  // 2 + 3. Compile, then server-render with React; a React warning fails it.
  const compileFail = []
  const renderFail = []
  let rendered = 0
  for (const n of Object.keys(exports)) {
    const entry = path.join(work, `${n}.entry.jsx`)
    fs.writeFileSync(entry, `import React from 'react'\nimport { renderToString } from 'react-dom/server'\nimport C from './${n}.jsx'\nexport const html = () => renderToString(React.createElement(C))\n`)
    const out = path.join(work, `${n}.cjs`)
    try {
      await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', logLevel: 'silent', nodePaths: [path.join(root, 'node_modules')], define: { 'process.env.NODE_ENV': '"development"' } })
    } catch (e) {
      compileFail.push(`${n}: ${String(e.message).split('\n').find((l) => l.includes('ERROR')) ?? e.message.split('\n')[0]}`)
      continue
    }
    const warnings = []
    const [oe, ow] = [console.error, console.warn]
    console.error = console.warn = (...a) => warnings.push(a.map(String).join(' ').slice(0, 160))
    try {
      const html = (await import(`${out}?${Date.now()}`)).html()
      if (!html || html.length < 20) warnings.push('rendered nothing')
    } catch (e) {
      warnings.push(`threw: ${String(e.message).slice(0, 160)}`)
    }
    ;[console.error, console.warn] = [oe, ow]
    if (warnings.length) renderFail.push(`${n}: ${warnings[0]}`)
    else rendered++
  }
  const total = Object.keys(exports).length
  step('every export compiles', compileFail.length === 0, compileFail.length ? `${compileFail.length} failed: ${compileFail.slice(0, 2).join(' | ')}` : '')
  // Every one must RENDER: one that never compiled has not passed this.
  step('every export renders with React, without a warning', rendered === total, `${rendered}/${total}${renderFail.length ? `: ${renderFail.slice(0, 2).join(' | ')}` : ''}`)

  // 4 + 5. Mount exports in fresh documents and operate them. Each goes in its
  // own about:blank frame in the app page (Electron opens no new tabs over
  // CDP): its document is its own, so the Studio's listeners never see its
  // clicks, and its bundle runs in an isolated world there (a fresh `window`;
  // DevTools evaluation is not subject to the page's content-security-policy).
  const host = await connect((await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page' && t.url.includes('index.html')))
  const usedFrames = new Set()
  const mount = async (name) => {
    const client = path.join(work, `client-${name}.jsx`)
    fs.writeFileSync(client, `import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport C from './${name}.jsx'\nconst el = document.createElement('div'); document.body.appendChild(el)\ncreateRoot(el).render(React.createElement(C))\n`)
    const bundle = await build({ entryPoints: [client], bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic', logLevel: 'silent', nodePaths: [path.join(root, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' } })
    await host.ev(`(() => { const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:800px;z-index:99999;border:0'; document.body.appendChild(f); return true })()`)
    await sleep(300)
    const tree = await host.rpc('Page.getFrameTree')
    const frameId = (tree.frameTree.childFrames ?? []).map((c) => c.frame).find((f) => f.url === 'about:blank' && !usedFrames.has(f.id))?.id
    if (!frameId) throw new Error('could not open a blank frame')
    usedFrames.add(frameId)
    const { executionContextId } = await host.rpc('Page.createIsolatedWorld', { frameId, worldName: `loom-react-probe-${name}` })
    const ev = async (expression) => {
      const r = await host.rpc('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      return r.result?.value
    }
    await ev(`window.__errors = []; window.addEventListener('error', (e) => window.__errors.push(String(e.message))); 0`)
    await ev(bundle.outputFiles[0].text + ';0')
    await sleep(400)
    return ev
  }

  // 4. The Tabs export: its behaviour installs and a tab click switches the page.
  const tabs = await mount('Tabs')
  const state = async () => tabs(`(() => {
    const shown = [...document.querySelectorAll('[role=tabpanel]')].filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.getAttribute('aria-label'))
    return { shown, installed: window.__loomBehaviour === true, errors: window.__errors }
  })()`)
  const before = await state()
  await tabs(`document.querySelectorAll('[role=tab]')[1].click()`)
  await sleep(200)
  const after = await state()
  step('the mounted export installs its behaviour without an error', before.installed && after.errors.length === 0, `installed=${before.installed} errors=${after.errors.join(', ')}`)
  step('a tab click in the exported component switches the page', before.shown.join(',') === 'Overview' && after.shown.join(',') === 'Activity', `${before.shown.join(',')} -> ${after.shown.join(',')}`)

  // 5. The demo export (an aurora page): the page travels with the component.
  const demo = await mount('demo')
  const onPage = await demo(`(async () => {
    await document.fonts.load("16px 'Inter Variable'")
    await document.fonts.ready
    const wrap = document.querySelector('.loom-export')
    const loaded = [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Inter Variable' && f.status === 'loaded')
    const probe = (family) => { const el = document.createElement('span'); el.style.cssText = 'font:400 32px ' + family + ';white-space:nowrap;position:absolute'; el.textContent = 'Hamburgefonstiv 0123'; (wrap || document.body).appendChild(el); const w = el.getBoundingClientRect().width; el.remove(); return w }
    const shipped = wrap ? probe(getComputedStyle(wrap).fontFamily) : 0
    const platform = probe('ui-sans-serif, system-ui, sans-serif')
    const blobs = [...document.querySelectorAll('.loom-export [data-loom-aurora] [data-loom-blob]')]
    return {
      wrapFont: wrap ? getComputedStyle(wrap).fontFamily : 'no wrapper',
      loaded, shipped, platform,
      blobs: blobs.length,
      moving: blobs.every((b) => getComputedStyle(b).animationName.startsWith('loom-wander-')),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyFont: getComputedStyle(document.body).fontFamily,
      errors: window.__errors,
    }
  })()`)
  step('the exported component sets its text in the shipped typeface', onPage.wrapFont.startsWith('"Inter Variable"') && onPage.loaded && Math.abs(onPage.shipped - onPage.platform) > 2,
    `${onPage.wrapFont.slice(0, 30)} loaded=${onPage.loaded} shipped=${onPage.shipped.toFixed(1)} platform=${onPage.platform.toFixed(1)}`)
  step('the exported component draws the aurora, moving', onPage.blobs >= 4 && onPage.moving, `blobs=${onPage.blobs} moving=${onPage.moving}`)
  step('the exported component leaves the host page alone', onPage.bodyBg === 'rgba(0, 0, 0, 0)' && !onPage.bodyFont.includes('Inter Variable') && onPage.errors.length === 0, `body bg=${onPage.bodyBg} font=${onPage.bodyFont.slice(0, 30)}`)
  host.ws.close()
} catch (e) {
  step('probe ran', false, String(e.message ?? e))
} finally {
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {}
  fs.rmSync(work, { recursive: true, force: true })
}

const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} React export steps pass`)
process.exit(passed === results.length ? 0 : 1)
