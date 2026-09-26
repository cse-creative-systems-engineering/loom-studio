# HANDOFF — Loom session

## Project / workspace
- Project: Loom — ultra-premium desktop app that builds web + desktop UIs
- Workspace: `/home/shane/projects/loom`
- Stack: Electron + React 19 + Vite + TS strict (`src/`, `electron/`, dual `index.html` / `preview.html`)
- Verify: `npm run typecheck`, `npm run verify` (last: typecheck clean, verify 164/164 twice)

## Vision (from user history)
1. Not an AI UI builder — an app built by AI that builds UIs.
2. Old-school VS form builder: massive toolbox (100+ controls incl. panels), drag panel to canvas, drag controls in, reposition, resize, edit properties.
3. App itself + its output must be cutting-edge, high-quality, ultra-premium. Feel: Figma + Blender combo.
4. DESKTOP APPS FIRST. Loom produces desktop app UI first, web second. Defaults follow: editor targets desktop, Panel surface defaults to portable solid (glass is an explicit web-only opt-in), capability list admits no CSS mechanisms.
5. Total customization = edit all properties for all elements.
6. Positioning is ABSOLUTE, everywhere, by default (old-school VS form builder). Every component instantiates free; no schema default opts into flow. Flow remains as an explicit per-container opt-in via the Inspector Layout toggle (`setFlow` op) — and only there.
7. Future AI chat helper — explicitly NOT now.
8. Prior features already done: detached on-demand floating preview, Del delete, Ctrl+Z/Y undo/redo, right-click context menu, save/load/autosave.

## Constraints (binding)
- NO FALLBACKS. Everything fails fast.
- No generic fallback renderer. Every component gets explicit style + render branches in `src/render/web.tsx`. Unknown types throw — never silent generic `<div>`.
- `normalizeProps` must throw on unknown component (fail fast), not return raw copy.
- `renderNode` must throw on unknown component / missing node, not return null / generic div.
- Keep hostile-file `persist.validate()` repair behavior (drops bad nodes with issues) — file loader must handle untrusted input; that is validation, not a renderer fallback.

## State when handed off
Done (toolbox 100+ COMPLETE, typecheck clean, verify 97/97):
- `src/state/store.ts` `emptyDocument()`: root `flow:false` (free canvas default). Demo still opts into flow explicitly.
- `src/app.tsx` Toolbox drop: free parents keep x/y; flow parents zero them. Child `flow` flag comes from schema `defaultFlow`, not parent.
- `src/app.tsx` Inspector: Position + W/H shown when `!isFlowChild()`. X/Y via poke/seal, W/H via poke resize/seal.
- `src/model/toolbox.ts`: 10 base (Panel, Stack, Grid, Button, Label, Input, FormField, Heading, Gauge, Sparkline) + `import './catalog1'` + `import './catalog2'`.
- `src/model/catalog1.ts` (45, WIRED): 20 containers + 25 controls (see HANDOFF history).
- `src/model/catalog2.ts` (NEW, 56, WIRED): Text 12 (Paragraph, Caption, Quote, CodeBlock, InlineCode, Link, BulletList, NumberedList, Divider, Badge, Tag, Kbd) + Data 20 (Table, Stat, ProgressBar, ProgressRing, Avatar, AvatarGroup, Image, BarChart, PieChart, LineChart, Timeline[container], TimelineItem, TreeList, DataList, KeyValue, Calendar, KanbanColumn[container], EmptyState, Skeleton, DataCard[container]) + Navigation 12 (NavBar[container], NavLink, SideNav[container], Breadcrumbs, Pagination, Stepper, Menu[container], MenuItem, CommandBar[container], TabBar, AnchorList, BackButton) + Feedback 12 (Alert, Toast, Spinner, LoadingBar, ProgressDots, InlineMessage, ErrorSummary, SuccessCheck, WarningCallout, InfoCallout, ConfirmDialog[container], NotificationList[container]). Total = 111.
- `src/model/registry.ts` `normalizeProps`: throws on unknown type (fail-fast). `instantiate` already threw. `persist.validate()` repair behavior KEPT (drops unknown/dangling/orphan/cycle with issues) — file loader handles untrusted input; that is validation, not a renderer fallback.
- `src/render/web.tsx`: explicit `styleFor` + `renderPreviewNode` + authoring `renderNode` + `authorInner` (selected-leaf) cases for ALL 111 components. All `default:` branches are `throw new Error('unknown component: X')`. `renderNode` throws on missing node / unknown component (no null, no generic div). `styleFor` throws on unknown spec.

Done (export v1, typecheck clean, verify 116/116):
- FORMAT DECISION: standalone single-file `.html` FIRST (not React+CSS). A React export forces recipients through npm/version/build breakage; a static file opens in any browser. React/native emitters can layer on later.
- `src/export/html.ts` (NEW): `emitHtml(doc)` = `renderToStaticMarkup` over the SAME preview renderer (`mode:'preview'`) — single source of truth, so export cannot drift from preview; all 111 covered by construction; fail-fast + escaping inherited from React. Pure + deterministic (no timestamps/random). `exportFilenameFor` mirrors `persist.filenameFor` with `.html`. Root absolute-positioning overridden via scoped `.loom-export>:first-child` CSS (editor renderer untouched).
- `src/state/store.ts`: `exportFilename()`, `emitHtml()`, `exportHtmlFile()` (renderer generates bytes, main writes them; falls back to `save` on hosts predating the channel). Also contains the other session's `seal` deep-compare fix (`nodeMapsEqual`) — see note below.
- `electron/preload.cts` + `electron/main.ts`: `doc:export-html` IPC with an HTML save-dialog filter (`HTML document *.html`), same trust shape as save.
- `src/app.tsx`: Export button in TitleBar + `Ctrl+E` shortcut (same pattern as Save/Ctrl+S).
- `electron/selftest.ts` §28 (10 checks): doctype, no editor hooks, real controls, daylight theme embedded, determinism, hostile-text escaping (`<script>` → `&lt;script&gt;`), hostile-name title escaping + slugged filename, all-111-components emit (one tiny doc each, failures named), unknown-type throws.
- NOTE — concurrent editing observed: another session is actively working this repo (added selftest §26 flow-phantom + §27 container-targets and the `seal` deep-compare fix while this work was in flight). One verify run (115/116) raced their mid-edit save; settled tree passes 116/116 repeatedly (ran 5x). §26 on disk now asserts the correct layering (canvas guards via `isFlowChild`; seal records real changes, swallows true no-ops) — verified independently with a throwaway esbuild+node probe (50/50 seal-records-real-move). Do NOT reintroduce a poke-real-change-then-expect-silence assertion: that would demand the store lose data and break exact-undo.

Done (adversarial pass 2, typecheck clean, verify 132/132 twice):
- Report: `docs/reviews/adversarial-pass-2.md`. 7 demonstrated findings, all fixed + regression-tested in selftest §29 (16 checks; suite 116 → 132).
- `registry.validateProps()` (NEW, strict trust boundary): missing→default silent, wrong-type→default+issue, undeclared→dropped+issue, geometry kept only if finite. `persist.validate()` uses it per node. `normalizeProps` (in-memory) deliberately stays lenient.
- `persist.validate()` graph rewrite: single-parent enforcement (49-node diamond → 126MB exponential render, now linear 14KB), one iterative O(n) DFS (600-chain 16s hang → 2000-chain 17ms), `MAX_TREE_DEPTH=512` truncation (pairs with linear validation so deep files can't stack-overflow the renderer). Old `cycle involving` repair subsumed by multi-parent/orphan reports; `parentOfRaw` deleted. Dangling drops now report issues per the documented contract.
- `px()` requires finite (NaN/Infinity → fallback, no more `NaNpx`); `store.remove()` keeps selection on refused delete (old review bug 6); `app.tsx supportedIn` delegates to `registry.propSupported` (old review bug 9c).
- `textOnAccent` theme token (midnight `#0b0d13`, daylight `#ffffff`, contrast `#0a0f1c`): measured white-on-accent AA failures (midnight 3.16:1, contrast 2.39:1) fixed; all fill-text sites tokenized. Midnight primary buttons change white→near-black text (6.05:1, correct).
- Left alone deliberately: `meta.targets` write-only (sanitize when desktop emitter consumes it), `parentOf` O(n), undo-mid-gesture, Switch-knob white + pie data colors.
- Caution stands: sibling session active; one verify run raced a half-saved tree mid-pass (115/116 on a since-corrected assertion). Re-read before editing.

Done (desktop-first + absolute-first, typecheck clean, verify 137/137 twice):
- User directive: desktop apps first, absolute positioning. `defaultFlow` removed from ALL component schemas (toolbox + catalog1 + catalog2) — every component instantiates free; drops keep x/y in every parent; drag always moves. Flow survives only as explicit opt-in.
- `src/app.tsx` Inspector: NEW Layout section for containers with a Flow toggle (`commit setFlow`, Flow on/off history labels). Position section now shows for everything free (i.e. nearly always), correctly.
- Desktop-first defaults: `store.target` initial `'desktop'` (gating badges honest from the start); Panel `surface` default `'solid'` + `glass` default `false` (demo shifts glass→solid, intended); `DESKTOP_CAPABILITIES` drops `'css-grid'` (no prop required it — zero behavior change, taxonomy now honest per review 1 §9a).
- `electron/selftest.ts` §30 (5 checks): all-111 instantiate free, Panel solid/non-glass defaults, no css-grid in desktop caps, default target desktop. Suite 132 → 137.
- No fallout: all pre-existing flow tests set flow explicitly; no test asserted the old defaults.

Done (Atelier steals, typecheck clean, verify 164/164 twice, CDP visual proof in `docs/shots/loom-layers.png`):
- Context: Shane built Atelier Builder separately (Tailwind artifact builder, absolute-only, ~20 types, layers/zoom/guides/export-modal, NO undo/save/nesting/desktop). Stole what Loom needs; Atelier stays separate, more goodies may come later. Deliberately NOT stolen: flat model (Loom's tree stands), Tailwind coupling, rotation, hover previews.
- Model: `Node.visible` + `Node.locked` (REQUIRED fields — compiler enforces every construction site), `setVisible`/`setLocked` ops with exact inverses, `duplicateSubtree()` (fresh ids, +12 offset), `instantiate`/`addComponent`/`addMany`/`emptyDocument`/loader all carry the fields, loader coerces garbage with issues.
- Renderer: preview/export SKIP hidden nodes (output truth); authoring ghosts them (opacity + amber dash, never lost). `zoomed()` helper for pointer→doc math.
- Toolbox Layers tab (Components | Layers · N): full tree, select/multi-select, eye, lock, ↑↓ z-order via reparent, detail text. No shell-grid change (layout probe safe).
- Canvas zoom (25–200%, CSS `zoom` so layout/scroll behave, readout resets to 100%), snap guides (sibling left/top + origin, 6px, v1), live drag readout, Alt-drag duplicate, locked blocks drag/resize/delete, `store.remove` filters locked.
- TitleBar Copy button (clipboard HTML + transient confirmation).
- `electron/selftest.ts` §31 (27 checks: ops/inverses, hidden-output, locked-delete, duplicate family, z-order, zoom math, loader flags). Suite 137 → 164.
- Proofs: headless preview probe 8/8 (incl. new update channel); CDP drive of the REAL UI — Layers tab (19 rows), zoom →156% via real clicks, eye-toggle ghost, screenshot.
- Polish debt (known): deep layer rows crowd at 216px toolbox width; snap is edges-only (no centers/sizes); readout styling minimal.
- Sibling session runs Electron harnesses concurrently — attribute PIDs precisely (debug-port cmdline match); NEVER pkill -f (once hit the tool harness itself).

Pending:
1. Next: desktop/native emitter (export v1 is web-only HTML — second priority behind desktop). Then gesture cancellation + `parentOf` index (old review backlog). Atelier may deliver more steal-worthy features later.

## Key files
- `src/model/toolbox.ts` (existing 10) + `src/model/catalog1.ts` (new, unwired)
- `src/model/registry.ts`, `src/model/types.ts`, `src/model/ops.ts`, `src/model/persist.ts`
- `src/state/store.ts`, `src/app.tsx`, `src/render/web.tsx`, `src/render/theme.ts`
- `src/demo.ts`, `electron/selftest.ts`, `electron/main.ts`, `docs/reviews/`

## Resume prompt
Continue the Loom handoff in `/home/shane/projects/loom`: 111 components wired + fail-fast, export v1 (standalone HTML) ships, adversarial pass 2 closed 7 findings, desktop-first + absolute-first defaults live with Inspector Flow toggle. Verify 137/137 (twice), typecheck clean. Sibling session concurrently runs Electron harnesses — do not kill PIDs you cannot attribute; re-read files before editing.
