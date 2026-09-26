# Loom — Adversarial UI/UX Review

Reviewed against the bar: "cutting edge, high quality, ultra-premium." Evidence: full read of `src/ui.css`, `src/app.tsx`, `src/render/web.tsx`, plus rendered screenshot `docs/shots/loom-editor-raw.png` (1440px Electron capture; the prescribed `loom-editor.png` capture command hung on GPU-process exit, the raw PNG from the same snapshot pipeline was used instead — reviewed visually, not blind).

## Verdict

Not ultra-premium — competent-generic. Loom currently looks like a well-executed VS Code extension, not a flagship design tool. The single biggest thing holding it back: **the editor chrome and the designed output are visually identical, so the canvas never reads as a design surface.** The toolbox panels use the same `#141824` panels, same 10px radii, same accent blue, same 13px type as the Panels/Buttons the user is *building* (compare `ui.css:8` `--panel: #141824` with `web.tsx:55` Panel background `#161a26` and `web.tsx:85` primary button gradient vs `ui.css:107` target-tab gradient — same hue, same treatment). A premium tool makes the document unmistakably the subject and the chrome recede; here everything is one flat plane of dark-blue rectangles. Secondary: the interaction model is drag-to-move only, and there is no visible affordance that anything on the canvas can be manipulated.

## Findings (by severity)

1. **Canvas is not a design surface — it's a hosted copy of the app.**
   Where: `ui.css:232-243`, `web.tsx:27-135`, screenshot.
   The `.surface` is a 720px div with a 24px grid and a dashed border, and the designed root Panel is painted with the *same* panel treatment as the toolbox (`web.tsx:55` `#161a26` vs `ui.css:8`). No artboard frame, no canvas-vs-page elevation difference beyond `--shadow`, no difference in color temperature. The user cannot tell at a glance where the document ends and the tool begins.
   Fix: give the surface a deliberate artboard identity — slightly lighter/warmer background than chrome (e.g. `#12151d` on `#0b0d13`), a 1px solid inset border instead of dashed (`ui.css:241` dashed borders read as "empty dropzone placeholder", not "document"), and drop the Panel's own border/radius *while authoring on the root* so the root fills the artboard edge-to-edge.

2. **Zero manipulation affordances on canvas elements: no resize handles, no hover state, no cursor change.**
   Where: `web.tsx:150-164` (the only per-node decoration is a 1px selection outline), `app.tsx:183-227` (drag logic has no hover/pressed visuals), screenshot (selected root shows a thin blue outline and nothing else).
   Every premium design tool telegraphs "I am grabbable" via hover outline + move cursor + corner handles. Here an unselected element is pixel-identical to its rendered self, and the cursor stays default (`cursor: pointer` is even set on rendered *Buttons*, `web.tsx:96`, so hovering a designed button implies it's clickable when it's actually grabbable).
   Fix: on hover over a movable node, show a 1px `--accent` outline at 50% opacity and `cursor: move`; on selection show 8px square corner handles (4 is enough) with white fill / accent border. Suppress `cursor: pointer` on designed controls in designer mode.

3. **The "rulers" toggle does nothing.**
   Where: `app.tsx:181,234-236`, `ui.css:245` — `.canvas.rulers .surface { background-size: 24px 24px; }` is byte-identical to the non-ruler rule at `ui.css:240`. The button flips state text ("Rulers on") and nothing changes on screen.
   This is the worst kind of premium-killer: a control that lies. Either remove the toggle or render actual ruler strips (tick marks + px labels along the canvas top/left). Same class of problem: the demo button label changes but there's no density/spacing feedback anywhere.

4. **No resize interaction or affordance at all for fixed-size components.**
   Where: `app.tsx:183-227` (move-only drag state), `web.tsx:111-120` (Input has a hardcoded default `width: 200`), Gauge/Sparkline sized by props only. The task describes "repositions/resizes them" — resize exists nowhere in the interaction layer. Users can only resize by typing numbers in the inspector. This isn't a missing feature to excuse; it's a stated core interaction absent from the UI, and the canvas looks dead because of it.

5. **Inspector fields commit on every keystroke with no grouping restraint — the wall-of-inputs problem.**
   Where: `app.tsx:331` (`s.commit(...)` per `onChange` for strings/enums/colors), `ui.css:296-317` (uniform 10px field spacing, all inputs full-width, identical styling for every type).
   Typing a label like "Telemetry Console" fires N history-pushed commits (`app.tsx:331` uses `commit`, not `poke`+`seal` like the number fields do at `app.tsx:307-314`) — and visually, a Panel with 8 properties renders 8 indistinguishable full-width boxes. Figma groups x/y/w/h on one row and uses compact steppers; Loom's two-column grid (`ui.css:348`) is used only once (Position).
   Fix: strings/colors should `poke` on change and `seal('Set X')` on blur (same as NumField); lay paired numeric props (padding/gap/radius) in the existing `.row.two` grid; give enum `<select>` a custom chevron so it stops reading as a raw HTML control.

6. **Number inputs without steppers or scrubbable labels.**
   Where: `app.tsx:419-434`, `ui.css:350-352`. The `num-label` (X/Y/padding) is a dead `<span>`; the input is a bare `type=number` with native spinners suppressed by nothing (they render in Chromium as tiny arrows that look cheap) and no drag-to-scrub.
   Fix: hide native spinners (`-webkit-inner-spin-button { display:none }`), make labels scrubbable (pointerdown + horizontal drag = value change), add a 1px-step via arrow keys (already free) and document it. This one interaction is what makes an inspector feel like a design tool instead of a form.

7. **Color inputs are unusable for a design tool: `input[type=color]` full-width.**
   Where: `app.tsx:383-385`, `ui.css:323-330`. A 100%-width 28px native color well shows no hex, no alpha, no swatch history. Sparkline `accent` (`web.tsx:280`) and Label `color` (`web.tsx:106`) both route here. Premium editors show a compact swatch + hex field side by side.
   Fix: 22px swatch square + mono hex text input (`--mono` is already defined at `ui.css:21` and never used — telltale sign of unfinished polish).

8. **Status bar wastes its most valuable pixel column; gated-component warning is a dead-end.**
   Where: `app.tsx:463-475`, `ui.css:379-393`. "undo 4 · redo 2" and "last: Set radius" are history trivia nobody scans; meanwhile the one actionable item — "N components have web-only properties" (`app.ts:471`) — is plain text with no click target, no listing, no jump-to-component. Also `gate-badge` "web only" (`app.tsx:366`, `ui.css:334-343`) marks props as *excluded* for the current target but the field stays interactive — the user can edit a value the export will silently drop.
   Fix: make the warning a button that filters the toolbox to gated components / selects them; make gated fields `disabled` with tooltip listing the exact dropped keys (data already computed in `unsupportedProps`, `app.tsx:144`).

9. **Typography has no scale — everything is 11–13px with one weight jump.**
   Where: `ui.css` sizes: 10 (`h3`), 11, 11.5, 12, 12.5, 13. Weights: 550/600/650. Six sizes within 3px is not a scale, it's drift — e.g. `.tool-name` 12.5 (`ui.css:184`) vs `.chip` 11.5 (`ui.css:219`) vs `.hint` 11 (`ui.css:224`) in the same visual region. Premium tools commit to 3-4 sizes (10.5 caption / 12 body / 13 emphasis) and use weight+color for the rest.
   Fix: collapse to a tokenized scale (`--text-xs: 10.5px; --text-sm: 12px; --text-md: 13px;`) and delete the odd 11.5/12.5 values.

10. **Accent blue is used as paint, not as meaning.**
    Where: `ui.css:15` `--accent: #5b8cff` appears in: target tab active (`107`), search focus (`140`), tool icons (`178`), insp-icon (`275`), toggle-on (`371`), drag ghost (`403`), selection outline (`web.tsx:161`), designed primary Button (`web.tsx:85`), gauge gradient (`web.tsx:242`). When selection, focus, branding, decoration, and the user's own primary buttons are all the same blue, selection stops popping — the screenshot shows the selected root outline blending into the primary buttons inside it.
    Fix: reserve `--accent` strictly for *selection and focus in chrome*; give the designed document its own (user-configurable) theme so the editor's accent never collides with the artwork's accent. Even a slightly shifted selection color (e.g. `#ffb224` selection, blue for interactive chrome) would immediately separate subject from tool.

11. **The drag ghost is the only moment of delight, and it's unstyled for the drop.**
    Where: `app.tsx:98-126`, `ui.css:397-409`. The ghost follows the pointer (+12px offset) but nothing indicates a *valid* drop target — `elementFromPoint` silently no-ops off-surface (`app.tsx:112-113`). Premium drag-and-drop shows the surface brighten and an insertion indicator during drag.
    Fix: during drag, add a class to the surface (subtle accent wash on the dashed border, `ui.css:241`) and show a crosshair coordinate readout near the ghost ("x 120 · y 84") — near-free with the pointer events already wired.

12. **Toolbox gating dot is invisible in meaning.**
    Where: `ui.css:186-191` — a 6px amber dot; the explanation lives only in a multi-line `title` tooltip (`app.tsx:149`). The screenshot shows dots with no legend; nothing in the UI defines what amber means. Status-bar text mentions "web-only properties" only when target=desktop (`app.tsx:470-472`), so on the Web target the dots are unexplained.
    Fix: one-line legend under the search ("● limited on Web"), or replace the dot with the `gate-badge` treatment already designed for the inspector (amber outline chip, `ui.css:334-343`) for consistency.

13. **Checkbox-era `<select>` and native color picker break the custom-control illusion.**
    Where: `app.tsx:371-379` (raw `<select>`), screenshot: the dropdowns render as native Chromium controls against the custom toggle at `ui.css:354-372` — the toggle is beautiful, the select next to it is stock. This inconsistency is a classic "AI-generated scaffold" tell.
    Fix: style the select (appearance:none, custom chevron, same 7px radius/padding as text inputs) at minimum; a custom listbox popup if aiming for flagship.

14. **Scrollbar and focus visibility are default-web.**
    Where: `ui.css:411-414` (custom scrollbars: good, but 9px with no gutter padding looks 2015), and there is no `:focus-visible` style anywhere except input border-color (`ui.css:140,321`) — keyboard users get no ring on `.tool`, `.chip`, `.target`, `.toggle` buttons. Premium ≠ mouse-only.
    Fix: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` globally; slim scrollbars to 8px with `border: 2px solid transparent; background-clip: padding-box` for the inset look.

15. **Empty states are dead text.**
    Where: `app.tsx:262-269` "Nothing selected" + one dim sentence; empty canvas root panel is just a flat `#161a26` rect (`web.tsx:55`). Premium empty states teach: show a centered ghost outline of the selected-tool silhouette or the 3-step onboarding (drag → click → edit) as icon+text rows.
    Fix: replace the two-paragraph empty inspector with a compact "Select an element" row plus the last-3-used components as one-click chips.

## What already works

- The design-token layer (`ui.css:5-22`) is well-chosen: restrained palette, one accent pair, sensible elevation ramp. Don't re-theme; build on it.
- The toggle component (`ui.css:354-372`) is genuinely good — correct knob easing (`cubic-bezier(0.2,0.9,0.3,1)`), correct 140ms durations.
- Motion discipline: 110–140ms ease transitions on interactive chrome (`ui.css:103,165,361`) are the right register. Keep durations; add motion only where it communicates (drag, commit).
- The poke/seal undo pattern for continuous drags (`app.tsx:216,223`) is correct interaction engineering — extend it to strings (finding 5) rather than reworking it.
- Density of the shell (44px titlebar / 26px statusbar, `ui.css:45`) is right for a pro tool. Don't inflate it.
- Real-DOM output with data attributes + a11y tree (`web.tsx:150-155`) is the right architecture; the issues are visual, not structural.

## Deliberately deferred

- **Actual rulers/grid snapping** — bigger than a CSS fix; needs a layout engine decision. The dead toggle (finding 3) should be removed or stubbed out *now*, but real rulers are a feature, not craft.
- **Undo/redo UI (history panel)** — scope, not craft.
- **Zoom controls** on the canvas — same; noted only because their absence contributes to the flat feel, and the toolbar row (`ui.css:205-211`) has room reserved for them.
- **Multi-selection marquee** — feature work.
- **Native desktop output rendering** — covered by the sibling output-quality card; not assessed here beyond noting web.tsx is the only renderer read.
