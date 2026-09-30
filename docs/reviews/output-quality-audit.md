# Output quality audit — every tool, in one UI

Branch `claude/output-quality-audit`, 2026-09-30, on `master` @ `b3f6621`
(typecheck clean, verify 960/960 before the audit).

## What was done

**A. The UI.** `docs/reviews/output-quality/build-scene.ts` builds one document
holding all 112 toolbox tools — every one the toolbox offers (the 4 that are
added from their owner's panel come with their owners) — through
`store.dropComponent`, the toolbox's own drop path, so seeds and drop sizes are
exactly what a drag produces. Nothing is restyled: defaults are what people get,
so defaults are what was judged. Seven category Cards on a flow page; tools
dropped **free** inside them (Loom's default) and packed by their measured
boxes. Empty containers got one Label so they are judged with content. A second
pass dropped the same tools into **flow** rows.

**B. Examination.** `harness.html` turns a tab into the scene's **real HTML
export** (`emitHtml`, with every node hooked so a box can be traced to its
tool; the export's own inline runtime runs). `probe.ts` then measured, per
tool: size, overflow, clipped text, text collisions, contrast of every text
run, font, target size, accessible names, and — by operating each tool — whether
it responds. Every section was also looked at in close-up screenshots, in
midnight and daylight, as a dark-mode and a light-mode viewer. In the Studio,
the same scene was loaded and every tool selected (Properties Panel, canvas,
console).

Reproduce: `npm run dev`, open
`http://localhost:5178/docs/reviews/output-quality/harness.html?theme=midnight`
(`&layout=flow` for pass 2), then in the console
`const p = await import('/docs/reviews/output-quality/probe.ts'); p.appearance(); await p.behaviour()`.

**Measurements that were probe artifacts, not findings** (recorded so nobody
re-reports them): "every control is inert" (the harness re-wrote the document
and the runtime's install-once flag survived — fixed in the harness); "no focus
ring anywhere" (a background tab never matches `:focus`); "native-look buttons"
(styled buttons keep `appearance:auto` harmlessly); ButtonGroup clipping (a
screenshot edge).

## The short version

The **atoms are good**. Controls, Text and most Data tools look finished and
work: 36 tools respond correctly when operated, all 112 open their panel with no
console error, and DataGrid, KpiCard, SettingsSection, Timeline, TreeList,
KanbanColumn, EmptyState and Calendar look like a real product.

What breaks quality is **how tools behave once composed and shipped**:

1. overlays are broken by the default glass surface and by their own scrim;
2. a default export's legibility depends on the *viewer's* OS theme;
3. several tools that look operable do nothing, and nine are mouse-only;
4. drop defaults (fixed heights, column direction, zero width in rows, chrome
   overlap) make a composed layout collapse or overlap.

## Findings

Severity: **S1** breaks function or makes output unreadable · **S2** wrong by
default / visibly inconsistent · **S3** polish.

### S1

**1. A Modal's scrim covers its own dialog.** The scrim is a child of the dialog
with `position:fixed; z-index:40` (`render/behaviour.ts:326`); the dialog's
content sits under it. Measured: `elementFromPoint` on the Modal's own "Save"
returns the scrim. An exported page with a Modal is dimmed and the dialog cannot
be clicked. *Fix:* render the scrim as a sibling behind the dialog panel (or use
`<dialog>.showModal()` / the top layer), and test that the dialog's buttons are
the hit target.

**2. Overlays are trapped by glass.** `glassSurface` sets `backdrop-filter`
(`render/web.tsx:586`), and a backdrop-filter makes an element the containing
block for every `position:fixed` descendant. Glass is the default Panel surface
(`8ed7206`), so the Modal scrim, CommandPalette and Toast are positioned against
the nearest glass ancestor, not the viewport: the scrim measured 1262×8923 (the
page), and the palette opens ~12% down the *page* — after scrolling, ⌘K opens
it off-screen. *Fix:* overlays in the top layer (`<dialog>`, `popover`), or
portal them to the export root outside any glass.

**3. A default export's legibility depends on the viewer's OS theme.** Page
background defaults to None, surfaces are translucent glass, and `color-scheme`
is set per element (`web.tsx:1804`) but not on `<html>`, so the page canvas
follows the viewer. A midnight export opened in light mode renders on white:
glass `rgba(15,18,28,0.56)` becomes mid-grey and **over 100 text runs fail AA**
(1.15–3.9:1; breadcrumbs, Import/Export, placeholders, captions nearly vanish —
seen in close-up). *Fix:* the export declares the theme's `color-scheme` on
`<html>` and paints the theme page colour when no page is chosen (or make
"Theme" the default page); the canvas then matches too.

**4. Close / dismiss controls that do nothing.** The runtime's dismiss handler
only acts inside `[data-loom-toast]` (`behaviour.ts:753`): Alert ✕ and every
NotificationList ✕ are decoration; ConfirmDialog's Cancel does not close it.
Standing rule 2. *Fix:* one dismiss path for any `[data-loom-dismiss]` that
hides its owning tool, and Cancel/confirm close the dialog (fire an event for
hosts); live tests for each.

**5. ErrorSummary's default merges both errors into one bullet.** Items
`'Email is required|Password is too short'` with a **comma** separator
(`model/catalog2.ts:1056`). A registry-wide scan found no other default whose
text uses a different delimiter than its separator. *Fix:* use a comma or set
`'pipe'`; add a selftest: every list default parses to more than one item under
its own separator.

**6. Seven text inputs have no focus indicator.** Input, SearchBox, ComboBox,
TagInput, Composer, DataGrid filter and CommandPalette search set
`outline:none` inline (`web.tsx:2111, 2919, 3304, 3341, 3679, 3968`), and the
only replacement ring is `[data-loom-field] …:focus` — inside a Field. The
export's `:focus-visible` rules cover press/toggle/tab roles, the checkbox box
and the range thumb only (WCAG 2.4.7). *Fix:* a focus ring on the well
(`:focus-within`) for every input tool, and one focus-visible rule for every
operable role (links, menu items, pages, row actions).

**6b. Nine tools cannot be operated from the keyboard (WCAG 2.1.1).** The
runtime has no generic Enter/Space activation, so every operable element that
is not a native control is mouse-only. *Not focusable at all* (no `tabindex`):
DataGrid sort headers, ProgressDots, Rating stars, Stepper steps, TreeList
expanders. *Focusable but Enter/Space does nothing*: Accordion summaries, Menu
items, DropdownButton items, DataGrid row-action items (`div role=button` /
`data-loom-b="press"`). Also, a disclosure writes `aria-expanded` onto the
AccordionItem's root (`behaviour.ts:827`) while the attribute a screen reader
reads is on the summary, which stays "false" when open. *Fix:* every operable
non-native element gets `tabindex=0` and one keydown handler (Enter/Space →
the same action as a click; arrows inside tab/radio/menu groups); set
`aria-expanded` on the element that carries `role=button`; a registry-wide
selftest that Tabs to every operable element and activates it by key.

### S2

**7. Drop heights are fixed and never grow.** A container dropped into flow
gets `h: 200` (`dropSize`, `model/drop-size.ts:65`); the root Panel keeps its
240px. Once filled, content spills over the next sibling (a Card drawn 164px
tall held 1,584px). In a flow column, a child's explicit H is also flex-shrunk
(sections with H=3855 drew 53px). The panel has no way to say "auto". *Fix:* an
**Auto** state for W/H (hug contents), containers in flow default to auto
height, `flex-shrink: 0` when H is explicit.

**8. Containers in a flow row collapse to zero width.** `dropSize` in flow
returns only a height, assuming "the flow parent sets the width" — true in a
column, false in a row: SplitH 0×280, SplitV 0×320, Stack 0×200, Grid 0×240,
Divider 0×1, Skeleton 0×14; Card/GroupBox/ScrollView/HeaderBar/StatusBar draw as
20–40px slivers with wrapped text. *Fix:* in a row, give the drop width (or
`flex: 1 1 <dropW>`).

**9. Horizontal tools default to a column.** `flowProps` defaults `direction`
to column (`model/prop-vocab.ts:85`), and **StatusBar, HeaderBar, FooterBar and
Breadcrumbs** inherit it: Breadcrumbs render Home / Projects / Loom stacked
vertically (320×102); a HeaderBar's actions stack under its title and spill out
of its 56px. NavBar had this bug and was fixed alone. *Fix:* row defaults for
these four, and a selftest listing which tools are row-by-nature.

**10. A free child covers its container's own chrome.** Section title, Modal
title, ConfirmDialog heading, BannerBox text, Hero title, NavBar brand, SideNav
and Menu first rows, Checklist item, DataCard value, StatusBar label and the
Drawer/SidebarPanel collapse glyph are all in the same coordinate space as a
child at the top-left (10 tools in the free pass, 10 in the flow pass). *Fix:*
a container's content box starts below its chrome (title/legend/header
reserved), or drop/snap offsets that avoid it.

**11. Buttons inside composites render in Arial.** Generated `<button>`s do not
inherit the font, so 20 text runs use the UA font: Tabs, TabBar, Pagination,
Modal and ConfirmDialog buttons, EmptyState's action, Composer's Send,
CommandPalette's ⌘k, and every collapse glyph. *Fix:* `font: inherit` on every
generated button/input (one base rule in `output-base.css`/`behaviourCss`).

**12. Two surface palettes, and glass that compounds.** Glass surfaces render
neutral grey; solid ones (Hero, AppShell, ScrollView, Modal, NavBar, SideNav,
Calendar, ConfirmDialog, CodeBlock) are navy — side by side they clash. Nested
glass (page → section → card) lightens at each level toward a flat
`#36383c`-ish grey and loses hierarchy. *Fix:* derive both from one ramp; nested
glass steps a fixed amount rather than stacking alpha.

**13. Theme tokens that fail AA.** Daylight: success green on white **2.34:1**
(Stat, KpiCard, DataCard deltas), danger red **3.70:1** (Menu "Sign out",
ConfirmDialog "Delete"), TagInput chips 4.38, Kanban count 4.46. Midnight:
BackButton "Back" **2.50:1** (it also reads as a grey, disabled browser button).
*Fix:* adjust `success`/`danger` text variants per theme; a selftest that
measures every tone on every theme surface.

**14. Tools that look operable but are static.** Calendar: days are
`gridcell`s that cannot be picked, the ‹ › arrows are a decorative span, and
"today" is a fixed 26 Sep. Stepper: steps are not clickable and the default has
no next/prev. Toast: shows once for 4s at page load, then never again — nothing
can trigger it. AnchorList: links to anchors that do not exist, no scroll-spy.
*Fix:* make them work (Calendar selection + month nav, clickable steps) or
state the limit in the tooltip; Toast needs a trigger (a Button "shows" it) —
the first real case for the actions runtime.

**15. Field arrives without a control.** It drops as the single word "Label"
with nothing in it; Tabs seeds its panels, Field seeds nothing (`seed` is
null, `model/toolbox.ts:264`). *Fix:* seed an Input.

**16. DataGrid data is edited as one delimited blob.** Rows are a textarea of
`Ada|Engineer|128,400|Active;Grace|…`. Timeline, Menu, NavBar already use the
row editor (`Node.lists`, `list-inspector.tsx`). *Fix:* DataGrid rows (and
Columns) on `Node.lists`.

**17. Targets under 24×24 (WCAG 2.2 AA)** — 26 in the scene, e.g. Alert ✕
14×14, Drawer collapse 16×17, Modal close 20×20, SpinBox steps 26×16, DataGrid
row actions 28×20, DropdownButton 68×16, Tabs 23 tall. **No accessible name**:
NumberInput, DatePicker, TimePicker.

### S3

18. **SplitH / SplitV are invisible**: no panes, no divider, no handle; nothing
says "split".
19. **Hero** puts its title at the top of a 360px box (250px empty below), no
call to action; **HeaderBar/FooterBar** labels are 11px grey.
20. **ScrollView** uses the OS scrollbar (▲▼ arrow buttons) on a solid
near-black box.
21. **AvatarGroup** overlaps so far the initials are clipped ("AD GR AL"), with
no separating ring.
22. **Charts**: PieChart legend shows 40% / 30% / 20% / 10% with no category
names; Bar/Line have no axes or labels; LineChart's end markers are clipped.
23. **Gauge** drops at 0% (reads as empty or broken).
24. **Placeholder content** reads unfinished: "Lorem ipsum", "Button", "Text",
"Check me", "A B C", "One Two Three". **Link** defaults to an external
`example.com` (clicking it in an export leaves the page).
25. **Alert / NotificationList ✕** sits right after the title, not in the corner.
26. **MessageList** drops empty and invisible (no surface, no empty state).
27. **Properties Panel labels truncate** in the 78px column: "Rail on
collapse", "Content padding", "Show language", "Show line numbers", "Search
placeholder", "Empty message", "Bulk actions sep".
28. **A closed CommandPalette is a page-sized fixed layer** (560×8923,
`pointer-events:none`): anything that measures boxes (the agent's
`check_layout`, snapping, this audit's packer) sees a giant node; its ⌘k trigger
ignores where it was placed and sits at the top of the page.
29. **The canvas shows overlays open with no way to close them**: a Modal's
scrim dims every tool in the design, and the open palette covers what is under
it.
30. **Page scrolls sideways** when the root is as wide as the viewport (the
vertical scrollbar takes 15px).

## Every tool

`Operates`: yes = responded when operated · NO = looks operable, did not ·
– = nothing to operate. `Issues` are the finding numbers above.

| Tool | Cat. | Operates | Issues |
|---|---|---|---|
| Card | Containers | – | 7, 8, 12 |
| Tabs | Containers | yes | 11, 17 |
| Accordion | Containers | yes, mouse only | 6b |
| Modal | Containers | close yes | **1, 2**, 10, 11, 17, 29 |
| Drawer | Containers | yes | 10, 11, 17 |
| Section | Containers | – | 10 |
| GroupBox | Containers | – | 8 |
| ScrollView | Containers | – | 8, 20 |
| SplitH | Containers | – | 8, 18 |
| SplitV | Containers | – | 8, 18 |
| Toolbar | Containers | – | — |
| StatusBar | Containers | – | 9, 10, 19 |
| Hero | Containers | – | 10, 12, 19 |
| HeaderBar | Containers | – | 9, 19 |
| FooterBar | Containers | – | 9, 19 |
| SettingsSection | Containers | yes (its rows) | — (best in class) |
| AppShell | Containers | yes | 11, 12, 17, 27 |
| SidebarPanel | Containers | yes | 10, 11, 17 |
| FormGrid | Containers | – | — |
| BannerBox | Containers | – | 10 |
| Panel | Containers | – | 2, 7, 12 |
| Stack | Containers | – | 8 |
| Grid | Containers | – | 8 |
| Icon | Text | – | — |
| Paragraph | Text | – | 24 |
| Caption | Text | – | 3 |
| Quote | Text | – | — |
| CodeBlock | Text | – | 12, 27 |
| InlineCode | Text | – | 3 |
| Link | Text | yes | 6, 17, 24 |
| BulletList | Text | – | — |
| NumberedList | Text | – | — |
| Divider | Text | – | 8 |
| Badge | Text | – | 3 |
| Tag | Text | – | 3 |
| Kbd | Text | – | — |
| Label | Text | – | 24 |
| Heading | Text | – | — |
| CommandPalette | Navigation | yes | **2**, 6, 11, 17, 28, 29 |
| NavBar | Navigation | yes | 10, 12 |
| SideNav | Navigation | yes | 10, 12 |
| Breadcrumbs | Navigation | – | **9**, 3 |
| Pagination | Navigation | yes | 11 |
| Stepper | Navigation | NO | 6b, 14 |
| Menu | Navigation | yes, mouse only | 6b, 10, 13 |
| CommandBar | Navigation | – | — |
| TabBar | Navigation | yes | 11 |
| AnchorList | Navigation | NO | 14, 17 |
| BackButton | Navigation | yes | 13, 17 |
| IconButton | Controls | yes | — |
| Checkbox | Controls | yes | 24 |
| RadioGroup | Controls | yes | 24 |
| Switch | Controls | yes | — |
| Slider | Controls | native | 17 |
| Select | Controls | native | — |
| ComboBox | Controls | yes | 6, 17 |
| TextArea | Controls | yes | — |
| SearchBox | Controls | yes | 6, 17 |
| NumberInput | Controls | yes | 17 (no name) |
| PasswordInput | Controls | yes | — |
| DatePicker | Controls | native | 17 (no name) |
| TimePicker | Controls | native | 17 (no name) |
| ColorInput | Controls | native | — |
| FileUpload | Controls | yes | — |
| ButtonGroup | Controls | yes (its buttons) | — |
| DropdownButton | Controls | yes (items mouse only) | 6b, 17 |
| Rating | Controls | yes, mouse only | 6b |
| ToggleButton | Controls | yes | — |
| Segmented | Controls | yes | — |
| SpinBox | Controls | yes | 17 |
| Checklist | Controls | yes | 10, 24 |
| TagInput | Controls | yes | 6, 13, 17 |
| OtpInput | Controls | yes | — |
| Button | Controls | yes | 24 |
| Input | Controls | yes | 6 |
| Field | Controls | – | **15** |
| DataGrid | Data | yes (sort/actions mouse only) | 6, 6b, 16, 17, 27 |
| Stat | Data | – | 13 |
| KpiCard | Data | – | 13 |
| ProgressBar | Data | – | — |
| ProgressRing | Data | – | — |
| Avatar | Data | – | — |
| AvatarGroup | Data | – | 21 |
| Image | Data | – | — |
| BarChart | Data | – | 22 |
| PieChart | Data | – | 22 |
| LineChart | Data | – | 22 |
| Timeline | Data | – | — |
| TreeList | Data | yes, mouse only | 6b |
| DataList | Data | – | — |
| KeyValue | Data | – | — |
| Calendar | Data | NO | 12, 14 |
| KanbanColumn | Data | – | 13 |
| EmptyState | Data | action has no press feedback | 11 |
| Skeleton | Data | – | 8 |
| DataCard | Data | – | 10, 13 |
| Gauge | Data | – | 23 |
| Sparkline | Data | – | — |
| Alert | Feedback | NO (✕) | **4**, 17, 25 |
| Toast | Feedback | – | 2, 14 |
| Spinner | Feedback | – | — |
| LoadingBar | Feedback | – | — |
| ProgressDots | Feedback | yes, mouse only | 6b |
| InlineMessage | Feedback | – | — |
| ErrorSummary | Feedback | – | **5** |
| SuccessCheck | Feedback | – | — |
| WarningCallout | Feedback | – | — |
| InfoCallout | Feedback | – | — |
| ConfirmDialog | Feedback | NO | **4**, 10, 11, 12, 13 |
| NotificationList | Feedback | NO (✕) | **4**, 25 |
| MessageList | Conversation | – | 26 |
| Composer | Conversation | yes | 6, 11 |

## Suggested order

1. **Overlays** (1, 2, 29): top-layer dialogs + scrim behind the panel — one
   change fixes Modal, ConfirmDialog, CommandPalette, Toast placement.
2. **The page under an export** (3): `color-scheme` on `<html>` + a theme page
   when none is chosen; re-measure contrast afterwards (13).
3. **One dismiss path, keyboard activation, focus rings** (4, 6, 6b, 17):
   runtime + base CSS.
4. **Drop defaults** (7–10, 15): Auto W/H, row directions, row widths, chrome
   offsets, Field seed — each with a selftest over the whole registry, not per
   tool, so the class of bug cannot come back.
5. **Base CSS** (11): `font: inherit`.
6. Then the S3 polish list, judged on the specimen board.

Each fix gets a regression test that fails on today's code; `probe.ts` can be
promoted into the verify suite for the registry-wide ones (contrast per theme
per viewer scheme, focus, targets, dismiss).
