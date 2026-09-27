# Loom roadmap

The gap analysis behind the build order. Written 2026-09-27, after the
behaviour layer landed (verify 376/376).

## The five styles

The UI categories real work is made of. Each is judged twice: can we *make*
one today, and what is missing to *knock it out of the park*.

| # | Style | Make one today? | Notes |
|---|---|---|---|
| 1 | Dashboard / analytics | yes | charts render for real in output |
| 2 | Sidebar workspace / app shell | yes | the container for admin, CRM, dev tools |
| 3 | Table-first / data grid | barely | the Table is a div schematic, not a grid |
| 4 | Marketing / landing | yes | highest request volume, most public |
| 5 | Settings / auth / onboarding | yes | form- and state-heavy; every product has one |

Runners-up, if the list ever needs swapping: mobile app, e-commerce/checkout,
docs site, kanban, chat.

## Gaps

### 1. Dashboard
- No chart **chrome**: legend, axes, gridlines, data labels, hover
  tooltip/crosshair, gauge target line, stacked/area/donut, funnel, waterfall,
  Pareto, heatmap.
- No panel header composite (title + actions + "updated 2s ago").
- No KPI card as a unit — value, comparison and visual ship as three loose
  parts, where the pattern wants exactly one of each.
- No time-range control, no live-refresh indicator.
- Grid is uniform columns: no 12-column named areas.

### 2. Sidebar workspace
- ~~No AppShell composite~~ — DONE: `AppShell` with a real 64px icon-rail
  collapse. Still missing: resizable sidebar, sticky panels, scroll shadows,
  a user/workspace switcher, a notification bell with a count, and focus
  management between panes.
- Navigation is flat: no section labels, no nested/collapsible groups, no
  active-state persistence.
- ~~No command palette~~ — DONE: `CommandPalette` indexes the document's own
  controls, groups them, fuzzy-matches, and runs the real control on ↵. Still
  missing: recents/saved commands, and a command's own arguments (a palette that
  can only press buttons cannot rename a project).
- No user/workspace switcher, notification bell + count, or presence dot.
- No resizable sidebar, no sticky/scroll-shadow behaviour.
- No shortcut registry, no focus management between panes.

### 3. Table-first
The weakest style. Missing: column resize, sticky header, frozen first column,
column pin/hide, multi-sort, row selection + select-all + bulk action bar,
inline cell editing, per-row pending/error/success, expand rows, row action
menus, facet filter bar with active-filter chips and clear-all, saved views,
page-size selector, "showing 1-50 of 2,418", density toggle, virtualization,
and states inside the grid. Plus right-aligned **tabular numerals** — the
defining data-UI typography rule, with no token for it today.

### 4. Marketing
Missing: **pricing table** (plan cards, feature matrix, billing toggle,
highlighted tier — the single most requested block), testimonial composite
(Quote has no author attribution), logo wall, feature-icon tile, hero variants
(split/centered, product frame, announcement pill), comparison table,
docs/prose layout (TOC, next/prev, code window with copy), newsletter form,
gallery/lightbox. Most damaged by the absence of responsive layout.

### 5. Settings / auth
`FormField` is GONE — replaced by `Field` (a container that owns description,
required marker and validation state, and reaches any control inside it). Still
missing: character counter, prefix/suffix addons, password strength + reveal;
auth composites (sign in/up/reset/verify/social row); onboarding wizard with
per-step gating and progress; billing (plan cards, seats, invoice, usage meter);
permission matrix; API-key reveal-once + copy. The settings-page PATTERN is done
(`SettingsSection` + `SettingsRow`, save bar, danger zone) — what is missing
there is the settings NAV that indexes those sections.

## Cross-cutting, ranked by leverage

1. **No data binding.** Every prop is a constant; the `bindable` badge has no
   runtime. Blocks all five styles from being real.
2. **No responsive system.** No breakpoints, no container queries. Every style
   above is specified per viewport and we author one fixed canvas.
3. **No icon set.** 113 emoji-class `icon:` strings. "Never mix icon styles" is
   table stakes everywhere.
4. **No theme toggle / `prefers-color-scheme`.** Themes are a document
   property, not a runtime switch.
5. **No data-UI typography.** Tabular numerals, numeric alignment, density.
6. **No composites layer.** ~8 composites close most of the gap; the atoms
   mostly exist.
7. Chart chrome and data-viz breadth, then hover states on data points (cheap
   now the behaviour runtime exists).
8. Per-component loading/empty/error slots, 44px hit targets, reduced motion.

## Standing rules

These are constraints, not preferences. They exist because the toolbox is the
product, and a toolbox that lies about what it can do is worse than a small
one.

1. **No duplicate function.** A new tool that performs a function an existing
   tool already performs must REPLACE it, not sit beside it. Keep the old tool
   only when it is a genuine special case, and record why in the code.
2. **Every tool is operational.** If a tool's purpose implies interaction, it
   interacts. A control that renders but cannot be operated is a defect, not a
   placeholder.
3. **Every tool is responsive where utility demands it.** Layout adapts to the
   space it is given, not to a fixed canvas.
4. **One state mechanism.** Native elements where the platform has one; every
   composite widget through the same attribute + CSS + runtime path.
5. **No silent fallbacks.** Unknown component, missing node, malformed file:
   fail loudly, repair at the trust boundary, report it.
6. **A hidden convention is a bug.** Any property whose value is a list
   declares its separator as a property, visible in the inspector. The renderer
   holds no private delimiter.
7. **Output is the promise.** Preview, HTML export and React export run the
   same behaviour and the same layout rules. If the preview lies, it is worse
   than no preview.

## Build order

1. **Responsive foundation** — container-query layout system, so everything
   after it is built on it rather than retrofitted.
2. **Composites, with removals** — DONE: DataGrid (replaced and REMOVED
   `Table`) and Field (replaced and REMOVED `FormField`). DONE additive: KpiCard
   (Stat and Sparkline KEPT as special cases, and the tests say why) and
   AppShell (HeaderBar and SidebarPanel KEPT — the shell composes them, with a
   real icon-rail collapse) and CommandPalette (indexes the artifact's own
   controls — no hand-kept list, and ↵ runs the real control). NEXT:
   SettingsSection, PricingTable, PanelHeader (as Panel props, not a tool).
3. **Icons + theme toggle + data typography** — cheap, unblocks everything.
4. **Binding runtime** — the enabler for real dashboards and tables.
5. **Chart chrome and data-viz breadth.**
6. **Per-component state slots**, motion and accessibility polish.
