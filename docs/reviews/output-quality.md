# Loom — Adversarial Output-Quality Review

**Scope:** the DESIGNED ARTIFACT only — what a Loom user ships. Editor chrome and editor functionality are the sibling cards' lane. I read `src/render/web.tsx`, `src/model/toolbox.ts`, `src/model/registry.ts`, `src/demo.ts`, `src/ui.css`, and the store/ops/types. I rendered the seeded demo scene in a real Electron window and inspected the live DOM (computed styles, bounding boxes, store state) plus a real screenshot of the output panel.

**Method note / honesty:** the repo was being actively edited by sibling reviewers *during* this review. `web.tsx` gained an `isFlowChild` fix and resize handles, and `ui.css` gained chrome polish, a preview column, and a type-scale refactor while I was reading. I re-read the current files and re-probed the live DOM after the rebuild, so the findings below are against the current tree. The flow bug I originally located (every leaf forced to `position:absolute` → collapsed to `left:0,top:0` inside a flow panel) is **already fixed** — I verified leaves now render `static` and flow correctly. I do not re-litigate it. The visual capture is from the current build; the gauge/sparkline claims were confirmed by region-zoomed inspection of a real render, not inferred from CSS.

---

## Verdict

**Not shippable as "ultra-premium" — and the single biggest reason is that the output has no design system at all.** Every color, radius, font-size, and shadow is a hard-coded literal inside `web.tsx`'s `styleFor()` switch. There is no theme, no token layer, no type scale, no spacing scale, no elevation scale, and no motion. Two different authors will produce two visually unrelated apps, and one author cannot re-skin their app without editing every node. The components are also too few and too thin to assemble a real product. The *editor* is polished; the *output* is a competent dark admin-template with nicer colors — exactly the bar the user said is not enough.

The flow fix landed mid-review, so the output is now structurally sound (no collapsed leaves). What remains is a quality ceiling, not a correctness bug.

---

## Visual assessment (from a real capture)

The seeded "Telemetry Console" renders as a dark dashboard: a root glass panel (`rgba(22,26,38,0.62)` over `#10131c` → composites to ~`#141722`) holding a header, then a 3-column grid of glass cards, each with an uppercase 11px caption, a data viz, and a caption line. It is clean, aligned, and internally consistent — but it reads as **Shadcn/Tailwind dark-dashboard-template**, not a 2026 product. Concrete values that make it read that way:

- **Gauge arc is washed out at its start.** The progress arc uses `stroke="url(#g)"` where `#g` is a `linearGradient` with `x1=0 y1=0 x2=1 y2=1` — a **bounding-box** gradient, not a path-along gradient. The arc spans only the left 240° of the circle, so the gradient's full blue→purple range is compressed into that arc's bounding box. The left tail (start, ~7–8 o'clock) renders pale/desaturated and nearly vanishes against the track; the tip is vivid. The track itself is `rgba(255,255,255,0.10)` — near-invisible on the glass card. No tick marks, no scale, no min/max labels. A gauge with no scale is a decorative donut, not a data readout.
- **Sparkline is a bare 2px polyline.** `stroke={accent}` `strokeWidth={2}`, no area fill, no gradient, no gridlines, no end-point dot, no smoothing (`L` segments, so it's jagged). On a 250×76 canvas it reads as a thin scratch, not a trend. The `shader` prop (WebGL) is declared in the toolbox but **never referenced in the renderer** — the "WebGL-rendered" promise in its description is false.
- **Buttons are flat gradient pills.** `linear-gradient(180deg,#5b8cff,#3f6ae0)`, 10px radius, `font-weight:600`, 13px. The `glow` box-shadow `0 6px 24px -6px rgba(91,140,255,0.65)` is a soft blue bloom that reads fine on dark but will look like a cheap neon halo on any light surface. No hover, active, or focus state exists in the output (the `:hover`/`:active` rules in `ui.css` are editor-only, scoped to `.surface`).
- **Typography is ad-hoc.** Label sizes are `{xs:11, sm:13, md:15, lg:19, xl:26}` — a 2px/4px/7px ladder, not a scale. The demo's muted captions (`#6b7488` at 11px) measure **3.8:1 contrast** against the glass composite — below the 4.5:1 AA floor for small text. The `#8a94a8` card labels are 5.9:1 (pass). So the *least important* text is the least legible, and it fails WCAG.
- **`Panel.title` is dead.** The toolbox declares a `title` string prop on Panel, but `web.tsx` never renders it. A user who types a panel title sees nothing. This is a shipped default that silently does nothing.

---

## Component critique (per component)

- **Panel** — the workhorse, and the most complete. But `surface` defaults to `'glass'` with `glass:true`, and glass is `backdrop-filter: blur(18px) saturate(140%)` over `rgba(22,26,38,0.62)`. On a flat dark background there is nothing behind the panel to blur, so the default panel is just a translucent slab — the "glass" reads as a slightly-off solid. The `title` prop is dead (above). No elevation/shadow prop at all, so panels can't be layered to create depth.
- **Stack** — fine, but `align` defaults to `stretch`, which is the least useful default for a stack (children stretch full-width). A stack of buttons/labels should default to `start`.
- **Grid** — `repeat(N, minmax(0,1fr))` is correct, but there's no `row-gap`/`column-gap` split and no `align-items`/`justify-items`. A designer reaches for those immediately.
- **Button** — the biggest gap is **no states**. No hover, active, focus, or disabled styling in the output (disabled only sets the HTML attribute; the browser default dimming is the only feedback). No icon slot, no loading state, no full-width option. The `glow` default is off (good) but the glow itself is a one-size blue bloom with no intensity control.
- **Label** — the type scale is ad-hoc (above). No `line-height` control, no `letter-spacing`, no `text-transform`, no `text-align`. A heading and a caption are the same component with different sizes — there's no semantic heading, so no hierarchy is enforced.
- **Input** — no label, no error state, no focus ring in the output (the `:focus-visible` ring in `ui.css` is editor-scoped). `value` is `defaultValue` with a no-op `onChange` — the field is not actually editable in the output. A text field that can't be typed into is not a shippable control.
- **Gauge** — the gradient bug above is the headline. Also: no tick marks, no min/max labels, no color-by-value (a gauge that can't turn red at 90% is half a gauge), and the value text is centered with no label. The `unit` renders as a tiny `<tspan>` that can collide with the number at small sizes.
- **Sparkline** — bare polyline (above). No area fill, no gradient, no last-point dot, no min/max reference, no smoothing. The `shader` prop is a lie.

---

## Design system gaps

- **No theme layer.** Colors, radii, fonts, and shadows are literals in `styleFor()`. There is no token, no CSS variable, no `data-theme`, no per-document palette. This is the single most consequential gap (see Theming verdict).
- **No type scale.** Six ad-hoc sizes (11/13/15/19/26 for labels; 13 for buttons; 12 for inputs). No ratio, no line-height system, no weight scale beyond `400–700`.
- **No spacing scale.** `gap`/`padding` are free numbers (0–96). Two authors will pick 8, 10, 12, 16, 20, 24, 28 arbitrarily and produce inconsistent rhythm. The demo itself uses 10/12/18/20/28 — five different values in one screen.
- **No color roles.** Text colors are raw hex per node (`#e6e9ef`, `#8a94a8`, `#6b7488`). There's no "text-primary / text-secondary / text-muted / accent / danger" semantic layer, so a theme change can't re-map them.
- **No elevation scale.** Panels have no shadow prop; the only shadow in the output is the button glow. No way to express "this card floats above that one."
- **No motion.** Zero transitions/animations in the output. Premium 2026 UI has micro-interactions; this output is static.
- **No state system.** No hover/active/focus/disabled/error/loading anywhere in the output.

---

## Missing components (prioritized)

1. **Form field (label + input + error + hint)** — the single most-reached-for control in any real app. Today a user must hand-assemble a Label + Input + another Label and there's no error styling at all. This is the #1 gap.
2. **Navigation / Tabs** — every multi-view app needs a way to switch views. Nothing exists.
3. **Modal / Dialog** — no overlay, no focus trap, no dismiss. Unbuildable today.
4. **Table / DataGrid** — the demo is a telemetry dashboard; a dashboard without a table is a toy. No row/column model exists.
5. **Avatar** — identity is everywhere (settings, chat, team). Missing.
6. **Toast / notification** — no transient message surface.
7. **Empty state** — no illustration/icon + title + body pattern.
8. **Skeleton loader** — no loading placeholder.
9. **Icon** — no icon component at all; buttons/labels can't carry an icon.

A designer assembling a real product reaches for Form field, Tabs, Modal, and Table before Gauge and Sparkline. The current 8-component set is a *spike* toolbox (the file's own comment says so: "This is a spike toolbox, not a shipped catalogue") — but the user's bar is a shipped product, so the spike is the product today.

---

## Theming verdict

**No — the design system cannot be changed centrally today.** There is no theme object, no token map, no CSS-variable indirection in the output. Every value is a literal in `web.tsx`. To re-skin an app a user must select each node and edit its color/radius/font individually — and because colors are stored as per-node props, there's no way to express "all primary buttons are this blue."

**Cost to add:** moderate, and the architecture is already 80% of the way there. The registry's `defineComponent` is the natural home for a `theme` block (or a separate `theme.ts` with token roles: `color.primary`, `color.text.muted`, `radius.md`, `space.3`, `type.body`). `styleFor()` would resolve tokens instead of literals. The document model would need a `theme` field (or a theme reference) so the choice persists per-document. The hard part is the **migration**: existing per-node color props (`Label.color`, `Sparkline.accent`, `Button` variants) are already stored as concrete values, so a theme change must decide whether it overrides or is overridden by node-level props. That's a real design decision, not a mechanical refactor — but it's the difference between "premium" and "template."

---

## Desktop-target risks

The renderer-neutral model is sound in principle, but the current output is DOM/CSS-shaped and will degrade on a native widget tree:

- **`backdrop-filter: blur(18px) saturate(140%)`** (Panel glass) has no native GTK/Qt equivalent. It's gated behind `css-backdrop-filter` (correctly flagged web-only), but the *default* Panel surface is glass — so the default component is non-portable. The desktop target's default should be `solid`.
- **`box-shadow` glow** (`0 6px 24px -6px rgba(91,140,255,0.65)`) — native widgets have no drop-shadow-glow idiom; it becomes a flat border or nothing.
- **CSS gradients** (button `linear-gradient(180deg,#5b8cff,#3f6ae0)`, Panel `linear-gradient(140deg,…)`) — GTK/Qt can approximate with a vertical gradient but not a diagonal one; the diagonal Panel gradient will flatten.
- **`font-weight: 600/650`** — GTK/Qt use named weights (Regular/Medium/Bold); 600 and 650 map inconsistently across themes and may render as Regular.
- **`border-radius: 10px` on buttons** — native buttons have theme-defined radii; forcing 10px fights the desktop theme.
- **The Gauge/Sparkline** are SVG/canvas — the desktop target lists `native-canvas` as a capability, so these *can* survive, but a native gauge would be a custom-drawn widget, not a styled control, and the gradient bug would carry over.
- **The `data-loom-*` styling hooks** in `ui.css` are web-only; the desktop backend has no equivalent styling surface, so any polish that lives in CSS (hover outlines, selection) has no native analog.

The honest summary: the model is renderer-neutral, but the *defaults and the styling idioms* are web-first. Shipping the desktop target today would produce a tolerable, flat, theme-fighting approximation — not a good native app.

---

## Findings summary (the 10–20)

1. **No design system / theme layer** — every value is a literal in `styleFor()`. Biggest single gap.
2. **Gauge gradient is bounding-box, not path-along** — left tail washes out; verified in the render.
3. **Gauge has no scale** — no ticks, no min/max labels; a decorative donut, not a readout.
4. **Gauge track is near-invisible** (`rgba(255,255,255,0.10)`).
5. **Sparkline is a bare 2px jagged polyline** — no area, no gradient, no end dot, no grid.
6. **`Sparkline.shader` is a lie** — declared, never rendered; description promises WebGL.
7. **`Panel.title` is dead** — declared, never rendered.
8. **Buttons have no states** — no hover/active/focus/disabled styling in the output.
9. **Input is not editable** — `defaultValue` + no-op `onChange`; no label/error/focus.
10. **Type scale is ad-hoc** — 11/13/15/19/26, no ratio, no line-height system.
11. **Demo muted captions fail WCAG** — `#6b7488` at 11px = 3.8:1 vs 4.5:1 AA.
12. **No spacing scale** — free numbers; the demo itself uses 5 different gaps on one screen.
13. **No color roles** — raw hex per node; no semantic text/accent layer.
14. **No elevation** — panels have no shadow prop; no depth.
15. **No motion** — zero transitions in the output.
16. **Missing components** — Form field, Tabs, Modal, Table, Avatar, Toast, Empty state, Skeleton, Icon (prioritized above).
17. **Default Panel surface is glass** — non-portable to desktop, and reads as a flat slab on flat backgrounds.
18. **Desktop target degrades** — backdrop-filter, glow, diagonal gradients, weight 600/650, forced radii have no native equivalent.
19. **`Stack.align` defaults to `stretch`** — least useful default for a stack.
20. **No semantic heading component** — hierarchy is not enforceable.

---

*Reviewer: adversarial output-quality lane. Editor chrome/functionality deliberately out of scope. Flow-positioning bug noted as already fixed by a sibling mid-review; not re-litigated.*
