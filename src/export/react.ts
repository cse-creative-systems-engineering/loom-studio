/**
 * React emitter (web target, cutting-edge output).
 *
 * Emits ONE self-contained `.jsx` module: a default-exported function
 * component with inline styles plus the resolved theme as a `THEME` const
 * for hand-editing. No UI framework beyond React itself, no Tailwind, no
 * build plugin — it renders anywhere React renders.
 *
 * Single source of truth, same as the HTML emitter: the JSX is converted
 * from `renderToStaticMarkup` of the SAME preview renderer, so all 111
 * components are covered by construction, fail-fast is inherited (unknown
 * types / missing nodes throw), and escaping is handled before conversion.
 * The converter is deliberately dumb and total: quoted style keys/values,
 * expression-wrapped unsafe text, self-closed voids. Readability yields to
 * correctness wherever they conflict.
 *
 * Runs in the renderer (needs DOMParser). Pure and deterministic.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { renderNode } from '../render/web'
import { behaviourCss, behaviourInstaller } from '../render/behaviour'
import { documentCss } from '../render/document-css'
import { resolveTheme } from '../render/theme'
import { exportAuroraMarkup, exportPageCss } from './page'
import type { Document } from '../model/types'

/** `My App / v2.0!` -> `my-app-v2-0.jsx`. Mirrors `persist.filenameFor`. */
export function reactFilenameFor(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'untitled'}.jsx`
}

/** Raw JSX text iff it cannot parse as anything but text. */
function isSafeText(text: string): boolean {
  if (text.length === 0 || text.length > 500) return false
  if (/^\s|\s$/.test(text)) return false
  return /^[A-Za-z0-9 .,;:'"?!()\-–—%/]+$/.test(text)
}

/** HTML's lowercase attribute names that React spells differently. */
const REACT_ATTR: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  maxlength: 'maxLength',
  minlength: 'minLength',
  inputmode: 'inputMode',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  autocomplete: 'autoComplete',
  autofocus: 'autoFocus',
  readonly: 'readOnly',
  enterkeyhint: 'enterKeyHint',
  spellcheck: 'spellCheck',
  crossorigin: 'crossOrigin',
  srcset: 'srcSet',
}

/**
 * Attributes whose PRESENCE is the value. Written as `disabled=""` they
 * would pass an empty string, which React reads as false: a disabled
 * control would come back enabled.
 */
const BOOLEAN_ATTR = new Set(['disabled', 'multiple', 'required', 'readonly', 'autofocus', 'hidden', 'inert', 'open', 'novalidate', 'formnovalidate', 'default', 'reversed'])

function attrName(raw: string): string {
  if (REACT_ATTR[raw]) return REACT_ATTR[raw]
  if (raw.startsWith('data-') || raw.startsWith('aria-')) return raw
  return raw.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

function styleObject(style: string): string {
  const entries: Array<[string, string]> = []
  for (const decl of style.split(';')) {
    const colon = decl.indexOf(':')
    if (colon < 0) continue
    const key = decl.slice(0, colon).trim()
    const value = decl.slice(colon + 1).trim()
    if (!key || value === '') continue
    // A custom property keeps its name exactly: camel-cased, `--loom-accent`
    // became `-LoomAccent` and every state colour silently fell back.
    const camel = key.startsWith('--') ? key : key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    entries.push([camel, value])
  }
  if (entries.length === 0) return ''
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}`
}

function emitJsx(node: ChildNode, indent: number, lines: string[]): void {
  const pad = '  '.repeat(indent)
  if (node.nodeType === 3) {
    const text = node.textContent ?? ''
    if (text === '') return
    lines.push(isSafeText(text) ? `${pad}${text}` : `${pad}{${JSON.stringify(text)}}`)
    return
  }
  if (node.nodeType !== 1) return
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  const attrs: string[] = []
  // A form control's initial state is `default*` in React: `value` /
  // `checked` would make it controlled with no handler, i.e. read-only.
  const formField = tag === 'input' || tag === 'select' || tag === 'textarea'
  for (const name of el.getAttributeNames()) {
    const value = el.getAttribute(name) ?? ''
    if (name === 'style') {
      const obj = styleObject(value)
      // An object literal inside the expression braces: `style={{...}}`.
      if (obj !== '') attrs.push(`style={${obj}}`)
      continue
    }
    if (name === 'selected' && tag === 'option') continue // the <select> carries it (below)
    if (name === 'checked' && tag === 'input') { attrs.push('defaultChecked={true}'); continue }
    if (name === 'value' && formField) { attrs.push(`defaultValue=${JSON.stringify(value)}`); continue }
    if (BOOLEAN_ATTR.has(name)) { attrs.push(`${attrName(name)}={true}`); continue }
    attrs.push(`${attrName(name)}=${JSON.stringify(value)}`)
  }
  if (tag === 'select') {
    const chosen = Array.from(el.querySelectorAll('option')).filter((o) => o.hasAttribute('selected')).map((o) => o.getAttribute('value') ?? o.textContent ?? '')
    if (chosen.length > 0) attrs.push(`defaultValue={${JSON.stringify(el.hasAttribute('multiple') ? chosen : chosen[0])}}`)
  }
  // A textarea's text is its initial value, not children, in React.
  if (tag === 'textarea') {
    const text = el.textContent ?? ''
    if (text !== '') attrs.push(`defaultValue=${JSON.stringify(text)}`)
    lines.push(`${pad}<textarea${attrs.length > 0 ? ' ' + attrs.join(' ') : ''} />`)
    return
  }
  const open = attrs.length > 0 ? `<${tag} ${attrs.join(' ')}` : `<${tag}`
  const kids = Array.from(el.childNodes)
  if (kids.length === 0) {
    lines.push(`${pad}${open} />`)
    return
  }
  lines.push(`${pad}${open}>`)
  for (const k of kids) emitJsx(k, indent + 1, lines)
  lines.push(`${pad}</${tag}>`)
}

/**
 * Render `doc` to a self-contained React module.
 * Throws on unknown components / missing nodes (fail-fast, via the
 * renderer) rather than emitting a silent generic div.
 */
export function emitReact(doc: Document): string {
  const theme = resolveTheme(doc.meta.theme)
  // An empty workspace exports a valid component with no children rather than
  // throwing: "I have not drawn anything yet" is a real document state.
  const html =
    doc.root === null
      ? ''
      : renderToStaticMarkup(renderNode({ doc, selected: new Set(), mode: 'preview', theme }, doc.root))
  // The page under the design travels with it, exactly as in the HTML export
  // (export/page.ts): the aurora is drawn after the design, in the wrapper.
  const parsed = new DOMParser().parseFromString(`<div data-loom-root>${html}${exportAuroraMarkup(doc, theme)}</div>`, 'text/html')
  const holder = parsed.querySelector('[data-loom-root]')
  if (!holder) throw new Error('export failed: empty document body')
  const lines: string[] = []
  holder.childNodes.forEach((n) => emitJsx(n, 2, lines))
  const count = doc.root === null ? 0 : Object.keys(doc.nodes).length - 1
  // The behaviour layer ships INSIDE the component: the same runtime and the
  // same state CSS the editor preview runs, installed on mount against this
  // component's own root. Self-contained, no globals beyond the document, and
  // no UI framework — which is the whole promise of the React export.
  return `// ${(doc.meta.name || 'Untitled').replace(/\n/g, ' ')} — exported from Loom
// ${count} element${count === 1 ? '' : 's'} · theme: ${theme.name} · standalone React (no UI framework required)
import React from 'react';

const THEME = ${JSON.stringify(theme, null, 2)};

// The page this component draws on: its typeface (embedded, so it reads the
// same on every machine), its fill and the aurora's motion, all scoped to this
// component's own wrapper so it never restyles the page it is placed in.
const PAGE_CSS = ${JSON.stringify(exportPageCss(doc, theme, 'component'))};
const BEHAVIOUR_CSS = ${JSON.stringify(behaviourCss())};
const DOCUMENT_CSS = ${JSON.stringify(documentCss(doc, theme))};
const installBehaviour = ${behaviourInstaller()};

void THEME;

export default function LoomExport() {
  const root = React.useRef(null);
  React.useEffect(() => {
    const style = document.createElement('style');
    style.textContent = PAGE_CSS + BEHAVIOUR_CSS + DOCUMENT_CSS;
    document.head.appendChild(style);
    // Called directly: the payload travels as source, so it works under a
    // strict content-security-policy that forbids eval.
    installBehaviour();
    return () => { style.remove(); };
  }, []);
  return (
    <div ref={root} className="loom-export loom-container">
${lines.join('\n')}
    </div>
  );
}
`
}
