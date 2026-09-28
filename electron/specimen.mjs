// The specimen board, photographed: every tool in its own cell, per theme.
//
//   npm run build && node electron/specimen.mjs <outDir> [theme ...]
//
// Writes <outDir>/<theme>-<page>.png, full board height in pages of 900px.
// The visual overhaul is judged on these: a before/after pair per change.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import electronPath from 'electron'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const out = path.resolve(process.argv[2] || 'specimen-out')
const themes = process.argv.slice(3).length ? process.argv.slice(3) : ['midnight', 'daylight', 'contrast']
const PORT = 9431
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(out, { recursive: true })

const env = { ...process.env }
delete env.WAYLAND_DISPLAY
env.XDG_SESSION_TYPE = 'x11'
env.ELECTRON_OZONE_PLATFORM_HINT = 'x11'
env.DISPLAY = env.DISPLAY || ':0'
const child = spawn(electronPath, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(out, '.profile')}`], { cwd: root, env, stdio: 'ignore', detached: true })
try {
  let t
  for (let i = 0; i < 120 && !t; i++) {
    await sleep(500)
    try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === 'page' && x.url.includes('index.html')) } catch {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 1 << 27 })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let seq = 1
  const rpc = (method, params = {}) => new Promise((res, rej) => {
    const id = seq++
    const on = (m) => { const d = JSON.parse(m.data); if (d.id === id) { ws.removeEventListener('message', on); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result) } }
    ws.addEventListener('message', on)
    ws.send(JSON.stringify({ id, method, params }))
  })
  const ev = async (e) => (await rpc('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value
  for (let i = 0; i < 60 && !(await ev('Boolean(window.__loomSpecimen)')); i++) await sleep(500)
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  for (const theme of themes) {
    await ev(`window.__loomSpecimen(${JSON.stringify(theme)})`)
    await sleep(1500)
    const h = await ev(`document.getElementById('loom-specimen').scrollHeight`)
    for (let y = 0, page = 0; y < h; y += 900, page++) {
      await ev(`document.getElementById('loom-specimen').scrollTop = ${y}`)
      await sleep(250)
      const shot = await rpc('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(out, `${theme}-${String(page).padStart(2, '0')}.png`), Buffer.from(shot.data, 'base64'))
    }
    console.log(`${theme}: ${Math.ceil(h / 900)} pages`)
  }
  ws.close()
} finally {
  try { process.kill(-child.pid, 'SIGKILL') } catch {}
}
