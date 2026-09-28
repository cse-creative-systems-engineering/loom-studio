/**
 * Loom's MCP server, for AI agents (Claude Code, Codex, any MCP client).
 *
 * The agent launches this as a stdio MCP server. It holds nothing and knows
 * nothing about documents: it speaks MCP (JSON-RPC 2.0, one message per
 * line) on stdin/stdout and relays tool listing and tool calls to the running
 * Loom over the private socket named in LOOM_MCP_SOCKET, presenting
 * LOOM_MCP_TOKEN. Loom runs each tool in the editor against the live
 * document, so what the agent builds appears on the canvas as it builds.
 *
 * Run it with Loom's own Electron in Node mode (ELECTRON_RUN_AS_NODE=1), so
 * no separate Node install is needed. Nothing is printed to stdout except
 * protocol messages; diagnostics go to stderr.
 */

import net from 'node:net'

const SOCKET = process.env.LOOM_MCP_SOCKET ?? ''
const TOKEN = process.env.LOOM_MCP_TOKEN ?? ''
const VERSION = '0.1.0'

type Json = Record<string, unknown>

let conn: net.Socket | null = null
let seq = 0
const waiting = new Map<number, (r: { result?: unknown; error?: string }) => void>()

function loom(method: 'tools' | 'call', params: unknown): Promise<{ result?: unknown; error?: string }> {
  return new Promise((resolve) => {
    if (!SOCKET || !TOKEN) return resolve({ error: 'LOOM_MCP_SOCKET / LOOM_MCP_TOKEN are not set: start the agent from Loom' })
    const send = () => {
      const id = ++seq
      waiting.set(id, resolve)
      conn!.write(JSON.stringify({ token: TOKEN, id, method, params }) + '\n')
    }
    if (conn && !conn.destroyed) return send()
    let buf = ''
    conn = net.createConnection(SOCKET)
    conn.setEncoding('utf8')
    conn.on('connect', send)
    conn.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        try {
          const msg = JSON.parse(line) as { id: number; result?: unknown; error?: string }
          const done = waiting.get(msg.id)
          if (done) {
            waiting.delete(msg.id)
            done(msg)
          }
        } catch {
          // ignore a malformed line
        }
      }
    })
    conn.on('error', (e) => {
      for (const done of waiting.values()) done({ error: `cannot reach Loom: ${e.message}` })
      waiting.clear()
      conn = null
      resolve({ error: `cannot reach Loom: ${e.message}` })
    })
  })
}

function reply(id: unknown, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}
function fail(id: unknown, code: number, message: string) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

async function handle(msg: Json) {
  const id = msg.id
  const method = msg.method as string | undefined
  const params = (msg.params ?? {}) as Json
  // Notifications (no id) need no answer.
  if (id === undefined || id === null) return
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'loom', version: VERSION },
        instructions:
          'You are building a user interface in Loom, a visual UI builder. Call get_document first. Build with add_component / set_props / dock / move_into; read describe_component before using a component you have not used. Everything you do appears live on the designer\'s canvas and is undoable.',
      })
    case 'ping':
      return reply(id, {})
    case 'tools/list': {
      const r = await loom('tools', {})
      if (r.error) return fail(id, -32603, r.error)
      return reply(id, { tools: r.result })
    }
    case 'tools/call': {
      const r = await loom('call', { name: params.name, arguments: params.arguments ?? {} })
      if (r.error) return reply(id, { content: [{ type: 'text', text: r.error }], isError: true })
      const out = r.result as { ok: boolean; result?: unknown; error?: string }
      if (!out.ok) return reply(id, { content: [{ type: 'text', text: out.error ?? 'failed' }], isError: true })
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(out.result) }] })
    }
    default:
      return fail(id, -32601, `method not found: ${method}`)
  }
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  input += chunk
  let nl: number
  while ((nl = input.indexOf('\n')) >= 0) {
    const line = input.slice(0, nl).trim()
    input = input.slice(nl + 1)
    if (!line) continue
    let msg: Json
    try {
      msg = JSON.parse(line)
    } catch {
      fail(null, -32700, 'parse error')
      continue
    }
    void handle(msg).catch((e) => fail(msg.id, -32603, String(e)))
  }
})
process.stdin.on('end', () => {
  conn?.end()
  process.exit(0)
})
