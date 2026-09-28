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
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
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

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, env: process.env }, (_err, stdout, stderr) => resolve(`${stdout}\n${stderr}`))
  })
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
    if (command) {
      if (id === 'claude') {
        const s = await run(command, ['auth', 'status'])
        signedIn = /"loggedIn"\s*:\s*true/.test(s)
      } else {
        const s = await run(command, ['login', 'status'])
        signedIn = /Logged in/i.test(s)
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
      apiKey,
      models: MODELS[id],
      ready,
      ...(ready
        ? {}
        : {
            hint: !command
              ? `Install ${id === 'claude' ? 'Claude Code (npm i -g @anthropic-ai/claude-code)' : 'Codex (npm i -g @openai/codex)'}.`
              : `Sign in with \`${id === 'claude' ? 'claude auth login' : 'codex login'}\` in a terminal, or paste an API key.`,
          }),
    })
  }
  return out
}
