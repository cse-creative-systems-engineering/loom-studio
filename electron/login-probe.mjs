/**
 * Sign in with Claude E2E (CDP, the real app and the real IPC path).
 *
 * A stand-in `claude` CLI on an isolated PATH reports "not logged in" until
 * its `auth login` reads the right code from stdin, the way Claude Code's own
 * login does when the browser hands back a code. The probe drives the
 * Assistant's setup panel:
 *
 * 1. Not signed in: the panel offers "Sign in with Claude", composer disabled.
 * 2. Starting sign-in relays the CLI's sign-in page ("Open sign-in page").
 * 3. A wrong code fails visibly and the button comes back.
 * 4. The right code signs in: the panel goes, the composer opens on Claude.
 *
 * Self-contained like probe:drag: its own Electron, HOME and debug port, and it
 * kills exactly what it spawned. Usage: `npm run probe:login`. Needs X.
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
const PORT = Number(process.env.LOOM_CDP_PORT || 9337)
const GOOD_CODE = 'probe-code-123'

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
  rpc(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => r?.result?.value)
async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout: ${label}`)
    await sleep(300)
  }
}

/** The stand-in CLI: `auth status` and `auth login`, nothing else. */
function fakeClaude(dir) {
  const flag = path.join(dir, 'logged-in')
  const script = `#!${process.execPath}
const fs = require('node:fs')
const [a, b] = process.argv.slice(2)
const flag = ${JSON.stringify(flag)}
if (a === 'auth' && b === 'status') {
  const inn = fs.existsSync(flag)
  console.log(JSON.stringify({ loggedIn: inn, authMethod: inn ? 'claude.ai' : 'none' }))
  process.exit(inn ? 0 : 1)
}
if (a === 'auth' && b === 'login') {
  console.log('Opening browser to sign in…')
  console.log('If the browser didn\\'t open, visit: https://claude.com/cai/oauth/authorize?code=true&probe=1')
  process.stdout.write('Paste code here if prompted > ')
  let buf = ''
  process.stdin.on('data', (c) => {
    buf += c
    const nl = buf.indexOf('\\n')
    if (nl < 0) return
    if (buf.slice(0, nl) === ${JSON.stringify(GOOD_CODE)}) {
      fs.writeFileSync(flag, '1')
      console.log('Login successful.')
      process.exit(0)
    }
    console.error('OAuth error: Invalid code')
    process.exit(1)
  })
} else process.exit(2)
`
  const file = path.join(dir, 'claude')
  fs.writeFileSync(file, script, { mode: 0o755 })
}

const ui = {
  setup: `!!document.querySelector('.as-setup')`,
  signInButton: `[...document.querySelectorAll('.as-setup button')].find((b) => b.textContent.trim() === 'Sign in with Claude')`,
  openPage: `[...document.querySelectorAll('.as-login button')].some((b) => b.textContent.trim() === 'Open sign-in page')`,
  composerEnabled: `(() => { const t = document.querySelector('.as-input'); return !!t && !t.disabled })()`,
  error: `document.querySelector('.as-setup .as-error')?.textContent ?? ''`,
}
const enterCode = (code) => `(() => {
  const input = document.querySelector('.as-login input')
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(input, ${JSON.stringify(code)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`
const submitCode = `(() => { const b = [...document.querySelectorAll('.as-login button')].find((x) => x.textContent.trim() === 'Submit'); b?.click(); return !!b })()`

let child = null
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-login-'))
try {
  const bin = path.join(tmp, 'bin')
  fs.mkdirSync(bin)
  fakeClaude(bin)

  const env = { ...process.env, PATH: bin, HOME: tmp }
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'WAYLAND_DISPLAY', 'LOOM_AI_TEST_AGENT']) delete env[k]
  env.XDG_SESSION_TYPE = 'x11'
  env.ELECTRON_OZONE_PLATFORM_HINT = 'x11'
  env.DISPLAY = env.DISPLAY || ':0'
  const args = ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(tmp, 'user-data')}`]
  if (process.getuid?.() === 0) args.push('--no-sandbox')
  child = spawn(electronPath, args, { cwd: root, env, stdio: 'ignore', detached: true })

  const editor = await waitFor(async () => {
    const ts = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    return ts.find((t) => t.type === 'page' && t.url.includes('index.html'))
  }, 90000, 'editor')
  const ws = new WebSocket(editor.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })

  await waitFor(() => evaluate(ws, ui.setup), 30000, 'setup panel')
  step('not signed in: the panel offers Sign in with Claude', await evaluate(ws, `!!${ui.signInButton}`))
  step('not signed in: the composer is disabled', !(await evaluate(ws, ui.composerEnabled)))

  await evaluate(ws, `${ui.signInButton}.click()`)
  const relayed = await waitFor(() => evaluate(ws, ui.openPage), 15000, 'sign-in page relayed').catch(() => false)
  step('sign-in relays the CLI\'s sign-in page', !!relayed)

  await evaluate(ws, enterCode('wrong-code'))
  await evaluate(ws, submitCode)
  const err = await waitFor(() => evaluate(ws, ui.error), 15000, 'wrong code error').catch(() => '')
  step('a wrong code fails visibly', /invalid code/i.test(err), err)
  step('after a failure the button comes back', await waitFor(() => evaluate(ws, `!!${ui.signInButton}`), 5000, 'button back').catch(() => false))
  step('after a failure the composer stays disabled', !(await evaluate(ws, ui.composerEnabled)))

  await evaluate(ws, `${ui.signInButton}.click()`)
  await waitFor(() => evaluate(ws, ui.openPage), 15000, 'second sign-in')
  await evaluate(ws, enterCode(GOOD_CODE))
  await evaluate(ws, submitCode)
  const ready = await waitFor(() => evaluate(ws, ui.composerEnabled), 20000, 'signed in').catch(() => false)
  step('the right code signs in: the composer opens', !!ready)
  step('signed in: the setup panel is gone', !(await evaluate(ws, ui.setup)))
  const chip = await evaluate(ws, `document.querySelector('.as-pick .as-chip')?.textContent ?? ''`)
  step('signed in: Claude is the chosen assistant', /Claude/.test(chip), chip)

  ws.close()
} catch (e) {
  console.error('LOGIN-PROBE-THREW', e)
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
console.log(`\n${results.length - failed}/${results.length} sign-in E2E steps pass`)
process.exit(failed === 0 ? 0 : 1)
