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
        <button className="ctx-item" role="menuitem" onClick={run(() => s.cut([id]))} disabled={node.locked === true}>
          <span className="ctx-k"><Ico name="x" size={13} /></span> Cut
          <span className="ctx-note">Ctrl+X</span>
        </button>
      )}
      <button className="ctx-item" role="menuitem" onClick={run(() => s.copy([id]))}>
        <span className="ctx-k"><Ico name="copy" size={13} /></span> Copy
        <span className="ctx-note">Ctrl+C</span>
      </button>
      <button
        className="ctx-item"
        role="menuitem"
        onClick={run(() => {
          s.select([id])
          s.paste()
        })}
        disabled={s.clipboard.length === 0}
      >
        <span className="ctx-k"><Ico name="paperclip" size={13} /></span> Paste
        <span className="ctx-note">Ctrl+V</span>
      </button>

      <button className="ctx-item" role="menuitem" onClick={run(() => s.copyLook(id))} disabled={!node.looks?.['']}>
        <span className="ctx-k"><Ico name="sun" size={13} /></span> Copy look
        <span className="ctx-note">Ctrl+Alt+C</span>
      </button>
      <button className="ctx-item" role="menuitem" onClick={run(() => s.pasteLook(s.selection.includes(id) ? s.selection : [id]))} disabled={!s.lookClipboard}>
        <span className="ctx-k"><Ico name="sun" size={13} /></span> Paste look
        <span className="ctx-note">Ctrl+Alt+V</span>
      </button>

      {!isRoot && (
        <>
          <button className="ctx-item" role="menuitem" onClick={run(() => s.duplicateAll([id]))} disabled={node.locked === true}>
            <span className="ctx-k"><Ico name="copy" size={13} /></span> Duplicate
            <span className="ctx-note">Ctrl+D</span>
          </button>

          <div className="ctx-sep" />

          <button className="ctx-item" role="menuitem" onClick={run(() => s.arrange(id, 'front'))} disabled={!parent || s.doc.nodes[parent].children[0] === id}>
            <span className="ctx-k"><Ico name="arrow-up" size={13} /></span> Bring to front
          </button>
          <button className="ctx-item" role="menuitem" onClick={run(() => s.arrange(id, 'back'))} disabled={!parent || s.doc.nodes[parent].children.at(-1) === id}>
            <span className="ctx-k"><Ico name="arrow-down" size={13} /></span> Send to back
          </button>
          <button className="ctx-item" role="menuitem" onClick={run(() => s.wrap(s.selection.includes(id) ? s.selection : [id]))}>
            <span className="ctx-k"><Ico name="grid" size={13} /></span> Wrap in Stack
          </button>

          <div className="ctx-sep" />

          <button
            className="ctx-item"
            role="menuitem"
            onClick={run(() => s.commit({ op: 'setVisible', id, visible: node.visible === false }, node.visible === false ? 'Show' : 'Hide'))}
          >
            <span className="ctx-k"><Ico name={node.visible === false ? 'eye' : 'eye-off'} size={13} /></span>
            {node.visible === false ? 'Show in output' : 'Hide from output'}
          </button>
          <button
            className="ctx-item"
            role="menuitem"
            onClick={run(() => s.commit({ op: 'setLocked', id, locked: !node.locked }, node.locked ? 'Unlock' : 'Lock'))}
          >
            <span className="ctx-k"><Ico name="lock" size={13} /></span> {node.locked ? 'Unlock' : 'Lock'}
          </button>
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
