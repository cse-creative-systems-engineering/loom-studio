/**
 * The editor's player for a look's click effects (▶ Play in the Appearance
 * panel). The canvas does not run the behaviour runtime (a canvas click
 * selects), so this draws the SAME layers the runtime draws in Preview and
 * the export: the same attributes, styled by the same behaviour stylesheet.
 * Kept in step with `playClick` in behaviour.ts by selftest §119; the runtime
 * cannot import it, because it ships as its own source text.
 */
export function playClickEffect(el: HTMLElement): void {
  const kinds = (el.getAttribute('data-loom-click') ?? '').split(/\s+/).filter(Boolean)
  const tint = el.getAttribute('data-loom-click-color')
  const px = el.offsetWidth / 2
  const py = el.offsetHeight / 2
  for (const kind of kinds) {
    if (kind === 'sink') {
      try {
        el.animate([{ scale: '1' }, { scale: '0.95' }, { scale: '1' }], { duration: 280, easing: 'cubic-bezier(.3,0,.1,1)' })
      } catch {
        // No Web Animations: the other effects still play.
      }
      continue
    }
    const w = document.createElement('span')
    w.setAttribute('data-loom-fxwrap', '')
    w.setAttribute('aria-hidden', 'true')
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
    const fx = document.createElement('span')
    if (kind === 'ripple') {
      const size = Math.hypot(Math.max(px, el.offsetWidth - px), Math.max(py, el.offsetHeight - py)) * 2
      fx.setAttribute('data-loom-ripple', '')
      fx.style.cssText = `width:${size}px;height:${size}px;left:${px - size / 2}px;top:${py - size / 2}px;background:${tint || 'currentColor'}`
    } else if (kind === 'sweep') {
      fx.setAttribute('data-loom-sweep', '')
      fx.style.background = `linear-gradient(90deg,transparent,${tint || 'rgba(255,255,255,0.55)'},transparent)`
    } else if (kind === 'pulse') {
      fx.setAttribute('data-loom-pulse', '')
      if (tint) fx.style.setProperty('--loom-pulse', tint)
      w.style.overflow = 'visible'
    } else continue
    w.appendChild(fx)
    el.appendChild(w)
    const done = (): void => w.remove()
    fx.addEventListener('animationend', done, { once: true })
    setTimeout(done, 1200)
  }
}
