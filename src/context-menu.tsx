/**
 * Canvas context menu.
 *
 * Right-click on a placed element. Every item is an OP or a store call —
 * there is no menu-only behaviour, so anything reachable here is also
 * reachable by the future AI assistant, and vice versa.
 */

import React from 'react'
import type { EditorStore } from './state/store'
import { getComponent, unsupportedProps } from './model/registry'
import { isFlowChild } from './render/web'
import { parentOf } from './model/ops'
import type { NodeId } from './model/types'
import { Glyph, Ico } from './ui-primitives'
import { toolGlyph } from './tool-icons'
import './context-menu.css'

export interface MenuState {
  x: number
  y: number
  targetId: NodeId
}

interface Props {
  s: EditorStore
  state: MenuState
  onClose: () => void
}

export function ContextMenu({ s, state, onClose }: Props) {
  const ref = React.useRef<HTMLDivElement>(null)
  const node = s.doc.nodes[state.targetId]

  // Close on outside click, Escape, or scroll — the standard contract.
  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  // Keep the menu on screen when opened near an edge.
  const [pos, setPos] = React.useState({ left: state.x, top: state.y })
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = state.x
    let top = state.y
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8)
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, state.y - r.height)
    setPos({ left, top })
  }, [state.x, state.y])

  if (!node) return null

  const spec = getComponent(node.type)
  const id = state.targetId
  const parent = parentOf(s.doc, id)
  const isRoot = id === s.doc.root
  const flowChild = isFlowChild(s.doc, id)
  const gated = spec ? unsupportedProps(spec, s.target) : []

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-head">
        {/* The tool's own drawing, as the toolbox shows it, not its legacy character. */}
        <span className="ctx-icon"><Glyph markup={toolGlyph(node.type, spec?.category)} /></span>
        <div>
          <div className="ctx-name">{spec?.name ?? node.type}</div>
          <div className="ctx-sub">{isRoot ? 'root' : parent ? `in ${s.doc.nodes[parent]?.type ?? '?'}` : ''}</div>
        </div>
      </div>

      <div className="ctx-sep" />

      <button className="ctx-item" role="menuitem" onClick={run(() => s.select([id]))}>
        <span className="ctx-k"><Ico name="check" size={13} /></span> Select
      </button>

      {!isRoot && (
        <>
          <button
            className="ctx-item"
            role="menuitem"
            onClick={run(() =>
              s.commitAll(
                [
                  { op: 'move', id, x: 0, y: 0 },
                  { op: 'setProp', id, key: 'w', value: null },
                  { op: 'setProp', id, key: 'h', value: null },
                ],
                'Reset geometry',
              ),
            )}
          >
            <span className="ctx-k"><Ico name="refresh" size={13} /></span> Reset geometry
          </button>

          <button
            className="ctx-item"
            role="menuitem"
            onClick={run(() => s.commit({ op: 'setFlow', id, flow: !node.flow }, 'Toggle layout'))}
          >
            <span className="ctx-k"><Ico name={node.flow ? 'grid' : 'list'} size={13} /></span>
            {node.flow ? 'Make free-positioned' : 'Make flow child'}
            {flowChild && <span className="ctx-note">set by parent</span>}
          </button>

          <button
            className="ctx-item"
            role="menuitem"
            onClick={run(() => s.setProp(id, 'w', 200))}
          >
            <span className="ctx-k"><Ico name="ruler" size={13} /></span> Set width 200
          </button>

          <div className="ctx-sep" />

          <button
            className="ctx-item"
            role="menuitem"
            onClick={run(() => {
              if (parent) s.select([parent])
            })}
            disabled={!parent}
          >
            <span className="ctx-k"><Ico name="arrow-up" size={13} /></span> Select parent
          </button>

          <button
            className="ctx-item danger"
            role="menuitem"
            onClick={run(() => s.remove([id]))}
          >
            <span className="ctx-k"><Ico name="trash" size={13} /></span> Delete
            <span className="ctx-note">Del</span>
          </button>
        </>
      )}

      {gated.length > 0 && (
        <>
          <div className="ctx-sep" />
          <div className="ctx-warn">
            ◈ {gated.length} prop{gated.length > 1 ? 's' : ''} not supported on {s.target}:{' '}
            {gated.join(', ')}
          </div>
        </>
      )}
    </div>
  )
}
