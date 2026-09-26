/**
 * Preview-surface probe (renderer side).
 *
 * The preview is now a DETACHED window, not a docked column. These checks
 * assert the editor shell no longer reserves space for it, and that the
 * control to summon it exists.
 *
 * History: this file previously guarded a docked 300px column whose
 * absolutely-positioned 720px artboard overlapped the design canvas. That
 * column is gone, so the check is INVERTED rather than deleted — the shell
 * must have exactly three columns and no preview panel.
 */

interface Check {
  name: string
  pass: boolean
  detail: string
}

export function layoutProbe(): Check[] {
  const out: Check[] = []

  const shell = document.querySelector<HTMLElement>('.body')
  out.push({
    name: 'editor shell exists',
    pass: Boolean(shell),
    detail: shell ? getComputedStyle(shell).gridTemplateColumns : 'not found',
  })

  if (shell) {
    const cols = getComputedStyle(shell).gridTemplateColumns.split(' ').filter(Boolean)
    out.push({
      name: 'shell is a 3-column grid (no preview column)',
      pass: cols.length === 3,
      detail: `${cols.length} columns: ${cols.join(' ')}`,
    })
    out.push({
      name: 'no docked preview panel in the shell',
      pass: document.querySelectorAll('.body .preview, .body .preview-peek').length === 0,
      detail: `found ${document.querySelectorAll('.body .preview').length}`,
    })
  }

  // The canvas must get real width now that the column is gone.
  const canvas = document.querySelector<HTMLElement>('.canvas-wrap')
  const inspector = document.querySelector<HTMLElement>('.inspector')
  if (canvas && inspector) {
    const c = canvas.getBoundingClientRect()
    const i = inspector.getBoundingClientRect()
    out.push({
      name: 'canvas and inspector do not overlap',
      pass: c.right <= i.left + 1,
      detail: `canvas.right=${Math.round(c.right)} inspector.left=${Math.round(i.left)}`,
    })
  }

  // The toggle must exist so the user can summon the window on demand.
  const toggle = document.querySelector<HTMLElement>('.pv-toggle')
  out.push({
    name: 'preview toggle is present in the status bar',
    pass: Boolean(toggle),
    detail: toggle ? (toggle.textContent ?? '').trim() : 'missing',
  })

  return out
}
