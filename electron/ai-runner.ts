/**
 * Running one agent turn: the chosen CLI, given the user's message and Loom's
 * MCP tools, streamed back as events the Assistant shows as it works.
 *
 * Each CLI keeps the conversation itself: the first turn returns a session id
 * and the next turn resumes it, so "make it narrower" knows what "it" is.
 * The agent runs in an empty private working directory and may use ONLY
 * Loom's tools (Claude: --strict-mcp-config + an allow-list; Codex: a
 * read-only sandbox), so a UI request can never touch files or run commands.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { app } from 'electron'
import type { ProviderId } from './ai-providers'
import { loomBrief } from '../src/ai/brief'

export type AgentEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: unknown }
  | { kind: 'done'; text: string; sessionId: string | null; error?: string; cost?: number }

export interface RunRequest {
  provider: ProviderId
  command: string
  model: string
  prompt: string
  sessionId: string | null
  /** How to launch Loom's MCP server (main.ts `mcpServerConfig`). */
  mcp: { command: string; args: string[]; env: Record<string, string> }
  /** The MCP config file (for Claude Code). */
  mcpConfigPath: string
  /** Extra environment: an API key when that is how it signs in. */
  env: Record<string, string>
  /** Variables removed from the inherited environment (an API key, when the turn runs on a subscription). */
  stripEnv?: string[]
}

/** What every turn is told about building in Loom. */
export const LOOM_BRIEF = loomBrief({ canSee: true, canBrowse: true })

function workDir(): string {
  const d = path.join(app.getPath('userData'), 'ai', 'work')
  fs.mkdirSync(d, { recursive: true, mode: 0o700 })
  return d
}

const toml = (s: string) => JSON.stringify(s) // a TOML basic string is a JSON string for these values

export function agentArgs(r: RunRequest, cwd: string): string[] {
  if (r.provider === 'claude') {
    return [
      '-p',
      r.prompt,
      ...(r.model ? ['--model', r.model] : []),
      '--mcp-config',
      r.mcpConfigPath,
      '--strict-mcp-config',
      // Loom's tools, plus READ-ONLY research: asked to rebuild a real page,
      // the agent tried to fetch it and was refused, so it built from memory.
      // It still cannot act anywhere but through Loom's validated tools.
      '--allowedTools',
      'mcp__loom__*',
      'WebFetch',
      'WebSearch',
      '--output-format',
      'stream-json',
      '--verbose',
      '--append-system-prompt',
      LOOM_BRIEF,
      ...(r.sessionId ? ['--resume', r.sessionId] : []),
    ]
  }
  const envTable = `{${Object.entries(r.mcp.env).map(([k, v]) => `${k}=${toml(v)}`).join(',')}}`
  const common = [
    '--json',
    '--skip-git-repo-check',
    '-s',
    'read-only',
    '-C',
    cwd,
    ...(r.model ? ['-m', r.model] : []),
    '-c',
    `mcp_servers.loom.command=${toml(r.mcp.command)}`,
    '-c',
    `mcp_servers.loom.args=[${r.mcp.args.map(toml).join(',')}]`,
    '-c',
    `mcp_servers.loom.env=${envTable}`,
    // Loom's tools only edit the document, validated and undoable as one
    // step, so they are pre-approved; without this `codex exec` refuses
    // every write ("approval policy never"). The read-only sandbox still
    // blocks files and commands.
    '-c',
    'mcp_servers.loom.default_tools_approval_mode="approve"',
  ]
  const prompt = r.sessionId ? r.prompt : `${LOOM_BRIEF}\n\n---\n\n${r.prompt}`
  return r.sessionId ? ['exec', ...common, 'resume', r.sessionId, prompt] : ['exec', ...common, prompt]
}

/** Turn one line of CLI output into events (Claude stream-json or Codex --json). */
export function parseLine(provider: ProviderId, line: string, state: { text: string; sessionId: string | null }): AgentEvent[] {
  let m: Record<string, unknown>
  try {
    m = JSON.parse(line)
  } catch {
    return []
  }
  const out: AgentEvent[] = []
  if (provider === 'claude') {
    if (typeof m.session_id === 'string' && m.session_id !== state.sessionId) {
      state.sessionId = m.session_id
      out.push({ kind: 'session', sessionId: m.session_id })
    }
    if (m.type === 'assistant') {
      const content = ((m.message as { content?: unknown[] } | undefined)?.content ?? []) as Array<Record<string, unknown>>
      for (const c of content) {
        if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
          state.text = c.text
          out.push({ kind: 'text', text: c.text })
        }
        if (c.type === 'tool_use' && typeof c.name === 'string') out.push({ kind: 'tool', name: c.name.replace(/^mcp__loom__/, ''), input: c.input })
      }
    }
    if (m.type === 'result') {
      const text = typeof m.result === 'string' ? m.result : state.text
      out.push({ kind: 'done', text, sessionId: state.sessionId, ...(m.is_error ? { error: text || 'the agent stopped with an error' } : {}), ...(typeof m.total_cost_usd === 'number' ? { cost: m.total_cost_usd } : {}) })
    }
    return out
  }
  // Codex --json: thread.started / item.* / turn.completed / error.
  if (m.type === 'thread.started' && typeof m.thread_id === 'string') {
    state.sessionId = m.thread_id
    out.push({ kind: 'session', sessionId: m.thread_id })
  }
  const item = m.item as Record<string, unknown> | undefined
  if (m.type === 'item.completed' && item) {
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      state.text = item.text
      out.push({ kind: 'text', text: item.text })
    }
  }
  if (m.type === 'item.started' && item?.type === 'mcp_tool_call') {
    out.push({ kind: 'tool', name: String(item.tool ?? ''), input: item.arguments })
  }
  if (m.type === 'turn.completed') out.push({ kind: 'done', text: state.text, sessionId: state.sessionId })
  if (m.type === 'turn.failed' || m.type === 'error') {
    const msg = (m.error as { message?: string } | undefined)?.message ?? (typeof m.message === 'string' ? m.message : 'the agent stopped with an error')
    out.push({ kind: 'done', text: state.text, sessionId: state.sessionId, error: msg })
  }
  return out
}

/** Start a turn. Events stream to `onEvent`; exactly one `done` is sent. */
export function runAgent(r: RunRequest, onEvent: (e: AgentEvent) => void, prefixArgs: string[] = []): { cancel: () => void } {
  const cwd = workDir()
  const state = { text: '', sessionId: r.sessionId }
  let finished = false
  const finish = (e: AgentEvent & { kind: 'done' }) => {
    if (finished) return
    finished = true
    onEvent(e)
  }
  let child: ChildProcess
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, ...r.env }
    for (const k of r.stripEnv ?? []) delete env[k]
    child = spawn(r.command, [...prefixArgs, ...agentArgs(r, cwd)], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    finish({ kind: 'done', text: '', sessionId: null, error: `could not start ${r.provider}: ${e instanceof Error ? e.message : String(e)}` })
    return { cancel: () => undefined }
  }
  let buf = ''
  let errText = ''
  child.stdout!.setEncoding('utf8')
  child.stdout!.on('data', (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      for (const e of parseLine(r.provider, line, state)) {
        if (e.kind === 'done') finish(e)
        else onEvent(e)
      }
    }
  })
  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', (c: string) => {
    errText = (errText + c).slice(-4000)
  })
  child.on('error', (e) => finish({ kind: 'done', text: state.text, sessionId: state.sessionId, error: e.message }))
  child.on('close', (code) => {
    finish({
      kind: 'done',
      text: state.text,
      sessionId: state.sessionId,
      ...(code === 0 ? {} : { error: (errText.trim().split('\n').slice(-3).join(' ') || `${r.provider} exited with code ${code}`).slice(0, 400) }),
    })
  })
  return {
    cancel: () => {
      if (!finished) {
        child.kill('SIGTERM')
        finish({ kind: 'done', text: state.text, sessionId: state.sessionId, error: 'Stopped.' })
      }
    },
  }
}
