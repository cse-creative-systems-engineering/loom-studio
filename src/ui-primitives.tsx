import React from 'react'
import { iconMarkup } from './render/icons'

/**
 * Shared Studio primitives.
 *
 * Extracted so the effects panel can reuse the same controls the property
 * inspector already uses, rather than growing a second look-alike switch that
 * would drift out of sync.
 */


/** A switch. `label` is its accessible name: without one a screen reader heard only "switch". */
export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? 'on' : ''}`}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
    </button>
  )
}

/** A tool's own drawing (toolbox, layers, inspector header, context menu). */
export function Glyph({ markup, size = 14 }: { markup: string; size?: number }) {
  return (
    <svg
      className="ico glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Compile-time constants from tool-icons.ts, never user input.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}

/** One icon from Loom's own set, for the chrome: the same family the output uses. A missing name throws. */
export function Ico({ name, size = 14 }: { name: string; size?: number }) {
  const markup = iconMarkup(name)
  if (!markup) throw new Error(`chrome icon missing from the set: ${name}`)
  return (
    <svg
      className="ico"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Compile-time constants from icons.ts, never user input.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}

/**
 * A section that folds: its heading is the button, its summary says what is
 * inside while folded (so a changed value is never hidden without a trace).
 */
export function Disclosure({
  title,
  summary = '',
  defaultOpen = false,
  children,
}: {
  title: string
  summary?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  const id = React.useId()
  return (
    <section className={`disclosure${open ? ' open' : ''}`}>
      <h3>
        <button type="button" className="disclosure-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <Ico name="chevron-right" size={12} />
          <span>{title}</span>
          {summary && <span className="disclosure-sum">{summary}</span>}
        </button>
      </h3>
      {open && <div id={id}>{children}</div>}
    </section>
  )
}
