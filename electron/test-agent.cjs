// A scripted stand-in for an agent CLI, for the probes only (enabled by
// LOOM_AI_TEST_AGENT). It speaks the same wire format as Claude Code's
// `-p --output-format stream-json`, and builds through the REAL path: it
// launches Loom's MCP bridge from the --mcp-config file and calls tools. So the
// Assistant, main's runner, the bridge, the socket and the editor's tools are
// all exercised, with no model and no cost.
//
// What it does, from the prompt:
//   "card: <title>"   add a Card with that title to the root (a free parent)
//   "fail"            call a tool that is refused, then report an error
//   "slow"            wait (so Stop can be tested), then add a card
'use strict'
const fs = require('node:fs')
const { spawn } = require('node:child_process')

const argv = process.argv.slice(2)
const arg = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const prompt = arg('-p') || ''
const resume = arg('--resume')
const session = resume || 'test-session-1'
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n')

async function main() {
  out({ type: 'system', subtype: 'init', session_id: session })
  const cfg = JSON.parse(fs.readFileSync(arg('--mcp-config'), 'utf8')).mcpServers.loom
  const bridge = spawn(cfg.command, cfg.args, { env: { ...process.env, ...cfg.env }, stdio: ['pipe', 'pipe', 'inherit'] })
  let buf = ''
  const waiting = new Map()
  bridge.stdout.setEncoding('utf8')
  bridge.stdout.on('data', (c) => {
    buf += c
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, nl))
      buf = buf.slice(nl + 1)
      const done = waiting.get(msg.id)
      if (done) {
        waiting.delete(msg.id)
        done(msg)
      }
    }
  })
  let id = 0
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const n = ++id
      waiting.set(n, resolve)
      bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n')
    })
  const tool = async (name, args) => {
    out({ type: 'assistant', session_id: session, message: { content: [{ type: 'tool_use', name: `mcp__loom__${name}`, input: args }] } })
    const r = await rpc('tools/call', { name, arguments: args })
    return r.result
  }
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-agent', version: '1' } })
  const doc = JSON.parse((await tool('get_document', {})).content[0].text)
  const root = doc.root && doc.root.id
  let text
  if (/^fail/.test(prompt)) {
    const r = await tool('add_component', { type: 'NoSuchThing', parent_id: root })
    text = r.isError ? 'I could not add that.' : 'unexpected'
    out({ type: 'assistant', session_id: session, message: { content: [{ type: 'text', text }] } })
    out({ type: 'result', result: text, session_id: session, is_error: true })
  } else {
    if (/^slow/.test(prompt)) await new Promise((r) => setTimeout(r, 4000))
    const title = (/card:\s*(.+)/.exec(prompt) || [])[1] || 'From the assistant'
    await tool('add_component', { type: 'Card', parent_id: root, x: 40, y: 40, props: { title } })
    const added = await tool('add_component', { type: 'Button', parent_id: root, x: 40, y: 260, props: { label: resume ? 'Follow-up' : 'Primary' } })
    void added
    text = `Added a card titled "${title}"${resume ? ' (continuing the conversation)' : ''}.`
    out({ type: 'assistant', session_id: session, message: { content: [{ type: 'text', text }] } })
    out({ type: 'result', result: text, session_id: session, is_error: false, total_cost_usd: 0 })
  }
  bridge.stdin.end()
}
main().catch((e) => {
  out({ type: 'result', result: String(e), session_id: session, is_error: true })
  process.exit(1)
})
