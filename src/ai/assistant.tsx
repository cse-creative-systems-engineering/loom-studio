/**
 * The Assistant: talk to an AI agent that builds on the canvas.
 *
 * Bottom-centre of the canvas, where the eye already is: a composer, and the
 * conversation above it once there is one. The agent runs in the main process
 * (the chosen CLI) and builds through Loom's tools, so its work appears live;
 * each turn is ONE undo step ("AI: ..."). What is selected goes with the
 * message, so "make this narrower" knows what "this" is. Follow-ups continue
 * the same conversation (the CLI's own session).
 */

import React from 'react'
import type { EditorStore } from '../state/store'
import { aiTurn } from './editor-bridge'

interface Provider {
  id: string
  label: string
  found: string | null
  signedIn: boolean
  apiKey: 'env' | 'saved' | null
  models: Array<{ id: string; label: string }>
  ready: boolean
  hint?: string
}

type Event =
  | { kind: 'session'; sessionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: unknown }
  | { kind: 'done'; text: string; sessionId: string | null; error?: string }

interface Api {
  providers: () => Promise<Provider[]>
  send: (req: { provider: string; model: string; prompt: string; sessionId: string | null }) => Promise<{ runId?: string; error?: string }>
  cancel: () => Promise<boolean>
  saveKey: (provider: string, key: string | null) => Promise<{ ok: boolean; error?: string }>
  onEvent: (cb: (runId: string, event: Event) => void) => () => void
}

interface Message {
  role: 'user' | 'assistant'
  text: string
  steps: string[]
  error?: string
  working?: boolean
}

const api = () => (window as unknown as { loomAi?: Api }).loomAi
const PREF = 'loom.assistant.provider'

function readPref(): { provider?: string; model?: string } {
  try {
    return JSON.parse(window.localStorage.getItem(PREF) ?? '{}')
  } catch {
    return {}
  }
}
function writePref(p: { provider: string; model: string }) {
  try {
    window.localStorage.setItem(PREF, JSON.stringify(p))
  } catch {
    // not remembered; still works
  }
}

/** A step as a person would say it: "add Card", "dock left". */
function stepLabel(name: string, input: unknown): string {
  const a = (input ?? {}) as Record<string, unknown>
  switch (name) {
    case 'add_component':
      return `add ${a.type ?? ''}`
    case 'add_starter':
      return `add ${a.starter ?? 'starter'}`
    case 'set_props':
      return `set ${Object.keys((a.props as object) ?? {}).slice(0, 3).join(', ')}`
    case 'dock':
      return `dock ${a.anchor ?? ''}`
    case 'move_into':
      return 'move into'
    case 'get_document':
      return 'look'
    case 'describe_component':
      return `read ${a.type ?? ''}`
    case 'list_components':
      return 'browse tools'
    default:
      return name.replace(/_/g, ' ')
  }
}

/** What the agent should know about the editor right now, with the message. */
function context(s: EditorStore): string {
  const sel = s.selection.map((id) => `${id} (${s.doc.nodes[id]?.type ?? '?'})`)
  return sel.length ? `\n\n[Selected in the editor: ${sel.join(', ')}]` : ''
}

export function Assistant({ s }: { s: EditorStore }) {
  const [providers, setProviders] = React.useState<Provider[] | null>(null)
  const [pick, setPick] = React.useState<{ provider: string; model: string }>(() => ({ provider: readPref().provider ?? '', model: readPref().model ?? '' }))
  const [draft, setDraft] = React.useState('')
  const [messages, setMessages] = React.useState<Message[]>([])
  const [open, setOpen] = React.useState(true)
  // Opened the conversation during this turn's build (otherwise it folds).
  const [peek, setPeek] = React.useState(false)
  const [runId, setRunId] = React.useState<string | null>(null)
  const [menu, setMenu] = React.useState(false)
  const [keyFor, setKeyFor] = React.useState<string | null>(null)
  const [keyDraft, setKeyDraft] = React.useState('')
  const [keyError, setKeyError] = React.useState('')
  const session = React.useRef<string | null>(null)
  const runRef = React.useRef<string | null>(null)
  // A send is in flight: its first events can arrive before its run id does
  // (two IPC channels), so they are claimed by the pending send, not dropped.
  const sending = React.useRef(false)
  const threadRef = React.useRef<HTMLDivElement | null>(null)

  const refresh = React.useCallback(() => {
    void api()
      ?.providers()
      .then((list) => {
        setProviders(list)
        setPick((cur) => {
          const ok = list.find((p) => p.id === cur.provider && p.ready) ?? list.find((p) => p.ready)
          if (!ok) return cur
          const model = ok.models.some((m) => m.id === cur.model) ? cur.model : ok.models[0]?.id ?? ''
          return { provider: ok.id, model }
        })
      })
  }, [])
  React.useEffect(refresh, [refresh])

  // Events for the running turn: steps, text, and the end of the turn.
  React.useEffect(
    () =>
      api()?.onEvent((id, ev) => {
        if (runRef.current === null && sending.current) runRef.current = id
        if (id !== runRef.current) return
        if (ev.kind === 'session') session.current = ev.sessionId
        setMessages((ms) => {
          const next = [...ms]
          const last = next[next.length - 1]
          if (!last || last.role !== 'assistant') return ms
          const m = { ...last }
          if (ev.kind === 'tool') m.steps = [...m.steps, stepLabel(ev.name, ev.input)]
          if (ev.kind === 'text') m.text = ev.text
          if (ev.kind === 'done') {
            m.working = false
            if (ev.text) m.text = ev.text
            if (ev.error) m.error = ev.error
            if (ev.sessionId) session.current = ev.sessionId
          }
          next[next.length - 1] = m
          return next
        })
        if (ev.kind === 'done') {
          aiTurn(s).end()
          runRef.current = null
          sending.current = false
          setRunId(null)
        }
      }),
    [s],
  )

  React.useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages])

  // Undo/redo while the agent works stops it (the store ends the turn).
  React.useEffect(() => {
    const t = aiTurn(s)
    t.onInterrupt = () => void api()?.cancel()
    return () => {
      t.onInterrupt = null
    }
  }, [s])

  const chosen = providers?.find((p) => p.id === pick.provider)
  const ready = providers?.some((p) => p.ready) ?? false

  const send = async () => {
    const text = draft.trim()
    if (!text || runId || !chosen?.ready) return
    setDraft('')
    setOpen(true)
    setPeek(false)
    setMessages((ms) => [...ms, { role: 'user', text, steps: [] }, { role: 'assistant', text: '', steps: [], working: true }])
    // The whole turn, however many changes, is one undo step.
    aiTurn(s).begin(`AI: ${text.length > 40 ? text.slice(0, 40) + '…' : text}`)
    sending.current = true
    runRef.current = null
    const r = await api()?.send({ provider: pick.provider, model: pick.model, prompt: text + context(s), sessionId: session.current })
    if (!r || r.error || !r.runId) {
      sending.current = false
      aiTurn(s).end()
      setMessages((ms) => {
        const next = [...ms]
        next[next.length - 1] = { role: 'assistant', text: '', steps: [], error: r?.error ?? 'The assistant is not available.' }
        return next
      })
      return
    }
    // Unless the turn already finished (its events claimed it and ended).
    if (sending.current) {
      runRef.current = r.runId
      setRunId(r.runId)
    }
  }

  const newChat = () => {
    if (runId) return
    session.current = null
    setMessages([])
  }

  const saveKey = async () => {
    if (!keyFor) return
    const r = await api()?.saveKey(keyFor, keyDraft)
    if (r?.ok) {
      setKeyFor(null)
      setKeyDraft('')
      setKeyError('')
      refresh()
    } else setKeyError(r?.error ?? 'Could not save the key.')
  }

  // While the agent builds, the conversation folds to one live line so the
  // canvas it is building on stays in view; "Show" opens it anyway.
  const last = messages[messages.length - 1]
  const live = runId && !peek && last?.role === 'assistant' && last.working ? last : null

  if (!api()) return null

  return (
    <div className="assistant" data-open={open && messages.length > 0 ? 'true' : 'false'}>
      {live && (
        <div className="as-live" role="status" aria-live="polite">
          <span className="as-live-dot" aria-hidden="true" />
          <span className="as-live-text">
            Building<span className="dim"> · {live.steps.length} {live.steps.length === 1 ? 'step' : 'steps'}{live.steps.length ? ` · ${live.steps[live.steps.length - 1]}` : ''}</span>
          </span>
          <button type="button" className="as-live-show" onClick={() => setPeek(true)} title="Show the conversation while it builds">
            Show
          </button>
        </div>
      )}
      {messages.length > 0 && open && !live && (
        <div className="as-thread" ref={threadRef} aria-live="polite">
          <div className="as-thread-head">
            <span>Assistant</span>
            <span className="as-thread-tools">
              <button type="button" onClick={newChat} disabled={!!runId} title="Start a new conversation">
                New
              </button>
              <button type="button" onClick={() => setOpen(false)} title="Hide the conversation">
                Hide
              </button>
            </span>
          </div>
          {messages.map((m, i) => (
            <div key={i} className={`as-msg ${m.role === 'user' ? 'from-user' : 'from-agent'}`}>
              {m.role === 'assistant' && m.steps.length > 0 && (
                <div className="as-steps" title={m.steps.join(' · ')}>
                  {m.steps.slice(-6).map((st, k) => (
                    <span key={k} className="as-step">
                      {st}
                    </span>
                  ))}
                  {m.steps.length > 6 && <span className="as-step more">+{m.steps.length - 6}</span>}
                </div>
              )}
              {m.text && <p>{m.text}</p>}
              {m.working && !m.text && <p className="as-working">Working…</p>}
              {m.error && <p className="as-error">{m.error}</p>}
            </div>
          ))}
        </div>
      )}

      {!ready && providers !== null && (
        <div className="as-setup">
          <strong>Connect an assistant</strong>
          {providers.map((p) => (
            <div key={p.id} className="as-setup-row">
              <span>{p.label}</span>
              <span className="dim">{p.hint}</span>
              {p.found && (
                <button type="button" className="mini" onClick={() => setKeyFor(p.id)}>
                  Paste API key
                </button>
              )}
            </div>
          ))}
          {keyFor && (
            <div className="as-key">
              <input type="password" placeholder={`${keyFor === 'claude' ? 'Anthropic' : 'OpenAI'} API key`} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} aria-label="API key" />
              <button type="button" className="mini" onClick={() => void saveKey()}>
                Save
              </button>
              {keyError && <span className="as-error">{keyError}</span>}
            </div>
          )}
        </div>
      )}

      <form
        className="as-composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <div className="as-pick">
          <button type="button" className="as-chip" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu} disabled={!ready} title="Which assistant and model">
            {chosen ? chosen.models.find((m) => m.id === pick.model)?.label ?? chosen.label : 'No assistant'}
            <span aria-hidden="true">▾</span>
          </button>
          {menu && providers && (
            <div className="as-menu" role="menu">
              {providers.map((p) => (
                <div key={p.id} className="as-menu-group">
                  <div className="as-menu-head">
                    {p.label}
                    <span className="dim">{p.ready ? (p.signedIn ? 'signed in' : p.apiKey === 'env' ? 'API key (env)' : 'API key') : 'not ready'}</span>
                  </div>
                  {p.models.map((m) => (
                    <button
                      key={m.id || 'default'}
                      type="button"
                      role="menuitemradio"
                      aria-checked={pick.provider === p.id && pick.model === m.id}
                      disabled={!p.ready}
                      onClick={() => {
                        const next = { provider: p.id, model: m.id }
                        setPick(next)
                        writePref(next)
                        setMenu(false)
                        // A different agent has a different memory.
                        if (next.provider !== pick.provider) session.current = null
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <textarea
          className="as-input"
          rows={1}
          placeholder={ready ? (s.selection.length ? 'Ask about the selection, or describe a change…' : 'Describe what to build or change…') : 'Connect an assistant to start'}
          value={draft}
          disabled={!ready}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Keep editor shortcuts (Delete, Ctrl+Z...) out of the text box.
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          aria-label="Message the assistant"
        />
        {messages.length > 0 && !open && (
          <button type="button" className="as-chip" onClick={() => setOpen(true)} title="Show the conversation">
            {messages.filter((m) => m.role === 'user').length} ▴
          </button>
        )}
        {runId ? (
          <button type="button" className="as-send stop" onClick={() => void api()?.cancel()} title="Stop">
            Stop
          </button>
        ) : (
          <button type="submit" className="as-send" disabled={!draft.trim() || !chosen?.ready} title="Send (Enter)">
            Send
          </button>
        )}
      </form>
    </div>
  )
}
