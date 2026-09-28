/**
 * The toolbox's hover card: a tool's name, a small picture of what it
 * actually looks like, and what it does.
 *
 * A list of 110 names is intimidating; "KanbanColumn" or "Segmented" means
 * nothing until you have seen one. The picture is the REAL component: its
 * output body with its default props at the size it lands at, drawn in the
 * document's theme and scaled to fit. Not a screenshot, so it can never go
 * stale, and it shows what the drop will give you, in your colours.
 */

import React from 'react'
import type { Document, Node } from './model/types'
import { instantiate } from './model/registry'
import { dropSize } from './model/drop-size'
import { buildStarter, getStarter } from './model/starters'
import { renderNode } from './render/web'
import { getTheme } from './render/theme'

/** The thumbnail's box, in screen pixels. */
export const THUMB_W = 232
export const THUMB_H = 132

/** A one-node (or one-starter) document holding just this tool, as dropped. */
export function thumbDoc(tool: { type?: string; starter?: string }, theme?: string): Document {
  const nodes: Record<string, Node> = {}
  let root: string
  if (tool.starter) {
    const st = getStarter(tool.starter)
    if (!st) throw new Error(`unknown starter: ${tool.starter}`)
    let n = 0
    const built = buildStarter(st, () => `t${n++}`)
    Object.assign(nodes, built.tree)
    nodes[built.root.id] = built.root
    root = built.root.id
  } else {
    const type = tool.type!
    const made = instantiate(type)
    root = 'thumb'
    nodes[root] = {
      id: root,
      type,
      props: { ...made.props, ...dropSize(type, false), x: 0, y: 0 },
      children: [],
      flow: made.flow,
      visible: true,
      locked: false,
      opacity: 1,
    }
  }
  return { version: 1, meta: { name: 'thumb', targets: ['web', 'desktop'], created: 0, theme: theme as never }, root, nodes } as Document
}

/**
 * The tool, drawn and scaled to fit the thumbnail box. Measured after the
 * first paint (a component's size is whatever its content makes it), then
 * zoomed down, never up: a Badge stays badge-sized in the middle.
 */
export function ToolThumb({ tool, theme }: { tool: { type?: string; starter?: string }; theme?: string }) {
  const doc = React.useMemo(() => thumbDoc(tool, theme), [tool.type, tool.starter, theme])
  const inner = React.useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = React.useState<{ z: number; w: number; h: number } | null>(null)
  // A docked tool (a sidebar pinned top to bottom) is as tall as the screen
  // it is docked to, so it is drawn on a small screen of the card's shape;
  // anything else is drawn at its own size.
  const anchor = String(doc.nodes[doc.root!]?.props.anchor ?? 'none')
  const screen = anchor !== 'none' && anchor !== '' ? { w: 720, h: Math.round((720 * THUMB_H) / THUMB_W) } : null
  React.useLayoutEffect(() => {
    const el = inner.current?.firstElementChild as HTMLElement | null
    if (!el) return
    const w = screen ? screen.w : Math.max(1, el.offsetWidth)
    const h = screen ? screen.h : Math.max(1, el.offsetHeight)
    const z = screen ? THUMB_W / screen.w : Math.min(1, (THUMB_W - 16) / w, (THUMB_H - 16) / h)
    setFit({ z, w, h })
  }, [doc])
  const t = getTheme(theme)
  return (
    <div className="thumb" style={{ width: THUMB_W, height: THUMB_H, background: t.bg, color: t.textPrimary, fontFamily: t.fontFamily }} aria-hidden="true">
      <div
        ref={inner}
        className="thumb-inner"
        inert
        style={{
          zoom: fit?.z ?? 1,
          width: fit ? fit.w : screen?.w,
          height: fit ? fit.h : screen?.h,
          // Centred in the box once measured; hidden until then so it never
          // flashes at full size.
          left: fit ? (THUMB_W / (fit.z || 1) - fit.w) / 2 : 0,
          top: fit ? (THUMB_H / (fit.z || 1) - fit.h) / 2 : 0,
          visibility: fit ? 'visible' : 'hidden',
        }}
      >
        {renderNode({ doc, selected: new Set(), mode: 'preview', theme: t }, doc.root!)}
      </div>
    </div>
  )
}

export interface CardTarget {
  tool: { type?: string; starter?: string }
  name: string
  text: string
  /** The hovered row, to sit the card beside it. */
  top: number
  left: number
}

/** The floating card beside the toolbox. */
export function ToolCard({ target, theme }: { target: CardTarget; theme?: string }) {
  const height = THUMB_H + 150
  const top = Math.max(46, Math.min(target.top - 12, window.innerHeight - height - 12))
  return (
    <div className="tool-card" role="tooltip" style={{ top, left: target.left }}>
      <div className="tool-card-name">{target.name}</div>
      <ToolThumb tool={target.tool} theme={theme} />
      <p className="tool-card-text">{target.text}</p>
    </div>
  )
}
