/**
 * The specimen board: every tool, in its own cell, as it looks when it lands.
 *
 * Quality is judged on first sight (a survey of 100 people said "generic,
 * low quality, cheap"), so it has to be LOOKED at, all of it, the same way
 * every time. This draws each tool with the same renderer as the toolbox
 * hover cards, at a larger size, in one theme, on that theme's page. The
 * specimen script (`electron/specimen.mjs`) screenshots it; a before/after
 * pair is the unit of progress for the visual overhaul.
 *
 * A tooling surface, mounted only by the script's hook, never in the product.
 */

import { createRoot, type Root } from 'react-dom/client'
import { allComponents, addedTypes } from './model/registry'
import { STARTERS } from './model/starters'
import { ToolThumb } from './tool-card'
import { getTheme } from './render/theme'

const CELL_W = 320
const CELL_H = 200

function Board({ theme, only }: { theme: string; only?: string[] }) {
  const added = addedTypes()
  const t = getTheme(theme)
  const tools = [
    ...STARTERS.map((st) => ({ key: `starter:${st.id}`, label: st.label, category: 'Starters', tool: { starter: st.id } })),
    ...allComponents()
      .filter((c) => !added.has(c.name))
      .map((c) => ({ key: c.name, label: c.name, category: c.category, tool: { type: c.name } })),
  ].filter((x) => !only || only.includes(x.label))
  return (
    <div className="specimen" style={{ background: t.bg, color: t.textPrimary }}>
      <div className="specimen-head">
        Loom specimen · <strong>{theme}</strong> · {tools.length} tools
      </div>
      <div className="specimen-grid">
        {tools.map((x) => (
          <figure key={x.key} className="specimen-cell" data-tool={x.label}>
            <ToolThumb tool={x.tool} theme={theme} width={CELL_W} height={CELL_H} />
            <figcaption>
              {x.label} <span>{x.category}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}

let root: Root | null = null
let host: HTMLElement | null = null

/** Mount (or re-mount) the board over the app, full screen. */
export function showSpecimen(theme: string, only?: string[]): number {
  if (!host) {
    host = document.createElement('div')
    host.id = 'loom-specimen'
    document.body.appendChild(host)
    root = createRoot(host)
  }
  root!.render(<Board theme={theme} only={only} />)
  return allComponents().length
}

export function hideSpecimen(): void {
  root?.unmount()
  host?.remove()
  root = null
  host = null
}
