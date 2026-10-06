/**
 * Watching the Assistant build: what it adds appears on the canvas piece by
 * piece, in build order (a container, then what is inside it), instead of a
 * whole section popping in at once.
 *
 * The agent works in a few large steps (one `build` makes a whole section,
 * and on the web each round of tool calls lands together after Claude has
 * thought), so without this a person waits, then sees a finished screen. The
 * document is not touched: the nodes exist at once and are only drawn in
 * order, through the canvas's own elements, with a trace drawn on a separate
 * overlay layer. Exports never see it. Reduced motion: a short plain fade.
 */

import type { EditorStore } from '../state/store'
import { aiTurn } from './editor-bridge'

/** How long one node takes to materialize, and the pacing between nodes. */
const APPEAR_MS = 460
const STEP_MS = 55
const MIN_STEP_MS = 12
/** A large section still assembles within about this long. */
const SPREAD_MS = 2600
/** The outline and scan that trace each piece as it lands. */
const TRACE_MS = 720
/** At most this many traced at once; the rest only materialize. */
const MAX_TRACES = 80
/** Expo out: fast arrival, long precise settle. */
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'

/** The nodes in `doc` under `root`, parents before children, in reading order. */
function inOrder(nodes: Record<string, { children: string[] }>, root: string | null): string[] {
  const out: string[] = []
  const walk = (id: string) => {
    const n = nodes[id]
    if (!n) return
    out.push(id)
    n.children.forEach(walk)
  }
  if (root) walk(root)
  return out
}

/** The delay before each node appears: steady pacing, compressed for big builds. */
export function revealDelays(count: number): number[] {
  const step = Math.max(MIN_STEP_MS, Math.min(STEP_MS, SPREAD_MS / Math.max(1, count)))
  return Array.from({ length: count }, (_, i) => Math.round(i * step))
}

/** Sent when the person stops the Assistant: show everything it built, now, to edit. */
export const AI_STOPPED_EVENT = 'loom:ai-stopped'

export function installBuildReveal(store: EditorStore, surface: () => HTMLElement | null): () => void {
  let known = new Set(Object.keys(store.doc.nodes))
  let seenDoc = store.doc
  // Nodes still to appear in the current wave, and when that wave started.
  let wave: { start: number; next: number } | null = null
  let frame = 0
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  /** One fixed layer for the traces, above the canvas, never hit-tested. */
  let layer: HTMLDivElement | null = null
  /** Covers the canvas only, so a trace never draws over the side panels. */
  const traceLayer = (host: HTMLElement) => {
    if (!layer || !layer.isConnected) {
      layer = document.createElement('div')
      layer.className = 'ai-reveal-layer'
      layer.setAttribute('aria-hidden', 'true')
      document.body.append(layer)
    }
    const clip = (host.closest('.canvas-wrap') ?? host).getBoundingClientRect()
    Object.assign(layer.style, { left: `${clip.left}px`, top: `${clip.top}px`, width: `${clip.width}px`, height: `${clip.height}px` })
    return { layer, clip }
  }

  /** A thin accent outline that draws in with a glow while a scan line sweeps through. */
  const trace = (host: HTMLElement, el: HTMLElement, delay: number) => {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return
    const box = document.createElement('div')
    box.className = 'ai-reveal-box'
    const { layer: into, clip } = traceLayer(host)
    Object.assign(box.style, { left: `${r.left - clip.left}px`, top: `${r.top - clip.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: getComputedStyle(el).borderRadius })
    const scan = document.createElement('div')
    scan.className = 'ai-reveal-scan'
    box.append(scan)
    into.append(box)
    const done = box.animate(
      [
        { opacity: 0, scale: '1.012' },
        { opacity: 1, scale: '1', offset: 0.22 },
        { opacity: 0.85, offset: 0.6 },
        { opacity: 0, scale: '1' },
      ],
      { duration: TRACE_MS, delay, easing: EASE, fill: 'both' },
    )
    scan.animate([{ translate: '0 -100%' }, { translate: `0 ${Math.max(r.height, 24)}px` }], { duration: TRACE_MS * 0.7, delay, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' })
    track(done)
    track(scan.getAnimations()[0])
    done.finished.then(() => box.remove(), () => box.remove())
  }

  // Running reveals, so a Stop can show everything at once.
  const running = new Set<Animation>()
  const track = (a: Animation) => {
    running.add(a)
    a.finished.then(() => running.delete(a), () => running.delete(a))
  }
  const finishAll = () => {
    cancelAnimationFrame(frame)
    frame = 0
    pending.clear()
    for (const a of [...running]) a.finish()
    wave = null
  }

  const animate = (ids: string[]) => {
    const host = surface()
    if (!host || !ids.length) return
    const now = performance.now()
    // A wave continues while nodes keep arriving, so a second round queues behind the first.
    if (!wave || now > wave.next + APPEAR_MS) wave = { start: now, next: now }
    const delays = revealDelays(ids.length)
    const offset = Math.max(0, wave.next - now)
    const calm = reduced()
    ids.forEach((id, i) => {
      const el = host.querySelector<HTMLElement>(`[data-loom-id="${CSS.escape(id)}"]`)
      if (!el) return
      const delay = offset + delays[i]
      if (calm) {
        track(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, delay, fill: 'backwards' }))
        return
      }
      // Materialize: out of a soft blur, settling up into place.
      track(el.animate(
        [
          { opacity: 0, filter: 'blur(8px) saturate(0.4)', translate: '0 10px', scale: '0.985' },
          { opacity: 1, filter: 'blur(0px) saturate(1)', translate: '0 0', scale: '1' },
        ],
        { duration: APPEAR_MS, delay, easing: EASE, fill: 'backwards' },
      ))
      if (i < MAX_TRACES) trace(host, el, delay)
    })
    wave.next = now + offset + (delays[delays.length - 1] ?? 0) + Math.min(STEP_MS, SPREAD_MS / ids.length)
  }

  // Added since the last frame; several store updates can land in one frame.
  const pending = new Set<string>()
  const unsubscribe = store.subscribe(() => {
    // The store also emits for hover, selection and the like.
    if (store.doc === seenDoc) return
    seenDoc = store.doc
    const ids = Object.keys(store.doc.nodes)
    const added = ids.filter((id) => !known.has(id))
    known = new Set(ids)
    // Only the Assistant's work is revealed; a person's own edit is immediate.
    if (!added.length || !aiTurn(store).active) return
    added.forEach((id) => pending.add(id))
    if (frame) return
    // Two frames: the second runs after React has drawn the new nodes.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = 0
        const ordered = inOrder(store.doc.nodes, store.doc.root).filter((id) => pending.has(id))
        pending.clear()
        animate(ordered)
      })
    })
  })
  window.addEventListener(AI_STOPPED_EVENT, finishAll)
  return () => {
    window.removeEventListener(AI_STOPPED_EVENT, finishAll)
    finishAll()
    unsubscribe()
    layer?.remove()
  }
}
