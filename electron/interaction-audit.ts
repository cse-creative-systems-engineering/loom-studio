/**
 * The interaction audit: does everything that looks operable DO something?
 *
 * Standing rule 8 (ROADMAP.md): whatever a UI alone can do, a Loom UI does;
 * what needs a backend reacts and hands off a named event. So, mechanically:
 *
 *   Drop every toolbox tool the way the toolbox does (with its seeded
 *   children), render its OUTPUT into a live document with the real behaviour
 *   runtime, and operate every operable element it drew. Each one must change
 *   something (an attribute, the tree, text) other than the transient press
 *   flash, or emit a named `loom:*` event a host can act on. One that does
 *   neither looks clickable and does nothing: a finding.
 *
 * Native fields (text, number, date, colour, range, file, select) operate on
 * their own value, which is exactly their job, and are not operated here.
 * A link with a real href navigates, which is its job; one with an empty or
 * "#" href is operated like a button.
 *
 * Findings are keyed `Tool|<tag role label>` so a backlog entry names one
 * control, not one render of it. The twin of the property audit.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { EditorStore, emptyDocument } from '../src/state/store'
import { renderNode } from '../src/render/web'
import { addedTypes, allComponents } from '../src/model/registry'
import '../src/model/toolbox'

export interface DeadControl {
  tool: string
  what: string
  /** 'inert': operating it changed nothing; 'mouse-only': Tab cannot reach it. */
  why: 'inert' | 'mouse-only'
}

const OPERABLE = [
  'button',
  'a[href]',
  '[role=button]',
  '[role=tab]',
  '[role=menuitem]',
  '[role=slider]',
  '[role=switch]',
  '[role=checkbox]',
  '[role=radio]',
  '[role=option]',
  'input[type=checkbox]',
  'input[type=radio]',
  '[data-loom-b]:not([data-loom-b=panel])',
].join(',')

const NATIVE_FIELD = /^(INPUT|SELECT|TEXTAREA)$/

function describe(el: Element): string {
  const role = el.getAttribute('role') ?? el.getAttribute('data-loom-b') ?? ''
  const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24)
  return `${el.tagName.toLowerCase()}${role ? ` ${role}` : ''}${label ? ` "${label}"` : ''}`
}

/**
 * `opts.only` limits the tools; `opts.tamper` edits a tool's rendered output
 * before it is operated — for the test that proves the audit bites.
 */
export function auditInteractions(opts: { only?: string[]; tamper?: (tool: Element, name: string) => void } = {}): { tools: number; operated: number; dead: DeadControl[] } {
  const dead: DeadControl[] = []
  let operated = 0
  const added = addedTypes()
  const tools = allComponents().filter((c) => !added.has(c.name) && (!opts.only || opts.only.includes(c.name)))
  // Record every loom:* event, whatever it is called.
  const heard: string[] = []
  const original = EventTarget.prototype.dispatchEvent
  EventTarget.prototype.dispatchEvent = function (ev: Event) {
    if (ev.type.startsWith('loom:')) heard.push(ev.type)
    return original.call(this, ev)
  }
  // Links must not navigate the test window.
  const noNav = (e: Event) => {
    if ((e.target as Element | null)?.closest?.('a[href]')) e.preventDefault()
  }
  document.addEventListener('click', noNav, true)
  try {
    for (const spec of tools) {
      const st = new EditorStore(emptyDocument())
      const root = st.dropComponent('Panel', null, 0, 0)!
      st.commit({ op: 'setFlow', id: root, flow: true }, 'flow')
      const id = st.dropComponent(spec.name, root, 0, 0)
      if (!id) continue
      const host = document.createElement('div')
      host.className = 'loom-container'
      host.style.cssText = 'position:absolute;left:-20000px;top:0;width:1280px'
      host.innerHTML = renderToStaticMarkup(renderNode({ doc: st.doc, selected: new Set(), mode: 'preview', hookAll: true }, root))
      document.body.appendChild(host)
      try {
        const tool = host.querySelector(`[data-loom-node="${CSS.escape(id)}"]`)
        if (!tool) continue
        opts.tamper?.(tool, spec.name)
        const controls = [...(tool.matches(OPERABLE) ? [tool] : []), ...tool.querySelectorAll(OPERABLE)]
        const seen = new Set<string>()
        for (const el of controls) {
          if (!(el instanceof HTMLElement)) continue
          if (NATIVE_FIELD.test(el.tagName) && !/^(checkbox|radio)$/.test((el as HTMLInputElement).type)) continue
          if (el.matches(':disabled') || el.closest('[aria-disabled="true"]') || el.closest('[inert]')) continue
          if (el.matches('a[href]') && !/^#?$/.test(el.getAttribute('href') ?? '')) continue
          // One label per control kind is enough: the fifth identical star is the first one again.
          const what = describe(el)
          if (seen.has(what)) continue
          seen.add(what)
          // The current choice (the selected radio, tab or step): choosing it
          // again is rightly a no-op. Its siblings are operated instead.
          const input = el as HTMLInputElement
          if ((input.type === 'radio' && input.checked) || el.matches('[aria-selected="true"],[aria-current]:not([aria-current="false"]),[data-loom-active="1"],[data-loom-b=radio][data-loom-on="1"]') || !!el.querySelector('input[type=radio]:checked')) continue
          // Hidden now (a closed menu's items): it is reached by opening its owner, audited there.
          if (el.getClientRects().length === 0) continue
          // Reachable by keyboard: a native control is; anything else needs a
          // tab stop (the runtime gives every one Enter/Space).
          const handle = [...el.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,[tabindex]')].some((h) => h.tabIndex >= 0)
          if (!/^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY|LABEL)$/.test(el.tagName) && el.tabIndex < 0 && !handle) dead.push({ tool: spec.name, what, why: 'mouse-only' })
          // Handlers run synchronously on click, so the records are complete
          // straight after it; the press flash and inline style churn are not
          // "doing something".
          const mo = new MutationObserver(() => undefined)
          mo.observe(host, { attributes: true, childList: true, characterData: true, subtree: true })
          const before = heard.length
          const checked = (el as HTMLInputElement).checked
          el.click()
          const changes = mo.takeRecords().filter((r) => !(r.type === 'attributes' && (r.attributeName === 'data-loom-pressed' || r.attributeName === 'style')))
          mo.disconnect()
          operated++
          const didSomething = changes.length > 0 || heard.length > before || (el as HTMLInputElement).checked !== checked
          if (!didSomething) dead.push({ tool: spec.name, what, why: 'inert' })
          // Leave overlays and menus as they were for the next control.
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        }
      } finally {
        host.remove()
      }
    }
  } finally {
    EventTarget.prototype.dispatchEvent = original
    document.removeEventListener('click', noNav, true)
  }
  return { tools: tools.length, operated, dead }
}
