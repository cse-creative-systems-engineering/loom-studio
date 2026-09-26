/**
 * Shared inspector primitives.
 *
 * Extracted so the effects panel can reuse the same controls the property
 * inspector already uses, rather than growing a second look-alike switch that
 * would drift out of sync.
 */


export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? 'on' : ''}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
    </button>
  )
}
