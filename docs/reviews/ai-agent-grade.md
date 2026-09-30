# Grading the agent: OpenRouter's Models page

Goal 2E, 2026-09-30. Target chosen by Shane: a clone of the public
[OpenRouter Models page](https://openrouter.ai/models) — a real, dense,
data-heavy product page (top nav with search, a filter sidebar, a long list of
model rows with metadata), which is a strong test of layout, density and
controls.

**Run:** the Assistant in Loom (Electron, local build of `claude/ai-ui-agent`
at `2b09944`), Claude Opus 5.5, one prompt: *"This is a test of Loom Studio's
capabilities as well as yours. Please build a clone of the public website,
Openrouter's Models Page."* Watched live through CDP with a screenshot every 30s;
the result was measured as exported HTML in desktop, tablet and phone widths.

## What it built

107 nodes in 236 tool steps (29 Stack, 32 Label, 16 Checkbox, 7 Button,
6 Paragraph, 6 Divider, 2 Slider, 2 SearchBox, Heading, Select, Segmented,
Icon), light (daylight) theme on a white page:

- a top bar: bolt logo + "OpenRouter", a search field with a `/` hint, nav
  (Models, Chat, Rankings, Enterprise, Pricing, Docs) and a dark Sign In button;
- a filter sidebar: Input / Output modalities (checkboxes), Context length and
  Prompt pricing (sliders with 4K/64K/1M and FREE/$0.5/$10+ scales), Series and
  Providers (checkboxes);
- the list: "Models", "548 models", filter field, Newest sort, List/Table
  toggle, and six model rows — name, weekly tokens (right-aligned), a two-line
  description, and a meta line (provider · context · $/M input · $/M output).

At 1280px the export is a convincing, clean rendition of the page's structure.

## How it worked

| | |
|---|---|
| Steps | 236: 76 add, 59 set, 39 place, 15 describe, 5 move, 3 render, 2 check_layout, 1 WebFetch (refused), 2 ToolSearch |
| Pattern | read 12 specs up front → root and theme → sidebar → list scaffold (empty rows) → row content → render → fix → render/check → reply |
| Self-correction | after its first render it fixed a logo drawn as the word "layers", nav items drawn as boxed buttons, and the controls row not reaching the right edge |
| Reply | short, and **honest**: it said the content came from memory because it could not fetch the page, that it used fixed widths because `justify: between` had no effect, that the page would not adapt to tablet or phone, and that the theme had changed under it |

## Grade

| Dimension | Grade | Why |
|---|---|---|
| Structure vs the real page | **B+** | Every region is there and in the right place; missing provider icons, category-rank badges, release dates and the "Compare" affordance. |
| Content accuracy | **D** | Models from training memory (Claude Opus 4.1, GPT-5, Gemini 2.5 Pro, Grok 4…), not the live page (GPT-6.1 Sol Pro, Claude Sonnet 5.5…). Its fetch was refused by the Assistant's tool allowance. |
| Visual quality | **B** | Clear hierarchy, sensible type scale, tidy rows. The filter labels are 11px and faint; "Sign In" wrapped onto two lines in the export (it was one line on the canvas). |
| Responsiveness | **F** | Built at a fixed 1280px. On a phone the list is clipped with no way to scroll to it; nav is gone. It never rendered at tablet or phone. (It had no tool to adapt a layout per breakpoint, so this is half Loom's.) |
| Controls actually work | **C−** | Checkboxes, sliders, sort and the segmented toggle operate. But **List/Table does not switch the view** — it flips its own highlight only — and the search/filter does nothing. Loom can switch views today (Tabs, pills variant, one panel per view); the agent did not know to use it. |
| Semantics | **C** | Nav built from Buttons instead of NavBar/Link; headings and labels fine. |
| Efficiency | **C** | 236 calls, one component per call; 39 `place` calls fighting fixed sizes (drop heights of 200px, and `place` pinning height to 40px). Only 3 renders for a page this size. |
| Honesty of its report | **A** | Every limitation it named was real and verified. |
| **Overall** | **C+** | A good-looking desktop mock that reads like the page, but neither responsive nor fully working — what a person would expect from "clone this web page". |

## What the run found — and what was done about it

### In Loom (fixed on this branch, each with a regression test)

1. **`justify` "between" / "around" / "evenly" did nothing.** The shared
   vocabulary was written through as CSS, and those are not CSS values
   (`web.tsx`, now `justifyCss`). The markup-diffing prop audit could not see
   it because the attribute did change. §109 measures the row live.
2. **Buttons wrapped** when squeezed ("Sign" over "In") → `white-space: nowrap`
   on Button. §109.
3. **A person's edit mid-turn swallowed the agent's work.** During this run
   three theme clicks each committed the agent's pending nodes under
   "Theme: …": undoing the AI step would have left 26 of its nodes behind.
   Now a turn is a history group; a manual edit is its own step; undo mid-turn
   stops the agent. §107.

### In the agent (done on this branch)

4. **Parity with a person**: new tools `build` (a whole subtree in one call),
   `duplicate`, `style_part`, `set_states`, `set_responsive`, `set_display`,
   `set_effects`, `arrange`. §108.
5. **`place` with only a width pinned the height to 40px** → only the given
   axis changes. §109.
6. **Research allowed**: WebFetch and WebSearch (read-only) join Loom's tools,
   so "clone this page" can look at the page.
7. **`check_layout` reports wrapped one-line controls** (the Sign In case).
8. **Brief**: build with `build`/`duplicate`; use the right component (NavBar,
   DataGrid, Field, KpiCard); web pages are responsive — flow first, then
   render/check at tablet and phone and `set_responsive` where it breaks;
   controls must work — view switchers are Tabs with panels, not a Segmented
   beside static content; say what could not be made to work.
9. **The canvas stays visible while it builds**: the conversation folds to one
   live line during a turn (it used to cover the lower half of the artboard).
   Preview probe steps added.

### Still open (in order of leverage)

1. **An actions runtime** — a control that shows, hides or filters another
   component (Segmented → views, search → rows). Without it, "working UI" is
   limited to what composites build in. This is the ranked roadmap's
   data binding + actions item, and the agent needs it as much as a person.
2. **Responsive by default**: a web target should start from flow and
   container widths, not a 1280px free canvas; the Target (Web/Desktop) is
   editor state the agent cannot see or set.
3. **Drop defaults** from the output audit (fixed 200px heights in flow, column
   directions on horizontal tools) — the agent spent ~40 calls undoing them.
4. **A per-turn trace** (tool, arguments, result size, time) to measure runs
   instead of reading the thread's tooltip.
5. **Re-run** this exact prompt on the new build and grade it the same way.
