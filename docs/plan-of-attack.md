# Plan of attack

Written 2026-09-30, after the output audit, the first graded agent run, and
the conversation that set standing rule 8 ("whatever a UI alone can do, a Loom
UI does"). This is the build order for everything that came out of that day.
`ROADMAP.md` stays the gap analysis; this file is the sequence.

## Where things stand

| Branch | Holds | State |
|---|---|---|
| `master` | the Studio | verify 960/960 |
| `claude/output-quality-audit` | `docs/reviews/output-quality-audit.md` — every tool built into one UI and measured as it ships; 31 ranked findings | report only, nothing fixed |
| `claude/ai-ui-agent` | the Assistant, MCP tools, parity tools, undo groups, justify/Button/place fixes; graded run `docs/reviews/ai-agent-grade.md` (OpenRouter, C+) | verify 1008/1008, preview 50/50 |
| `claude/plan-of-attack` | this plan, standing rule 8 | — |

## The destination, in one paragraph

A person — or the agent — builds a UI in Loom, and everything that UI could do
without a backend, it does, in Preview and in both exports. Behaviour is set in
the Properties panel with plain verbs a beginner gets in a minute, and the same
objects deepen (transitions, sequences, conditions, variables, data) for
intermediate and advanced designers without a mode switch or a dead end. Press
F1 on anything and Loom explains it, teaches it, or does it for you.

## The model underneath (decided once, used by every phase)

- A document holds **state**: which view shows, what is selected, what is
  open, what is typed, which screen is current, later named variables.
- Controls change state through **actions**: a fixed vocabulary of verbs, each
  with a target — Show, Hide, Toggle, Show one of, Open, Close, Go to, Filter,
  Sort, Select, Send event.
- A **trigger** fires actions: click by default; later key, hover, focus,
  change, submit, load.
- Actions live on the node (`Node.actions`, validated like props, one undo
  step per edit) and run in the ONE behaviour runtime shared by the canvas's
  Preview, the pop-out, Run on desktop, HTML and React exports.
- The runtime writes the accessibility itself (`aria-controls`,
  `aria-expanded`, `aria-current`, `hidden`), so wiring never costs it.
- A broken reference (deleted target) is flagged in the panel and on load,
  never silently dropped (standing rule 5).

## Phases

Each phase ships on its own branch off `master`, merges by PR, and is only
"done" when: every fix has a regression test that fails on the old code; the
interaction audit (Phase 1) is green; **the agent can do it** (tools + brief);
from Phase 6 on, **F1 can explain it**; and the OpenRouter benchmark is re-run
where the phase touches it.

### Phase 0 — Settle the branches (small)

1. PR `claude/output-quality-audit` → master (report + harness/probe).
2. PR `claude/ai-ui-agent` → master, or keep it experimental and cherry-pick
   its Loom fixes (undo groups, `justify`, Button nowrap) — **Shane decides**.
3. PR this plan → master.
4. From here every phase branches off master.

### Phase 1 — A trustworthy floor (medium)

The audit's S1s, because every later phase stands on them.

- **Overlays in the top layer**: Modal/ConfirmDialog/CommandPalette/Toast via
  `<dialog>`/popover; the scrim behind the panel, never over it; nothing trapped
  by glass. (audit 1, 2, 29)
- **An export looks the same to every viewer**: `color-scheme` on `<html>`, the
  theme's page when none is chosen; contrast re-measured per theme and viewer
  scheme; daylight `success`/`danger` tokens fixed. (3, 13)
- **One dismiss/close path** for any ✕, Cancel, confirm. (4)
- **Keyboard**: every operable element focusable and activated by Enter/Space,
  arrows inside groups, `aria-expanded` on the right element, focus rings on
  every input tool. (6, 6b, 17)
- `font: inherit` on generated controls; ErrorSummary's separator. (11, 5)
- **The interaction audit** — the twin of the prop-audit: operate every
  operable element of every tool in the real export; each must change
  something visible or emit a named event, or the build fails. A ratchet with a
  known backlog that may only shrink.

### Phase 2 — Actions, step 1: views and visibility (large) — *the List/Table case*

- Verbs: Show, Hide, Toggle, Show one of, Open, Close (targets: any node;
  Modal/Drawer/Menu open natively).
- **Buttons, links, icon buttons, menu items**: a "When clicked" section — one
  row per action, verb + target; target picked on the canvas (pick mode) or from
  a list; "+" for a second action.
- **Choice controls per option** (Segmented, TabBar, RadioGroup, Select,
  Checkbox, Switch): "Table → shows *Model table*".
- **Canvas link lines** from the selected control to its targets; the target's
  panel says "Shown by …"; broken targets flagged.
- **Smart offer**: a choice control beside N containers → "Switch between
  these?" (one click, never silent).
- **Agent**: `set_actions` / per-option wiring tools; brief drops the Tabs
  workaround and wires real switches.
- **Benchmark**: re-run OpenRouter — List/Table must switch views.

### Phase 3 — Layout that behaves: drop defaults and responsive web (medium)

Audit S2s that cost people and the agent the most time (the agent spent ~40
calls undoing them).

- **Auto W/H** in the panel and the model (hug contents); containers in flow
  default to auto height; explicit sizes are not flex-shrunk. (7)
- Row children get widths; horizontal tools default to rows (StatusBar,
  HeaderBar, FooterBar, Breadcrumbs); container chrome is a reserved region;
  Field seeds an Input. (8, 9, 10, 15)
- **Web target starts responsive**: flow-first page skeletons, wrap rules;
  the Target (Web/Desktop) becomes document state the agent can read and set.
- **Benchmark**: OpenRouter re-run must pass at tablet and phone.

### Phase 4 — Screens and navigation (large)

- A document holds **screens**; a canvas switcher; Layers per screen.
- **Go to** as an action; NavBar/SideNav/Link/Breadcrumbs wire to screens;
  `aria-current` follows the current screen.
- Exports: one file with all screens and hash routes (HTML), a router-free
  state switch (React). Deep links work.
- Screen transitions arrive in Phase 7.
- Agent: screen tools; "build the pricing page too" becomes one request.

### Phase 5 — Data that behaves (large)

- **Data lists**: one component with rows + a row template (a card, a list
  row) — edited in the row editor, not as a delimited blob; DataGrid moves onto
  the same rows. (16)
- **Filter / Sort / Search** actions: a search box, checkboxes or a sort select
  drive a list or grid; empty state and "showing 12 of 548" come free.
- Agent builds a list in one call instead of 29 Stacks.
- **Benchmark**: OpenRouter re-run — the filter sidebar and search really
  filter the models.

### Phase 6 — F1: explain, teach, do (large)

- **Every piece of the Studio says what it is**: help identities on panel rows,
  toolbox entries, parts, menus and chrome (reusing registry descriptions and
  the existing derived tooltips).
- **F1 (and a second key that works on Mac laptops, plus "Ask about this" in
  the context menu)** opens a card beside the thing pointed at:
  *Tell me about it · Teach me · Do it for me · ask anything*.
- **Explain** answers instantly from Loom's own knowledge (works offline), then
  the AI adds judgement about this instance.
- **Do it for me** is the Assistant scoped to the selection (one undo step).
- **Teach me**: new agent tools `point_at` (highlight a Studio control) and
  `wait_for` (watch for the person's action), a coach-mark overlay, step by
  step until done.
- Only the pointed-at context goes to the model.

### Phase 7 — The intermediate tier (large)

- **Transitions** on any action (fade/slide/scale, duration, easing, reduced
  motion honoured); screen transitions.
- **Sequences**: ordered actions ("close, then show toast, then focus").
- **Conditions in plain words**, picked from the document ("only if *Email* is
  filled", "when *Plan* is Pro").
- **Triggers**: keys (⌘K, Esc, Enter), hover, focus, change, submit, load.
- **Per-breakpoint behaviour** (on a phone the sidebar is a drawer the Filters
  button opens).
- **Named events** for the backend cases (`sign-in`, `save`): the HTML export
  dispatches them, the React export exposes them as `onSignIn`-style props.

### Phase 8 — Reusable components with behaviour (large)

Make-a-component with **exposed states and actions** ("Selected", "Open"),
instances that override content but inherit behaviour; the ROADMAP's
"user-defined reusable components", done with behaviour in from the start.

### Phase 9 — The advanced tier (large)

- **Named variables** (`view`, `selectedModel`, `filters.provider`) and
  **binding** anything to them (text, visibility, a list's filter, a count).
- **State inspector** in Preview: every variable live, the actions that fired,
  jump to any state ("show me the empty state").
- **React export as readable `useState` + callbacks**, so developers keep the
  behaviour.
- **Safe expressions** last, and only where plain words ran out: a small,
  validated language, never arbitrary JS.

### Running alongside every phase

- **Agent benchmark**: the OpenRouter prompt, re-run and graded the same way
  after Phases 2, 3 and 5; a second benchmark page (a settings or dashboard
  product page) from Phase 4. A per-turn trace (tool, args, result size, time)
  lands in Phase 2 so runs are measured, not eyeballed.
- **Audit S2/S3 polish** (glass palette, charts, AvatarGroup, SplitH/V,
  placeholder content…) judged on the specimen board, in gaps between phases.
- **Visual overhaul** of the Studio continues on its own track.

## Order and why

1 → 2 is the critical path: nothing about behaviour can be trusted while
overlays cover their own buttons and controls are mouse-only, and Phase 2 is
the answer to "clicking Table should show a table". 3 follows because the agent
and people both lose the most time to drop defaults. 4 and 5 complete what a
UI-only output can do (screens, data). 6 can start any time after 2 (it needs
something to explain) and could move earlier if help matters more than depth.
7–9 are the depth that makes intermediate and advanced designers want it.

## Decisions for Shane

1. Phase 0: merge the agent branch to master, or keep it experimental?
2. Phase 4: multi-screen export as one file with hash routes — agreed?
3. Phase 6 placement: after Phase 2 (as written) or sooner?
4. Phase 9: expressions at all, or plain words and variables only?
5. F1's second key (proposal: `?` when not typing, plus the context menu).
