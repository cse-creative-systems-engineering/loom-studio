/**
 * The editor's side of the AI connection: answers tool requests relayed by
 * the main process with the tools in `tools.ts`, run against the live store.
 * Installed once by the app; `aiTurn` groups an agent's turn into one undo.
 */

import type { EditorStore } from '../state/store'
import { AiTurn, runTool, TOOLS } from './tools'

interface AiApi {
  onRequest: (cb: (reqId: string, method: string, params: unknown) => void) => () => void
  respond: (reqId: string, reply: unknown) => Promise<unknown>
}

let turn: AiTurn | null = null

/** The open turn, for the Assistant panel to begin and end. */
export function aiTurn(store: EditorStore): AiTurn {
  if (!turn) turn = new AiTurn(store)
  return turn
}

export function installAiBridge(store: EditorStore): () => void {
  const api = (window as unknown as { loomAi?: AiApi }).loomAi
  if (!api) return () => undefined
  const t = aiTurn(store)
  return api.onRequest((reqId, method, params) => {
    if (method === 'tools') {
      void api.respond(reqId, { result: TOOLS })
      return
    }
    if (method === 'call') {
      const p = (params ?? {}) as { name?: unknown; arguments?: unknown }
      const args = p.arguments && typeof p.arguments === 'object' && !Array.isArray(p.arguments) ? (p.arguments as Record<string, unknown>) : {}
      void api.respond(reqId, { result: runTool(store, t, String(p.name ?? ''), args) })
      return
    }
    void api.respond(reqId, { error: `unknown method ${method}` })
  })
}
