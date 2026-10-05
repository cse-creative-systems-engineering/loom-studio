/**
 * The Assistant without the desktop app: Claude on the viewer's own claude.ai
 * account, through a host that can ask Claude with page tools (a published
 * claude.ai page). The host hands Loom a `WebClaude` connector; Loom answers
 * with the same `window.loomAi` the desktop preload provides, so the
 * Assistant panel, its undo grouping and its tools are the ones the desktop
 * agent uses. Loom's tools run here in the page, against the live store.
 *
 * What differs from the desktop agent: no render/check_layout (main draws
 * those), no web browsing, a handful of tool rounds per message, and the
 * conversation is kept here (the host's Claude remembers nothing).
 */

import type { EditorStore } from '../state/store'
import { loomBrief } from './brief'
import { aiTurn } from './editor-bridge'
import { MAIN_TOOLS, runTool, TOOLS, type ToolDef } from './tools'

/** One turn of a conversation, oldest first; the list starts and ends on `user`. */
export interface WebTurn {
  role: 'user' | 'assistant'
  content: string
}

/** A Loom tool offered to Claude; `execute` runs here, in the page. */
export interface WebTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (input: Record<string, unknown>) => Promise<unknown>
}

/** What the host provides: ask Claude, with page tools. */
export interface WebClaude {
  /** Most tools one call may offer. */
  maxTools: number
  ask(
    turns: WebTurn[],
    opts: { modelTier: string; tools: WebTool[]; onText: (text: string) => void },
  ): { result: Promise<{ text: string; truncated?: boolean }>; cancel: () => void }
}

export const WEB_PROVIDER = 'claude-web'

/** Host limits on what one tool may carry. */
const MAX_DESCRIPTION = 1000
const MAX_RESULT = 30000
const MAX_TURNS = 24

/** Kept first when a host offers fewer tools than Loom has. */
const PRIORITY = ['get_document', 'build', 'describe_component', 'set_props', 'add_component', 'list_components', 'remove', 'move_into', 'set_flow', 'dock', 'set_look', 'set_actions', 'duplicate', 'add_starter', 'set_list', 'style_part', 'set_states', 'set_responsive', 'place', 'set_page', 'set_theme', 'set_light', 'set_display', 'set_effects', 'arrange', 'select']

/** The tools a web agent gets, in priority order, and the long descriptions moved to the brief. */
export function webToolDefs(max: number): { defs: ToolDef[]; notes: string[] } {
  const usable = TOOLS.filter((t) => !MAIN_TOOLS.has(t.name))
  const rank = (n: string) => {
    const i = PRIORITY.indexOf(n)
    return i < 0 ? PRIORITY.length : i
  }
  const chosen = [...usable].sort((a, b) => rank(a.name) - rank(b.name)).slice(0, Math.max(0, max))
  const notes: string[] = []
  const defs = chosen.map((t) => {
    if (t.description.length <= MAX_DESCRIPTION) return t
    notes.push(`${t.name}: ${t.description}`)
    const cut = t.description.slice(0, MAX_DESCRIPTION - 80)
    const end = cut.lastIndexOf('. ')
    return { ...t, description: `${end > 0 ? cut.slice(0, end + 1) : cut} The full reference is under Tool notes in your instructions.` }
  })
  return { defs, notes }
}

/** A document tree without props: ids, types and nesting only. */
function outline(n: unknown): unknown {
  if (!n || typeof n !== 'object') return n
  const o = n as { id?: unknown; type?: unknown; name?: unknown; children?: unknown[] }
  return { id: o.id, type: o.type, ...(o.name ? { name: o.name } : {}), ...(o.children ? { children: o.children.map(outline) } : {}) }
}

/** A tool result small enough for the host: big documents become an outline. */
export function fitResult(result: unknown): unknown {
  if (JSON.stringify(result ?? null).length <= MAX_RESULT) return result
  if (result && typeof result === 'object' && 'root' in result) {
    const slim = { ...(result as Record<string, unknown>), root: outline((result as { root: unknown }).root), note: 'Large document: props omitted. Ask describe_component or build in parts.' }
    if (JSON.stringify(slim).length <= MAX_RESULT) return slim
  }
  throw new Error('The result is too large to return; work on a smaller part of the document.')
}

/** What the person reads for each way a web call can fail. */
export function webErrorText(code: unknown): string {
  switch (code) {
    case 'cancelled':
      return 'Stopped.'
    case 'not_granted':
      return 'Claude is not allowed on this page yet. Allow it when asked, or from the page\'s Permissions menu.'
    case 'sampling_disabled':
      return 'Claude is not available for this account.'
    case 'rate_limited':
      return 'Your Claude usage limit has been reached for now. Try again later.'
    case 'session_expired':
      return 'Sign in to claude.ai again, then send the message again.'
    case 'refused':
      return 'Claude declined that request. Try asking differently.'
    case 'prompt_too_large':
      return 'This conversation is too long. Start a new one.'
    case 'empty_completion':
      return 'Claude did not reply. Try asking for less at once.'
    case 'tools_unavailable':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed':
      return 'This page cannot run the Assistant.'
    default:
      return 'Claude could not be reached. Try again.'
  }
}

type Listener = (runId: string, event: unknown) => void

/** The `window.loomAi` a web host provides, backed by `WebClaude`. */
export function webAssistantApi(store: EditorStore, claude: WebClaude) {
  const listeners = new Set<Listener>()
  const emit = (runId: string, event: unknown) => listeners.forEach((l) => l(runId, event))
  const sessions = new Map<string, WebTurn[]>()
  const { defs, notes } = webToolDefs(claude.maxTools)
  const brief = [
    loomBrief({ canSee: false, canBrowse: false }),
    'Here the Loom tools are named without the mcp__loom__ prefix.',
    ...(notes.length ? ['', 'Tool notes:', ...notes] : []),
  ].join('\n')
  let running: { cancel: () => void } | null = null

  return {
    onRequest: () => () => undefined,
    respond: async () => undefined,
    providers: async () => [
      {
        id: WEB_PROVIDER,
        label: 'Claude',
        found: 'claude.ai',
        signedIn: true,
        subscription: true,
        accountNote: 'your claude.ai account',
        apiKey: null,
        models: [
          { id: 'default', label: 'Claude' },
          { id: 'complex', label: 'Claude (most capable)' },
          { id: 'quick', label: 'Claude (fastest)' },
        ],
        ready: true,
      },
    ],
    send: async (req: { provider: string; model: string; prompt: string; sessionId: string | null }) => {
      if (running) return { error: 'The assistant is still working on the last message.' }
      if (req.provider !== WEB_PROVIDER) return { error: 'unknown provider' }
      const runId = crypto.randomUUID()
      const sessionId = req.sessionId && sessions.has(req.sessionId) ? req.sessionId : crypto.randomUUID()
      const history = sessions.get(sessionId) ?? []
      const turns: WebTurn[] = [{ role: 'user', content: brief }, ...history.slice(-MAX_TURNS), { role: 'user', content: req.prompt }]
      const tools: WebTool[] = defs.map((d) => ({
        name: d.name,
        description: d.description,
        inputSchema: d.inputSchema,
        execute: async (input) => {
          const args = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
          emit(runId, { kind: 'tool', name: d.name, input: args })
          const r = runTool(store, aiTurn(store), d.name, args)
          if (!r.ok) throw new Error(r.error)
          return fitResult(r.result)
        },
      }))
      const tier = ['default', 'complex', 'quick'].includes(req.model) ? req.model : 'default'
      const call = claude.ask(turns, { modelTier: tier, tools, onText: (text) => emit(runId, { kind: 'text', text }) })
      running = call
      // Events go out after `send` resolves, as the desktop's do.
      queueMicrotask(() => emit(runId, { kind: 'session', sessionId }))
      call.result.then(
        ({ text }) => {
          running = null
          sessions.set(sessionId, [...history, { role: 'user', content: req.prompt }, { role: 'assistant', content: text }])
          emit(runId, { kind: 'done', text, sessionId })
        },
        (e: { code?: unknown; text?: unknown }) => {
          running = null
          // A failed turn is kept as asked, so the next message has the context.
          sessions.set(sessionId, [...history, { role: 'user', content: req.prompt }])
          emit(runId, { kind: 'done', text: typeof e?.text === 'string' ? e.text : '', sessionId, error: webErrorText(e?.code) })
        },
      )
      return { runId }
    },
    cancel: async () => {
      running?.cancel()
      return true
    },
    saveKey: async () => ({ ok: false, error: 'Not used here: Claude runs on your claude.ai account.' }),
    login: async () => ({ error: 'Not used here: you are signed in to claude.ai.' }),
    loginCode: async () => false,
    loginOpen: async () => false,
    loginCancel: async () => false,
    onLogin: () => () => undefined,
    onEvent: (cb: Listener) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}

export const AI_AVAILABLE_EVENT = 'loom:ai-available'

/**
 * Let a host connect Claude: `window.__loomConnectClaude(connector)`. Ignored
 * where the desktop app already provides the Assistant. True when connected.
 */
export function installWebClaudeHook(store: EditorStore): () => void {
  const w = window as unknown as { loomAi?: unknown; __loomConnectClaude?: (c: WebClaude) => boolean }
  w.__loomConnectClaude = (c) => {
    if (w.loomAi) return false
    if (!c || typeof c.ask !== 'function' || !(c.maxTools > 0)) return false
    w.loomAi = webAssistantApi(store, c)
    window.dispatchEvent(new Event(AI_AVAILABLE_EVENT))
    return true
  }
  return () => {
    delete w.__loomConnectClaude
  }
}
