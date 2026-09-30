/**
 * Measures the audit scene's export, tool by tool. Run in a harness tab:
 *   const p = await import('/docs/reviews/output-quality/probe.ts')
 *   p.appearance()      // layout, text, contrast, targets, native controls, fonts
 *   await p.behaviour() // does each tool respond when operated?
 *   p.focus()           // does keyboard focus show?
 *
 * Every finding names the tool and the element, so a report line can be
 * traced back to a box on screen.
 */

type Finding = { tool: string; kind: string; detail: string }

const doc = () => (window as unknown as { __auditDoc: { nodes: Record<string, { type: string; children: string[]; flow: boolean }> } }).__auditDoc
const placed = () => (window as unknown as { __auditPlaced: Record<string, string> }).__auditPlaced
const nodeEl = (id: string) => document.querySelector<HTMLElement>(`[data-loom-node="${CSS.escape(id)}"]`)

function rgba(c: string): [number, number, number, number] | null {
  const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/.exec(c)
  return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null
}
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
/** Composite the backgrounds from the page up to `el` (alpha-aware). */
function behind(el: Element): number[] {
  const stack: number[][] = []
  for (let e: Element | null = el; e; e = e.parentElement) {
    const c = rgba(getComputedStyle(e).backgroundColor)
    if (c && c[3] > 0) stack.push(c)
    if (c && c[3] >= 1) break
  }
  // No page background chosen: the browser's canvas (white) shows through.
  let out = [255, 255, 255]
  const page = rgba(getComputedStyle(document.body).backgroundColor)
  if (page && page[3] >= 1) out = page.slice(0, 3)
  for (const c of stack.reverse()) out = out.map((v, i) => v * (1 - c[3]) + c[i] * c[3])
  return out
}
const ratio = (a: number[], b: number[]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The elements a tool drew itself (not those of a nested tool). */
function own(root: HTMLElement): HTMLElement[] {
  return [root, ...root.querySelectorAll<HTMLElement>('*')].filter((x) => x === root || x.closest('[data-loom-node]') === root)
}

const visible = (e: Element) => {
  const r = e.getBoundingClientRect()
  const s = getComputedStyle(e)
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01
}

export function appearance(): { findings: Finding[]; page: Record<string, unknown> } {
  const findings: Finding[] = []
  const add = (tool: string, kind: string, detail: string) => findings.push({ tool, kind, detail })
  const d = doc()
  const parentOf = new Map<string, string>()
  for (const [id, n] of Object.entries(d.nodes)) for (const c of n.children) parentOf.set(c, id)
  const themeFont = getComputedStyle(document.querySelector('.loom-export')!).fontFamily

  for (const [tool, id] of Object.entries(placed())) {
    const root = nodeEl(id)
    if (!root) { add(tool, 'missing', 'no element carries its node hook'); continue }
    const r = root.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) add(tool, 'zero-size', `drawn ${Math.round(r.width)}x${Math.round(r.height)}`)

    // Beyond its parent tool.
    const pe = parentOf.get(id) && nodeEl(parentOf.get(id)!)
    if (pe) {
      const pr = pe.getBoundingClientRect()
      const out = Math.max(pr.left - r.left, r.right - pr.right, pr.top - r.top, r.bottom - pr.bottom)
      if (out > 2) add(tool, 'overflows-parent', `${Math.round(out)}px outside its section`)
    }

    const mine = own(root).filter(visible)
    for (const e of mine) {
      const s = getComputedStyle(e)
      const text = [...e.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent!.trim()).join(' ').trim()
      // Text cut off by its own box.
      if (text && (s.overflowX !== 'visible' || s.textOverflow === 'ellipsis') && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 2))
        add(tool, 'clipped-text', `"${text.slice(0, 30)}" needs ${e.scrollWidth}x${e.scrollHeight}, has ${e.clientWidth}x${e.clientHeight}`)
      // Contrast of every run of text the tool draws.
      if (text && e.tagName !== 'OPTION') {
        const fg = rgba(s.color)
        if (fg) {
          const bg = behind(e)
          const blended = fg.slice(0, 3).map((v, i) => v * fg[3] * Number(s.opacity) + bg[i] * (1 - fg[3] * Number(s.opacity)))
          const cr = ratio(blended, bg)
          const size = parseFloat(s.fontSize)
          const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700)
          if (cr < (large ? 3 : 4.5)) add(tool, 'low-contrast', `"${text.slice(0, 24)}" ${cr.toFixed(2)}:1 at ${size}px (needs ${large ? 3 : 4.5})`)
        }
        if (s.fontFamily !== themeFont && !/mono/i.test(s.fontFamily) && !['CODE', 'KBD', 'PRE'].includes(e.tagName))
          add(tool, 'font', `"${text.slice(0, 20)}" in ${s.fontFamily.slice(0, 40)} (theme: ${themeFont.slice(0, 40)})`)
        if (parseFloat(s.fontSize) < 11) add(tool, 'tiny-text', `"${text.slice(0, 24)}" at ${s.fontSize}`)
      }
      // Controls that look like the operating system drew them.
      if (/^(INPUT|SELECT|TEXTAREA|BUTTON|PROGRESS|METER)$/.test(e.tagName) && s.appearance !== 'none' && (e as HTMLInputElement).type !== 'hidden')
        add(tool, 'native-look', `<${e.tagName.toLowerCase()}${(e as HTMLInputElement).type ? ` type=${(e as HTMLInputElement).type}` : ''}> keeps appearance:${s.appearance}`)
      // Targets too small to hit (WCAG 2.2 AA: 24x24).
      const interactive = e.matches('button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=switch],[role=checkbox],[role=radio],[role=menuitem],[tabindex="0"],summary')
      if (interactive) {
        const b = e.getBoundingClientRect()
        if (b.width < 24 || b.height < 24) add(tool, 'small-target', `<${e.tagName.toLowerCase()}> "${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 20)}" is ${Math.round(b.width)}x${Math.round(b.height)}`)
        if (!(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.textContent ?? '').trim() || (e as HTMLInputElement).labels?.length || e.getAttribute('title') || (e as HTMLInputElement).placeholder))
          add(tool, 'no-name', `<${e.tagName.toLowerCase()}> has no accessible name`)
      }
    }
    // Text overlapping text from a different element inside the tool.
    const runs = mine.filter((e) => [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim())).map((e) => ({ e, b: e.getBoundingClientRect() }))
    for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i], b = runs[j]
      if (a.e.contains(b.e) || b.e.contains(a.e)) continue
      const w = Math.min(a.b.right, b.b.right) - Math.max(a.b.left, b.b.left)
      const h = Math.min(a.b.bottom, b.b.bottom) - Math.max(a.b.top, b.b.top)
      if (w > 3 && h > 3) { add(tool, 'text-collision', `"${a.e.textContent!.trim().slice(0, 16)}" overlaps "${b.e.textContent!.trim().slice(0, 16)}"`); break }
    }
    // A child tool sitting on the container's own text (title, legend, label).
    for (const kid of d.nodes[id].children) {
      const ke = nodeEl(kid)
      if (!ke) continue
      const kb = ke.getBoundingClientRect()
      const chrome = runs.find(({ b }) => Math.min(b.right, kb.right) - Math.max(b.left, kb.left) > 3 && Math.min(b.bottom, kb.bottom) - Math.max(b.top, kb.top) > 3)
      if (chrome) add(tool, 'child-over-chrome', `its child ${d.nodes[kid].type} covers its own "${chrome.e.textContent!.trim().slice(0, 16)}"`)
    }
  }
  const html = document.documentElement
  return { findings, page: { scrollWidth: html.scrollWidth, clientWidth: html.clientWidth, horizontalScroll: html.scrollWidth > html.clientWidth, themeFont } }
}

/** Operate each tool the way a person would and watch whether anything changes. */
export async function behaviour(): Promise<Array<{ tool: string; target: string; changed: boolean; what: string }>> {
  const out: Array<{ tool: string; target: string; changed: boolean; what: string }> = []
  // Operating a Link must not leave the page (its default href is external).
  document.addEventListener('click', (e) => { if ((e.target as Element).closest?.('a[href]')) e.preventDefault() }, true)
  document.addEventListener('submit', (e) => e.preventDefault(), true)
  const selector = 'button,a,[data-loom-b],[role=tab],[role=switch],[role=checkbox],[role=radio],[role=menuitem],[role=option],summary,input,select,textarea,[tabindex="0"]'
  for (const [tool, id] of Object.entries(placed())) {
    const root = nodeEl(id)
    if (!root) continue
    const target = own(root).find((e) => e.matches(selector) && visible(e) && !(e as HTMLButtonElement).disabled)
    if (!target) { out.push({ tool, target: '(none)', changed: false, what: 'nothing operable' }); continue }
    const records: string[] = []
    const mo = new MutationObserver((ms) => { for (const m of ms) records.push(m.type === 'attributes' ? `@${m.attributeName}` : m.type) })
    mo.observe(root, { attributes: true, subtree: true, childList: true, characterData: true })
    const before = (target as HTMLInputElement).value
    const opts = { bubbles: true, cancelable: true, view: window }
    target.dispatchEvent(new PointerEvent('pointerdown', opts))
    target.dispatchEvent(new MouseEvent('mousedown', opts))
    target.dispatchEvent(new PointerEvent('pointerup', opts))
    target.dispatchEvent(new MouseEvent('mouseup', opts))
    target.click()
    if (/^(INPUT|TEXTAREA)$/.test(target.tagName) && !/checkbox|radio|range|file|color|date|time/.test((target as HTMLInputElement).type)) {
      (target as HTMLInputElement).focus()
      document.execCommand('insertText', false, 'x')
    }
    await new Promise((r) => setTimeout(r, 120))
    mo.disconnect()
    const valueChanged = (target as HTMLInputElement).value !== before
    const what = [...new Set(records)].filter((x) => x !== '@style' || records.length > 0).join(' ')
    out.push({ tool, target: `<${target.tagName.toLowerCase()}${target.getAttribute('data-loom-b') ? ` ${target.getAttribute('data-loom-b')}` : ''}> ${(target.textContent ?? '').trim().slice(0, 16)}`, changed: records.length > 0 || valueChanged || document.activeElement === target, what: what + (valueChanged ? ' value' : '') + (document.activeElement === target ? ' focus' : '') })
    // Put overlays back, so the next tool is not operated through a scrim.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }
  return out
}

/** Keyboard focus: tab to each focusable element and check it is visibly marked. */
export function focus(): Finding[] {
  const findings: Finding[] = []
  for (const [tool, id] of Object.entries(placed())) {
    const root = nodeEl(id)
    if (!root) continue
    const focusable = own(root).filter((e) => e.matches('button,a[href],input:not([type=hidden]),select,textarea,[tabindex="0"],summary') && visible(e) && !(e as HTMLButtonElement).disabled)
    for (const e of focusable.slice(0, 2)) {
      const look = (x: Element) => { const s = getComputedStyle(x); return `${s.outlineStyle} ${s.outlineWidth} ${s.boxShadow} ${s.borderColor} ${s.backgroundColor}` }
      const host = e.parentElement ?? e
      const before = look(e) + look(host)
      e.focus({ focusVisible: true } as FocusOptions)
      const after = look(e) + look(host)
      if (document.activeElement === e && before === after) findings.push({ tool, kind: 'no-focus-ring', detail: `<${e.tagName.toLowerCase()}> "${(e.textContent ?? e.getAttribute('aria-label') ?? '').trim().slice(0, 16)}" looks the same focused` })
      e.blur()
    }
  }
  return findings
}
