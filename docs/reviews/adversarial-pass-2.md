# Loom — Adversarial Pass 2 (loader, renderer hardening, output tokens)

Reviewed: 2026-09-26, ~16:30–17:00 EDT. Scope: everything the first three
reviews did not cover or that changed since: `src/export/html.ts`,
`src/model/persist.ts`, `src/model/registry.ts`, `src/render/web.tsx` (111
components), `src/render/theme.ts`, `src/state/store.ts` (`seal`, `remove`),
`src/app.tsx` (`supportedIn`), `electron/selftest.ts` (§26–§29).

**Review-pin caveat.** A sibling session edited this repo during the pass
(selftest §26–§27 and the `seal` deep-compare fix landed mid-pass; one
verify run raced a half-saved tree and went 115/116 on a since-corrected
assertion). Every DEMONSTRATED item below was reproduced against the current
tree with probes in `/tmp/opencode/` (esbuild-bundled model code run under
plain node, plus the Electron verify suite). Baseline at pass start:
typecheck clean, verify 116/116. End state: typecheck clean, verify
132/132 (2 consecutive runs).

Method: (1) static audit — every `default:` branch, every `#fff`/hex
literal in the output path, every `catch`, every `return null`, the
capability-gating duplication flagged in review 1 §9; (2) dynamic hostile
probes — wrong-typed props, NaN/Infinity geometry, a 50k-node chain, a
shared-subtree diamond DAG, hostile enums, contrast-ratio math; (3) fixes
with regression checks in selftest §29 (16 checks).

---

## Verdict

Seven demonstrated findings, all fixed with regression tests. The worst two
were loader-side denial-of-service class: a crafted file with ~600 chained
nodes froze the app on open (superlinear validation, measured 16s at 600 and
extrapolating to hours), and a 49-node diamond DAG rendered 126MB of HTML
(exponential shared-subtree visits). Both are closed — validation is O(n),
single-parent is enforced, depth is capped. The remaining five were
correctness/contrast gaps, including two WCAG AA failures on fill text.

---

## Confirmed + fixed

### 1. DEMONSTRATED — `validate()` never normalized props: missing, undeclared, and mistyped props loaded silently

- **Repro** (model probe): seed a doc, delete `Panel.gap`, add `bogusProp: 99`,
  set `padding: 'wide'`, validate.
- **Observed**: missing key stays missing, undeclared key kept, wrong type
  kept — `issues: []`. The store then holds nodes no schema path would ever
  produce (selftest §9's insert-time guarantees do not apply to the load
  path), and the inspector/renderer disagree about fallbacks per use-site.
- **Fix**: new `registry.validateProps()` — the strict trust-boundary
  twin of lenient `normalizeProps()`. Missing → default (silent);
  present-but-wrong-type → default + issue (`expected finite number, got
  "wide"`); undeclared → dropped + issue; geometry kept only when finite.
  `persist.validate()` runs it per node. Good docs stay issue-free
  (§22 green). Type rules: string/color accept any string (named CSS colors
  and csv lists are legitimate), number requires finite, boolean requires
  boolean, enum requires membership.
- **Severity**: medium — silent invalid state at the trust boundary.

### 2. DEMONSTRATED — non-finite geometry emitted invalid CSS (`NaNpx`)

- **Repro**: `setProp x = NaN`, `y = Infinity` (reachable today via the
  untyped op path the AI assistant will drive), export.
- **Observed**: stylesheet contains `NaNpx` / `Infinitypx` — fails silently
  in the browser. `num()` already guarded `isFinite`; `px()` did not.
- **Fix**: `px()` requires finite numbers, else the fallback. One line.
- **Severity**: low-medium; defense-in-depth alongside finding 1 (the
  loader now also drops non-finite geometry with an issue).

### 3. DEMONSTRATED — `validate()` cycle check was superlinear: crafted deep file freezes the app on open

- **Repro**: chains of N Panels, timed: N=100 → 78ms, N=300 → 2039ms,
  N=600 → 16280ms (≈cubic — per-start ancestry walks over O(n) parent
  scans). N=2000 extrapolates to hours. Validation runs synchronously in
  the renderer on open: the app hangs with no error and no recovery.
- **Fix**: rewrote the graph phase as (a) edge filter, (b) single-parent
  enforcement, (c) ONE iterative DFS from root for reachability + depth
  truncation, (d) orphan sweep. All O(n); no recursion anywhere in the
  loader. Measured after: N=300 → 3ms clean, N=2000 → 17ms,
  N=20000 → 138ms.
- **Severity**: high — remotely-sharable file → local DoS.

### 4. DEMONSTRATED — shared-subtree DAG rendered exponentially (49 nodes → 126MB HTML)

- **Repro**: diamond with shared fan-out nodes (`a_i,b_i → s_i →
  a_{i+1},b_{i+1}`), depth 16, 49 nodes total. Old loader accepted it with
  1 unrelated issue; `emitHtml` produced **126,615,235 bytes in 6.7s**
  (×16 per +4 levels — 2^depth). In-app this freezes the renderer tab;
  deeper goes OOM.
- **Fix**: the loader now enforces a tree — each child has exactly one
  parent, first claimant in file order wins, extras dropped with issues.
  This is provably sufficient: single-parent ⇒ in-degree ≤ 1 ⇒ any directed
  cycle is unreachable-from-root ⇒ the orphan sweep removes it ⇒ the
  rendered graph is a finite tree and renderer recursion always terminates.
  Same diamond now: tree invariant holds, 14KB output. No separate cycle
  pass remains (it would be dead code — documented at the site).
- **Severity**: high — same file-sharing threat as finding 3.

### 5. DEMONSTRATED — depth policy missing: valid ultra-deep trees overflow the render stack

- A 50k-deep *valid* chain passes even linear validation, then `renderNode`
  recursion overflows the stack and unmounts the whole app (no error
  boundary). Fixing finding 3 without this would have converted "hang on
  open" into "crash on open".
- **Fix**: `MAX_TREE_DEPTH = 512` (exported from `persist.ts`): edges past
  it are truncated with an issue and the detached subtree is deleted
  eagerly so the orphan sweep stays quiet. 512 is generous for any real UI
  and trivially safe for recursion. A 2000-chain loads as 513 nodes + 1
  issue, verified.
- **Severity**: medium — only reachable via crafted files, now closed.

### 6. DEMONSTRATED (measured) — fill text fails WCAG AA on two of three themes

- **Math** (relative luminance): white on midnight `#5b8cff` = **3.16:1**,
  white on contrast `#7ea6ff` = **2.39:1** (AA floor for UI text: 4.5:1).
  Daylight `#2f5fe0` passes at 5.48:1. Twelve `color: '#fff'` literals in
  `web.tsx` ignored the theme entirely — the token layer had no
  on-fill role.
- **Fix**: new `textOnAccent` token — midnight `#0b0d13` (6.05:1),
  daylight `#ffffff` (5.48:1, unchanged look), contrast `#0a0f1c` (8.00:1).
  All fill-text sites (Button/IconButton/DropdownButton/ToggleButton/
  Avatar/AvatarGroup/Calendar/Stepper/Confirm/Pagination) now use it;
  `ColorInput` invalid-value fallbacks use `t.accent` instead of a hardcoded
  `#5b8cff`. Deliberately NOT changed: the Switch knob (physical
  affordance, not text) and pie-slice data colors (no text seated on them).
- **Severity**: medium — a11y failure in shipped output; also changes the
  midnight primary-button look (white → near-black text), which is the
  correct call at 6.05:1.

### 7. Still present from review 1, fixed now — `remove()` cleared selection on refused delete; `supportedIn` duplicated capability arrays

- `store.remove([root])` refused the op then unconditionally `select([])` —
  inspector flips to "Nothing selected" on an untouched document (review 1
  §6). Fix: clear only when `commitAll` reports success; success-path
  behavior unchanged.
- `app.tsx:supportedIn` hand-copied the capability arrays instead of using
  `registry.propSupported` (review 1 §9c). Fix: one-line delegation; the
  duplicate arrays are gone, divergence impossible.
- **Severity**: low (both), fixed while in the area with regression tests.

---

## Audited and deliberately left alone

- **`meta.targets` is write-only.** `persist` stores it, nothing reads it
  (`store.target` is separate UI state) — hostile values are inert. Left;
  flagging so the desktop emitter (future) sanitizes when it first consumes
  the field.
- **`normalizeProps` (in-memory path) stays lenient.** UI controls produce
  correctly-typed values; strictness lives at the file boundary
  (`validateProps`). Changing insert semantics would risk the hot path for
  no demonstrated gain.
- **Old-cycle message removed.** The previous `cycle involving A -> B`
  repair is subsumed: reachable cycles surface as `already has a parent`,
  unreachable ones as `orphaned`. No test asserted the old string.
- **Dangling references now report issues** (previously silent drops) —
  matches the documented "dropped with an issue" contract; no test depended
  on the silence.
- **`parentOf` O(n) (review 1 §7) and undo-mid-gesture (review 1 §5)
  untouched** — performance wall and gesture-cancellation remain future
  work, not robustness holes demonstrated today.

---

## Coverage added (selftest §29, 16 checks; suite 116 → 132)

Loader repair (missing/undeclared/mistyped/NaN-geometry), 300-chain clean,
2000-chain truncated-fast, single-parent invariant + linear diamond render,
mutual-cycle finite render, authoring plain+selected for all 111 with hooks
present, root-delete keeps selection, `textOnAccent` defined everywhere and
wired in contrast export. Suite green twice consecutively post-change.

---

## Recommended next 3 (unchanged from prior reviews, re-prioritized)

1. **Desktop/native emitter** — export v1 is web-only; the capability
   taxonomy leaks noted in review 1 §9 still await a real consumer.
2. **Gesture cancellation** (review 1 §5) — `store.cancelTransient()` +
   Escape/undo-mid-drag handling.
3. **`parentOf` index** (review 1 §7) — parent map maintained by `apply()`
   before documents grow; render is O(n²) per frame today.
