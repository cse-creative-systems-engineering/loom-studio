/**
 * Which AI agents this machine can run, and how each is signed in.
 *
 * Loom does not implement an agent loop or talk to model APIs itself: it runs
 * the vendor's own agent CLI (Claude Code, Codex), which does tool use,
 * streaming and conversation memory, and gives it Loom's MCP tools. A CLI
 * signs in its own way (its login, or an API key in its environment), so Loom
 * never reads another tool's credentials: it asks the CLI for its status.
 *
 * Found: the CLI on PATH, or the copy bundled inside the vendor's desktop app
 * (the Claude app ships Claude Code; the ChatGPT app ships Codex). An API key
 * comes from the environment (ANTHROPIC_API_KEY / OPENAI_API_KEY) or one the
 * user pasted into Loom, kept encrypted by the OS keychain (safeStorage).
 * Not signed in: Loom runs the CLI's own login (`claude auth login`), which
 * signs in through the browser, so credentials never pass through Loom.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { app, safeStorage } from 'electron'

export type ProviderId = 'claude' | 'codex'

export interface ProviderInfo {
  id: ProviderId
  label: string
  /** The CLI to run, or null when not installed. */
  command: string | null
  /** Where it was found: 'path' or the app that bundles it. */
  found: string | null
  /** Signed in with the CLI's own login. */
  signedIn: boolean
  /**
   * That login is the person's own SUBSCRIPTION (Claude Pro/Max via
   * claude.ai, ChatGPT via Codex): the agent then always runs on it, and an
   * API key in the environment or saved in Loom is NOT passed, so a turn is
   * never silently billed to an API account instead.
   */
  subscription: boolean
  /** An API key is available (environment or saved in Loom). */
  apiKey: 'env' | 'saved' | null
  /** Models offered in the picker; the first is the default. */
  models: Array<{ id: string; label: string }>
  /** Ready to run: installed, and signed in or has a key. */
  ready: boolean
  /** What to do when not ready. */
  hint?: string
}

const MODELS: Record<ProviderId, Array<{ id: string; label: string }>> = {
  claude: [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  // Codex's own configured default; a specific model id can be typed.
  codex: [{ id: '', label: 'Codex default model' }],
}

const KEY_ENV: Record<ProviderId, string> = { claude: 'ANTHROPIC_API_KEY', codex: 'OPENAI_API_KEY' }

function onPath(name: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext)
      try {
        fs.accessSync(p, fs.constants.X_OK)
        if (fs.statSync(p).isFile()) return p
      } catch {
        // not here
      }
    }
  }
  return null
}

/** The newest Claude Code bundled by the Claude desktop app, if any. */
function bundledClaude(): string | null {
  const roots = [path.join(os.homedir(), '.config', 'Claude', 'claude-code'), path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code')]
  for (const root of roots) {
    try {
      const versions = fs.readdirSync(root).filter((v) => /^\d+\.\d+\.\d+$/.test(v))
      versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      for (const v of versions) {
        const p = path.join(root, v, process.platform === 'win32' ? 'claude.exe' : 'claude')
        if (fs.existsSync(p)) return p
      }
    } catch {
      // no such app
    }
  }
  return null
}

/** Codex bundled by the ChatGPT desktop app, if any. */
function bundledCodex(): string | null {
  const p = path.join(os.homedir(), '.codex', 'plugins', '.plugin-appserver', process.platform === 'win32' ? 'codex.exe' : 'codex')
  return fs.existsSync(p) ? p : null
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, env }, (_err, stdout, stderr) => resolve(`${stdout}\n${stderr}`))
  })
}

/** The environment without an API key, so a status check reports the LOGIN, not the key. */
function withoutKey(id: ProviderId): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env[KEY_ENV[id]]
  if (id === 'claude') delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

/* ---------- saved keys (encrypted by the OS keychain) ---------- */

const keyFile = () => path.join(app.getPath('userData'), 'ai', 'keys.json')

function readSaved(): Partial<Record<ProviderId, string>> {
  try {
    return JSON.parse(fs.readFileSync(keyFile(), 'utf8'))
  } catch {
    return {}
  }
}

/** A pasted key, decrypted for passing to its CLI; null if none. */
export function savedKey(id: ProviderId): string | null {
  const enc = readSaved()[id]
  if (!enc || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

/** Save (or with null, forget) a pasted key. Refuses when it cannot be encrypted. */
export function saveKey(id: ProviderId, key: string | null): { ok: boolean; error?: string } {
  const all = readSaved()
  if (key === null) delete all[id]
  else {
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'This system has no keychain to encrypt the key with. Set the environment variable instead.' }
    const trimmed = key.trim()
    if (trimmed.length < 20 || /\s/.test(trimmed)) return { ok: false, error: 'That does not look like an API key.' }
    all[id] = safeStorage.encryptString(trimmed).toString('base64')
  }
  fs.mkdirSync(path.dirname(keyFile()), { recursive: true, mode: 0o700 })
  fs.writeFileSync(keyFile(), JSON.stringify(all), { mode: 0o600 })
  return { ok: true }
}

/** The environment a provider's CLI runs with: the key, if any. */
export function providerKeyEnv(id: ProviderId): Record<string, string> {
  if (process.env[KEY_ENV[id]]) return {}
  const k = savedKey(id)
  return k ? { [KEY_ENV[id]]: k } : {}
}

/**
 * How a turn signs in: on the person's subscription when they are logged in
 * with one (any API key is withheld and stripped), otherwise with the key.
 */
export function providerAuth(info: Pick<ProviderInfo, 'id' | 'subscription'>): { env: Record<string, string>; strip: string[] } {
  if (info.subscription) return { env: {}, strip: info.id === 'claude' ? [KEY_ENV.claude, 'ANTHROPIC_AUTH_TOKEN'] : [KEY_ENV.codex] }
  return { env: providerKeyEnv(info.id), strip: [] }
}

/* ---------- detection ---------- */

export async function detectProviders(): Promise<ProviderInfo[]> {
  const out: ProviderInfo[] = []
  for (const id of ['claude', 'codex'] as ProviderId[]) {
    const fromPath = onPath(id)
    const bundled = id === 'claude' ? bundledClaude() : bundledCodex()
    const command = fromPath ?? bundled
    const found = fromPath ? 'path' : bundled ? (id === 'claude' ? 'Claude app' : 'ChatGPT app') : null
    const apiKey = process.env[KEY_ENV[id]] ? 'env' : readSaved()[id] ? 'saved' : null
    let signedIn = false
    let subscription = false
    if (command) {
      if (id === 'claude') {
        const s = await run(command, ['auth', 'status'], withoutKey(id))
        signedIn = /"loggedIn"\s*:\s*true/.test(s)
        subscription = signedIn && /"authMethod"\s*:\s*"claude\.ai"/.test(s)
      } else {
        const s = await run(command, ['login', 'status'], withoutKey(id))
        signedIn = /Logged in/i.test(s)
        subscription = signedIn && /ChatGPT/i.test(s)
      }
    }
    const label = id === 'claude' ? 'Claude' : 'OpenAI (Codex)'
    const ready = !!command && (signedIn || apiKey !== null)
    out.push({
      id,
      label,
      command,
      found,
      signedIn,
      subscription,
      apiKey,
      models: MODELS[id],
      ready,
      ...(ready
        ? {}
        : {
            hint: !command
              ? `Install ${id === 'claude' ? 'Claude Code (npm i -g @anthropic-ai/claude-code)' : 'Codex (npm i -g @openai/codex)'}.`
              : id === 'claude'
                ? 'Sign in with your Claude account, or paste an API key.'
                : 'Sign in with `codex login` in a terminal, or paste an API key.',
          }),
    })
  }
  return out
}

/* ---------- sign in (the CLI's own login) ---------- */

export type LoginEvent =
  /** The sign-in page, for when the CLI could not open the browser itself. */
  | { kind: 'url'; url: string }
  | { kind: 'done'; ok: boolean; error?: string }

export interface LoginHandle {
  /** The sign-in page the CLI printed, once it has. */
  url: () => string | null
  /** The code the sign-in page shows, when the CLI asks for one. */
  submitCode: (code: string) => boolean
  cancel: () => void
}

/** Only the vendor's own pages are ever opened or shown. */
const LOGIN_HOSTS = ['claude.com', 'claude.ai', 'anthropic.com']
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000

/** The first https sign-in URL on an Anthropic host in `text`, or null. */
export function loginUrlIn(text: string): string | null {
  for (const m of text.matchAll(/https:\/\/[^\s"'<>]+/g)) {
    try {
      const u = new URL(m[0])
      if (u.protocol === 'https:' && LOGIN_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) return u.toString()
    } catch {
      // not a URL
    }
  }
  return null
}

/**
 * Run `claude auth login` (subscription sign-in). The CLI opens the browser
 * and, when the page hands back a code instead of finishing on its own, reads
 * it from stdin. Loom only relays the page's URL and that code; the token is
 * stored by the CLI, where `auth status` and every agent turn find it.
 */
export function startClaudeLogin(command: string, on: (ev: LoginEvent) => void): LoginHandle {
  let url: string | null = null
  let finished = false
  let seen = ''
  const finish = (ev: Extract<LoginEvent, { kind: 'done' }>) => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    on(ev)
  }
  const child = spawn(command, ['auth', 'login', '--claudeai'], { env: withoutKey('claude'), stdio: ['pipe', 'pipe', 'pipe'] })
  let errors = ''
  const read = (chunk: Buffer) => {
    seen = (seen + chunk.toString('utf8')).slice(-8000)
    if (url) return
    url = loginUrlIn(seen)
    if (url) on({ kind: 'url', url })
  }
  child.stdout.on('data', read)
  child.stderr.on('data', (chunk: Buffer) => {
    errors = (errors + chunk.toString('utf8')).slice(-4000)
    read(chunk)
  })
  child.stdin.on('error', () => {
    // The CLI exited before reading; its exit reports the outcome.
  })
  child.on('error', (e) => finish({ kind: 'done', ok: false, error: `Could not start Claude Code: ${e.message}` }))
  child.on('close', (code) => {
    if (code === 0) return finish({ kind: 'done', ok: true })
    // The CLI's own reason, without its prompt or the sign-in URL.
    const lastLine = (text: string) =>
      text
        .split('\n')
        .map((l) => l.replace(/^.*paste code here if prompted\s*>\s*/i, '').trim())
        .filter((l) => l && !l.includes('https://'))
        .pop()
    const last = lastLine(errors) ?? lastLine(seen)
    finish({ kind: 'done', ok: false, error: last ? last.slice(0, 200) : 'Sign-in did not finish.' })
  })
  const timer = setTimeout(() => {
    child.kill()
    finish({ kind: 'done', ok: false, error: 'Sign-in timed out. Try again.' })
  }, LOGIN_TIMEOUT_MS)
  return {
    url: () => url,
    submitCode: (code) => {
      const c = code.trim()
      if (finished || !c || c.length > 2000 || /[\r\n]/.test(c)) return false
      child.stdin.write(c + '\n')
      return true
    },
    cancel: () => {
      if (finished) return
      child.kill()
      finish({ kind: 'done', ok: false, error: 'Sign-in cancelled.' })
    },
  }
}
