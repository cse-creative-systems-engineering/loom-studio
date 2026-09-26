# Loom — Adversarial Functionality Review

Reviewed: 2026-09-26, ~15:20–15:30 EDT.
Scope: `src/model/types.ts`, `src/model/ops.ts`, `src/state/store.ts`, `src/app.tsx`,
`src/render/web.tsx`, `src/model/toolbox.ts`, `src/model/registry.ts`, `electron/selftest.ts`.

**Review-pin caveat (important).** The repository was being actively edited *while this
review ran*. Between my first reads (~15:20) and my verification pass (~15:25),
`ops.ts`, `store.ts`, `registry.ts`, `app.tsx`, `web.tsx`, `demo.ts`, and `selftest.ts`
all changed on disk (mtimes 15:21–15:22). Two issues I had demonstrated against the
earlier build — leaves stacking at `left:0 top:0` inside flow containers, and containers
double-linking their children — were **fixed mid-review** and are now covered by
regression checks 10–12 in `electron/selftest.ts` (29/29 passing on the build I verified).
Everything below is stated against the post-15:22 state unless explicitly marked
"[pre-fix]". Verify at 29/29: `npm run verify` → `{ passed: 29, total: 29, allPass: true }`.

---

## Verdict

No, a user cannot build a real UI with this today — and the biggest hole is not the
missing resize handles; it is that **the two layout modes the model defines are both
half-broken in the editor loop**. In a flow document (the default: `emptyDocument()`
gives the root `flow: true`), dropping a component at a point stores coordinates the
renderer throws away (demonstrated below), dragging a leaf produces committed "Move"
history entries that change nothing on screen (demonstrated), and there is no reorder
UI at all — so children of any flow container can never be rearranged. In a free
document, you cannot drop *into* a container because the toolbox only ever targets the
surface root (`app.tsx:112`), and there is no `setFlow` control anywhere in the
inspector — the flow/free decision is currently unreachable from the UI (grep: `setFlow`
appears only in `demo.ts`, `selftest.ts`, and the op type). Add no save/load, and the
honest summary is: the model layer is in decent shape, but the *loop* — place, arrange,
keep — does not close for either layout mode.

---

## Confirmed bugs

Ordered demonstrated-first. Every "DEMONSTRATED" item was reproduced by code I ran
(probes in `/tmp/loom_probe/`, model-level and DOM-level) against the pinned build.

### 1. DEMONSTRATED — Reparenting a node to the end of its own parent lands it one slot short

- **Repro** (model probe, real `apply()`): children `[a,b,c]`;
  `apply(doc, { op: 'reparent', id: 'a', parent: 'r' })` (index omitted = "to end").
- **Observed**: `[b,a,c]`. Expected: `[b,c,a]`. "Move to bottom" — the single most
  common reorder — is wrong for any node not already last.
- **Root cause**: double shift-compensation in `ops.ts:137-143`. The default index is
  `target.children.length` read at line 139 — *after* `detach()` at line 138 has
  already removed the node (so the default is already in post-removal coordinates) —
  and then line 142 decrements it again because `index > indexInFrom`. Explicit
  indexes have the mirror problem: line 142 interprets `op.index` in *pre-removal*
  coordinates, but `invert()` (`ops.ts:209-214`) emits `indexOf` — *post-removal*
  coordinates. The two conventions only coincide for backward moves; a forward move
  with a UI-computed drop index (`index` = insertion slot in the list the user sees)
  is off by one. `invert(reparent)` round-trips only by accident of this pairing.
- **Fix direction**: pick one convention (post-removal is what `invert` already emits
  and what a drop-target index naturally is), compute the default before detaching or
  skip compensation for it, and assert round-trip `apply(apply(d,op),invert(d,op))`
  preserves order in tests.
- **Severity**: high — silent wrong output from the op the AI assistant will emit most.

### 2. DEMONSTRATED — Dragging a leaf inside a flow container commits Move history that changes nothing

- **Repro** (DOM probe against the live renderer): root `flow: true` (the default);
  `addComponent('Button', root, 300, 200)`; poke `{op:'move', x:500, y:500}` as a
  canvas drag would.
- **Observed**: `storedPropsXY: [500,500]`, `renderedOffsetInSurface: [18,18]` before
  and after, `movedVisually: false`. The drag handler *permits* the drag
  (`app.tsx:197`: `free = !node.flow && !(spec?.container && node.flow)` — a leaf is
  `flow:false`, so it is draggable regardless of its *parent's* flow), `seal('Move')`
  commits an entry, and the status bar's undo count grows — for zero visual effect.
  `styleFor` (`web.tsx:54-58`) applies `left/top` only when `!flowChild`, and
  `isFlowChild` (`web.tsx:36-40`) is decided purely by the parent.
- **Severity**: high — the user's primary gesture silently lies to them.

### 3. DEMONSTRATED — Drop coordinates are stored, then discarded, for flow parents

- **Repro** (same DOM probe): toolbox drop math (`app.tsx:114-115`) with
  `(clientX-rect.left, clientY-rect.top) = (300, 200)` onto the flow root.
- **Observed**: node stores `x:300, y:200`; element renders at offset `(18,18)` — the
  flex column ignores the drop point entirely. The `move` op and `x/y` props are dead
  weight for every child of a flow container, and the toolbox does dead work computing
  them.
- **Severity**: medium in isolation (flow placement may be intended), but combined
  with bug 2 it means *neither* layout mode gives the user control over where a
  dropped/ dragged element ends up, and with bug 1 there is no reorder path either.
  Flow containers currently have **no** user-facing ordering mechanism at all.

### 4. DEMONSTRATED — `insert` without `tree` silently orphans declared children

- **Repro** (model probe): panel `a` with child `k`; `remove('a')`; then replay
  `{op:'insert', parent:'root', node:<a>}` without `tree` — exactly what any AI
  assistant or serializer replaying a captured op would do, since `tree` is optional
  (`types.ts:62`) and *nothing in the codebase ever populates it* (the only producer
  would be `invert('remove')`, `ops.ts:176-189`, and the store never calls `invert` —
  undo is snapshot-based, `store.ts:112-120`).
- **Observed**: `a` restored with `children: ['k']` while `k` does not exist in
  `doc.nodes`. The renderer then hits `renderNode → null` per child
  (`web.tsx:155-156`) — silently missing UI, no error anywhere.
- **Root cause**: `ops.ts:89-93` materialises `op.tree` only if present; nothing
  validates that `node.children` ⊆ `tree` ∪ existing nodes.
- **Severity**: high for the stated AI-drives-ops goal; latent for humans today.

### 5. DEMONSTRATED — Undo mid-gesture silently discards the in-flight gesture

- **Repro** (model probe): `addComponent` (history: 1 entry) → `poke(move → 300,300)`
  (unsealed) → `undo()`.
- **Observed**: undo pops the *add*, the unsealed pokes vanish with no record
  (history 1 → 0), and `redo()` restores the button at its pre-drag position. The
  still-registered window `pointerup` then fires `seal('Move')`, which correctly
  no-ops — but the user experiences: drag, hit ⌘Z, and their *add* disappears instead
  of the drag. There is no gesture-cancellation path: `store.undo()` (`store.ts:112-120`)
  knows nothing about `app.tsx`'s live `dragRef` listeners (`app.tsx:209-226`).
- **Severity**: medium — a correctness/UX trap that gets worse once resize gestures
  exist (a cancelled resize leaves an unsealed half-resized doc if any code path
  commits afterwards; `commit()` resets `sealed`, masking the leak, but a subsequent
  unrelated `seal()` from the stale gesture would mislabel history).

### 6. DEMONSTRATED — `remove()` wipes the selection even when nothing was deleted

- **Repro** (model probe): select the root, `store.remove([root])` (root removal is
  refused, `ops.ts:101`).
- **Observed**: `selection` cleared, inspector flips to "Nothing selected" despite the
  document being untouched. `store.ts:211` calls `this.select([])` unconditionally,
  outside the `commitAll` success path (contrast `addComponent`, which only selects on
  `ok`).
- **Severity**: low, but it is the template for a class of bug: UI state mutated on
  failed ops.

### 7. DEMONSTRATED (measured) — `parentOf` is O(n) per call and sits inside every hot loop

- `ops.ts:51-56` scans all nodes. `detach()` calls it per remove; `ancestry()` calls it
  per step; `isFlowChild()` calls it **per node per render** (`web.tsx:160`), making
  every React render O(n²).
- **Measured**: 500 removes over a 2000-wide parent = 296 ms (~0.59 ms/op) in a bare
  bundle — fine today at demo scale, quadratic at real scale. With `isFlowChild` in
  the render path, a 2000-node document re-renders 4M `parentOf` steps per frame.
- **Severity**: medium-term performance wall; trivially fixed with a parent map
  maintained by `apply()`.

### 8. Argued (code-level, not runtime-proven) — Inspector number fields spam history; Input value is one-way

- **Number fields**: every non-positional number prop goes
  `Field → NumField onChange` → `s.commit(...)` per keystroke (`app.tsx:337, 392-402`).
  Typing `250` into a numeric field creates three "Set x" undo entries (X/Y fields
  use poke+seal instead — two different commit disciplines in one panel). Contrived
  to demonstrate but the code path is unambiguous.
- **Input value**: the canvas `<input>` is uncontrolled (`defaultValue`,
  `web.tsx:204`). Changing `value` in the inspector never updates the canvas (React
  ignores `defaultValue` changes), and typing into the canvas input updates only the
  DOM — the document never learns about it. Two sources of truth that drift apart the
  moment either is touched. Confirmed `inSync: false` in the DOM probe after a
  `setProp` of `value`.
- **Severity**: medium. The canvas-typing divergence especially: a designer "types a
  placeholder value", saves nothing (there is no save — see below), and the exported
  doc has the stale prop.

### 9. Argued — Capability gating has holes the desktop target will inherit

- `DESKTOP_CAPABILITIES` includes `'css-grid'` (`registry.ts:145-149`) — a CSS
  mechanism listed as a native-widget capability. The comment says "what a GTK/Qt
  widget tree can faithfully represent"; CSS grid is not that. When the desktop
  backend exists, `Grid` will pass gating and then need a real GTK/Qt layout
  equivalent that this tag does not guarantee.
- `Panel`'s `surface: 'glass'` enum value applies a translucent background
  (`web.tsx:68-72`) with no `requires` on the enum (`toolbox.ts:29-34`); only the
  separate `glass` boolean is gated (`toolbox.ts:35-40`). Translucency — a classic
  no-op on native widget stacks — is reachable on the desktop target through the
  ungated enum.
- The capability check in `app.tsx:349-356` (`supportedIn`) duplicates
  `registry.propSupported` with hand-copied capability arrays instead of importing
  them — the two will diverge.

### 10. Argued — `null` props are representable but not meaningful

`setProp(key, null)` leaves the key present-but-null (`ops.ts:119`); `normalizeProps`
keeps nulls (`registry.ts:98`); the inspector enum field then displays the *default*
(`String(value ?? ps.default)`, `app.tsx:378`) while the renderer renders empty
(`str(null) → ''`, `web.tsx:24-26`). Inspector display and actual render disagree for
the same node. Untestable through the UI today (no control produces null), but the
AI-assistant op path can emit it freely. `invert`'s absent→null convention
(`ops.ts:194`) hard-codes the ambiguity in as well — moot while undo is snapshot-based,
but it is a landmine if inverse-op replay ever replaces snapshots.

### Cosmetic — "Delete N items" overcounts

`remove([panel, childOfPanel])` labels the history entry "Delete 2 items" while the
second op is a no-op (`store.ts:167-174`). Fine for humans, noise for the undo-label
audit trail the AI assistant will share.

---

## Missing capability

Ordered by how much it blocks real work.

1. **Container-aware drop + reorder (BLOCKING).** The toolbox only recognizes
   `[data-loom-surface]` (`app.tsx:112`) — you cannot drop into a Panel/Stack/Grid,
   ever. There is no reorder UI (no drag-to-slot, no z-order commands). Combined with
   bugs 1-3, children of flow containers are unplaceable and unorderable, and children
   of free containers are only placeable at the root level. Interacts with: `reparent`
   op (fix index semantics first), renderer hit-testing (`data-loom-id` is already on
   every element — the hooks are there), insert-index indicators. Complexity: medium.
   This is the single highest-leverage build.
2. **Save/load to disk (BLOCKING).** No serializer, no persistence, no file dialog —
   the document exists only in a store singleton (`app.tsx:13`). Every other gap is
   annoying; losing work on window close is disqualifying. Also prerequisite for
   testing the "compiles per target" claim against a *file*, and for the AI assistant,
   which needs a document to load. Interacts with: nothing — deliberately small.
   Complexity: low (Document is already JSON-shaped; needs validation via
   `normalizeProps` on load).
3. **Honest gestures (BLOCKING-adjacent).** Cancel a drag on Escape/undo (clear
   `dragRef`, revert to `sealed`), and make flow-child drags perform *reorder*
   (reparent within parent) instead of dead `move` pokes. Interacts with: bugs 1, 2,
   5. Complexity: low-medium.
4. **`setFlow` in the inspector (major).** The op exists, the renderer honors it, and
   no UI control reaches it. Free-positioning inside containers — the Visual-Studio-
   Designer behavior this tool claims lineage to — is currently impossible to turn on
   from the UI. Complexity: trivial (a Toggle wired to `commit setFlow`).
5. **Resize (major).** No `width`/`height` props exist on *any* component
   (`toolbox.ts` — not even Panel), so resize handles have nothing to write to. This
   is a schema decision before it is a UX one: which components are user-sizable vs
   content-sized, and what that means for the native target.
6. **Multi-select manipulation (moderate).** Shift-click multi-select exists
   (`app.tsx:187-190`) but drags move a single node (`DragState` holds one `id`,
   `app.tsx:170-177`), delete works (`remove(ids)` is batched), align/distribute
   nothing. Annoying, not blocking, until free positioning works.
7. **Copy/paste + duplicate (moderate).** `captureSubtree` (`ops.ts:222-232`) exists
   and is unused — paste is one `commitAll` of re-id'd inserts away. Interacts with
   the `tree`-validation fix (bug 4): paste is the second producer of subtree inserts.
8. **Undo/redo buttons, Delete key (small).** Undo/redo are keyboard-only (⌘Z/⌘Y,
   `app.tsx:39-44`); the status bar shows counts but no buttons. Plain Delete/Backspace
   is unbound — only ⌘D deletes (`app.tsx:45-48`). Every shipped designer binds both.
9. **Undo/redo buttons in the toolbar** — same as 8, listed for completeness.

---

## Design risks

- **The op vocabulary is not yet load-bearing, and that is hiding its flaws.** Undo is
  snapshot-based (`store.ts:4-6` says so honestly), which means `invert()`,
  `captureSubtree`, `OpFrame`, and the `tree` field are currently exercised by zero
  production code. The claimed benefit — "the future AI assistant drives the SAME
  ops" — will be the first real consumer, and bugs 1 and 4 live exactly there. I'd
  make the store's `undo` replay `invert()` behind a flag now (or at least add
  round-trip property tests: for every op, `apply(apply(d,op), invert(d,op))` must
  equal `d`) so the op layer is honest before the AI depends on it.
- **Poke/seal has no cancellation concept.** The gesture model assumes seal is the
  only end; undo, Escape, and window-blur mid-drag are all unhandled (bug 5). The fix
  is small (`store.cancelTransient()` reverting to `sealed`) but the *invariant* should
  be written down: between poke and seal, no code may call `commit`/`undo`/`redo`. Right
  now nothing enforces or documents that.
- **The renderer-neutral claim is credible but untested, and two things lean DOM.**
  The model itself (nodes, flow flag, x/y, typed props) is genuinely target-neutral —
  nothing in `types.ts`/`ops.ts` mentions DOM. But: (a) there is no serializer, so
  "compiles per target" is a claim about intent, not code — the only "backend" mutates
  live DOM inside the editor (`web.tsx`), which conflates *authoring view* with
  *compiled output*; a native backend cannot reuse that shape at all. (b) The
  capability taxonomy mixes rendering mechanisms (`css-backdrop-filter`) with widget
  semantics (`native-widget`), and bug 9 shows the taxonomy already leaks. (c) Every
  visual constant — colors, radii, padding defaults, `#5b8cff` accents — lives in
  `web.tsx`'s inline styles, not the document; the desktop output will need those
  re-declared per widget, and nothing in the model currently carries theme. I'd
  extract a `compileWeb(doc): WebTree` pure function (DOM-independent intermediate)
  before the native backend, or the two targets will share nothing but the ops.
- **`flow` semantics are parent-decided and x/y-carrying nodes are second-class in
  flow mode.** After the mid-review fix, `x/y` on a flow child are meaningless-but-
  stored (bugs 2-3). That is a model wart: either `move` should be rejected for flow
  children (making the op layer honest), or flow children should store order only and
  drop x/y (making the document smaller and the native backend simpler). Today's
  in-between state is where bugs breed.

---

## Recommended next 3

1. **Fix `reparent` index semantics and make the op layer AI-safe** (bugs 1, 4 + op
   round-trip tests). One convention (post-detach indexes), default computed
   consistently, `tree` either made required-when-children-exist or validated, and
   property tests for `apply∘invert = id` and `apply(reparent) → expected order` across
   all 6 forward/backward × same/cross-parent cases. Cheap, unblocks everything below,
   and de-risks the AI-assistant premise before it is load-bearing.
2. **Close the arrangement loop: container-aware drop, reorder, and honest flow
   gestures** (bugs 2, 3 + missing 1, 3, 4). Hit-test `[data-loom-id]` hosts on drop,
   wire drop/reorder to the now-correct `reparent`, cancel gestures on undo/Escape,
   and add the `setFlow` inspector toggle. This is what turns "components appear" into
   "a layout can be authored" — the actual product.
3. **Save/load to disk.** Serialize/validate/restore the Document (`normalizeProps`
   already guards load-time normalization; wire it to an Electron dialog +
   `beforeunload` dirty check). Small, and it converts every other feature from
   "demo" to "tool" — including making the two-target claim testable against real
   files.

---

## Untested-but-expensive (assertions to add to `electron/selftest.ts`)

Current suite: 29 checks, all passing — good on normalization, dup-linking, and flow
regressions. Missing, highest cost-of-getting-wrong first:

1. `reparent to end of same parent` → children equal `[b,c,a]` for `[a,b,c]`
   (currently FAILS — bug 1).
2. `reparent forward with explicit index from visible list` → documented convention
   holds for all 4 quadrant cases (same/cross parent × forward/backward).
3. `apply(apply(d, op), invert(d, op))` preserves `JSON.stringify(d)` for every op
   kind, including `remove` of a 3-deep subtree and `reparent` across parents.
4. `insert` with `node.children` non-empty and no `tree` is **rejected** (or fills from
   nowhere) — currently silently orphans (bug 4).
5. `undo` during an unsealed gesture leaves history length unchanged and doc equal to
   `entry.before` (pins bug 5's expected behavior once cancellation exists).
6. `move` of a flow child is rejected (or triggers reorder) — pins the fix for bug 2.
7. `setProp` of an undeclared key leaves props unchanged (normalizeProps drops it on
   clone — assert the store path, not just insert).
8. History exhaustion: 201 distinct commits → `undo()` 200 times lands exactly on the
   initial doc, and commit #201 is the first unrecoverable one (documents the
   silent-loss boundary).
9. `remove` of root leaves selection untouched (bug 6, post-fix expectation).
10. `addMany` then `undo` restores node count exactly (the batch path is new and
    untested).
