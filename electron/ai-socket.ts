/**
 * The door an AI agent's MCP bridge knocks on.
 *
 * `claude` / `codex` launch `mcp-bridge.cjs` (stdio MCP); the bridge connects
 * HERE, over a Unix socket private to this user (0600, in Loom's own data
 * directory), and must present this run's random token on every request.
 * Requests are relayed to the editor window, where the tools run against the
 * live store (src/ai/tools.ts): the document never leaves the editor.
 *
 * Wire format, both ways: one JSON object per line.
 *   bridge -> Loom: { token, id, method: 'tools' | 'call', params }
 *   Loom -> bridge: { id, result } | { id, error }
 */

import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { app, ipcMain, type BrowserWindow } from 'electron'

export interface AiSocket {
  socketPath: string
  token: string
  /** Environment for a bridge process so it can reach this socket. */
  bridgeEnv(): Record<string, string>
  /** Where the MCP client config file is written. */
  configPath: string
  writeConfig(server: { command: string; args: string[]; env: Record<string, string> }): void
  close(): void
}

const MAX_LINE = 2 * 1024 * 1024

/**
 * A short directory only this user can enter: the login session's runtime
 * directory where there is one (Linux: /run/user/<uid>, already 0700), else
 * /tmp/loom-<uid>, created 0700 and refused if someone else owns it.
 */
export function socketDir(): string {
  const runtime = process.env.XDG_RUNTIME_DIR
  if (runtime && path.isAbsolute(runtime) && fs.existsSync(runtime)) {
    const d = path.join(runtime, 'loom')
    fs.mkdirSync(d, { recursive: true, mode: 0o700 })
    return d
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0
  const d = path.join(os.tmpdir(), `loom-${uid}`)
  fs.mkdirSync(d, { recursive: true, mode: 0o700 })
  const st = fs.statSync(d)
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new Error(`${d} belongs to another user`)
  fs.chmodSync(d, 0o700)
  return d
}

/** Tools answered here in main (they need the document drawn), not in the editor. */
export type LocalTool = (name: string, args: Record<string, unknown>, doc: unknown) => Promise<unknown>

export function startAiSocket(editor: () => BrowserWindow | null, local?: { names: Set<string>; run: LocalTool }): AiSocket {
  const dir = path.join(app.getPath('userData'), 'ai')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  // Windows has named pipes, not socket files. Elsewhere a 0600 file in a
  // SHORT private directory: a socket path is limited to ~104-108 bytes, and
  // Loom's data directory can be far longer (a crash dialog proved it).
  const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\loom-${process.pid}-${crypto.randomBytes(6).toString('hex')}` : path.join(socketDir(), `${process.pid}.sock`)
  try {
    fs.unlinkSync(socketPath)
  } catch {
    // none left over
  }
  const token = crypto.randomBytes(24).toString('hex')

  // Requests waiting for the editor's answer.
  const pending = new Map<string, (reply: { result?: unknown; error?: string }) => void>()
  ipcMain.handle('ai:response', (e, reqId: string, reply: { result?: unknown; error?: string }) => {
    const win = editor()
    if (!win || e.sender !== win.webContents) return false
    const done = pending.get(reqId)
    if (!done) return false
    pending.delete(reqId)
    done(reply)
    return true
  })

  const ask = (method: string, params: unknown): Promise<{ result?: unknown; error?: string }> =>
    new Promise((resolve) => {
      const win = editor()
      if (!win || win.isDestroyed()) return resolve({ error: 'Loom has no editor window open' })
      const reqId = crypto.randomBytes(8).toString('hex')
      const timer = setTimeout(() => {
        pending.delete(reqId)
        resolve({ error: 'the editor did not answer in time' })
      }, 30000)
      pending.set(reqId, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
      win.webContents.send('ai:request', reqId, method, params)
    })

  const server = net.createServer((conn) => {
    let buf = ''
    conn.setEncoding('utf8')
    conn.on('data', (chunk: string) => {
      buf += chunk
      if (buf.length > MAX_LINE) {
        conn.destroy()
        return
      }
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!line.trim()) continue
        let msg: { token?: unknown; id?: unknown; method?: unknown; params?: unknown }
        try {
          msg = JSON.parse(line)
        } catch {
          conn.write(JSON.stringify({ id: null, error: 'not JSON' }) + '\n')
          continue
        }
        const id = msg.id ?? null
        // Constant-time token check: nothing reaches the editor without it.
        const given = Buffer.from(typeof msg.token === 'string' ? msg.token : '')
        const want = Buffer.from(token)
        if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
          conn.write(JSON.stringify({ id, error: 'bad token' }) + '\n')
          continue
        }
        if (msg.method !== 'tools' && msg.method !== 'call') {
          conn.write(JSON.stringify({ id, error: 'unknown method' }) + '\n')
          continue
        }
        const p = (msg.params ?? {}) as { name?: unknown; arguments?: unknown }
        const localName = msg.method === 'call' && typeof p.name === 'string' && local?.names.has(p.name) ? p.name : null
        const answer: Promise<{ result?: unknown; error?: string }> = localName
          ? ask('doc', {}).then(async (d) => {
              if (d.error) return d
              try {
                const args = p.arguments && typeof p.arguments === 'object' ? (p.arguments as Record<string, unknown>) : {}
                return { result: await local!.run(localName, args, d.result) }
              } catch (e) {
                return { result: { ok: false, error: e instanceof Error ? e.message : String(e) } }
              }
            })
          : ask(msg.method, msg.params)
        void answer.then((r) => {
          if (!conn.destroyed) conn.write(JSON.stringify({ id, ...r }) + '\n')
        })
      }
    })
    conn.on('error', () => undefined)
  })
  // A socket that cannot open means no AI this run, never a crashed app.
  server.on('error', (e) => {
    console.error(`[loom] AI socket unavailable: ${e.message}`)
  })
  server.listen(socketPath, () => {
    try {
      fs.chmodSync(socketPath, 0o600)
    } catch {
      // Windows named pipes have no mode; the token still guards them.
    }
  })

  // The same config, as a file an MCP client can be pointed at
  // (`claude --mcp-config <this>`): private to this user, like the socket,
  // and removed on quit. The token in it only opens this run's socket.
  const configPath = path.join(dir, 'mcp.json')
  const writeConfig = (server: { command: string; args: string[]; env: Record<string, string> }) => {
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { loom: server } }, null, 2), { mode: 0o600 })
    fs.chmodSync(configPath, 0o600)
  }

  return {
    socketPath,
    token,
    configPath,
    writeConfig,
    bridgeEnv: () => ({ LOOM_MCP_SOCKET: socketPath, LOOM_MCP_TOKEN: token }),
    close() {
      server.close()
      for (const f of [socketPath, configPath]) {
        try {
          fs.unlinkSync(f)
        } catch {
          // already gone
        }
      }
    },
  }
}
