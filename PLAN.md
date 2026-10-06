# Loom — build plan

Status: in progress. This file is the source of truth for what "done" means.

## Decision: Atelier is archived

Atelier was Shane's first attempt. Loom kept the ideas worth keeping (snap
guides, the effects defaults, token bundles as data) and dropped the rest:
the Atelier DSL importer/exporter, the embedded `component-dsl.json` and the
`embed:bundle` build step are gone (see git history before
`claude/drop-atelier-bundle` to recover them).

## Phases

| # | Phase | State |
|---|-------|-------|
| 1 | Foundations: scene tree, named ops, schema registry, transient manipulation | done |
| 2 | Editor core: canvas, toolbox, inspector, resize, context menu, drop-into-container, lock, duplicate, reorder, delete/nudge keys | done |
| 3 | Output quality: themes, effects layer, component quality | done — effects live in both render paths |
| 4 | Token bundles (theme as data) | done — Atelier DSL interchange archived |
| 5 | Desktop backend: native widget compiler | pending |
| 6 | AI assistant over the op set | pending |
| 7 | Adversarial review rounds until clean | pending |

## Definition of done

- Every phase above shipped and tested.
- Adversarial review (UI/UX, functionality, output quality) run against the
  final build; every severity-1 finding fixed and covered by a test.
- A real user can open Loom, build a UI, save it, close, reopen, and export it
  to a working artifact — without hitting a bug.

## Rules I am holding myself to

- Never claim UI state I have not measured. Probes, not assertions.
- Every fix gets a test. A fix without one is a guess with extra steps.
- A component prop that does nothing is a bug, not a placeholder.
- Report failures honestly, including my own.

## Known gaps (as of 232/232)

- **Screenshot capture is broken on this box.** `capturePage()` never
  resolves, CDP `Page.captureScreenshot` hangs on attach, and `--headless
  --screenshot` writes nothing. The window loads and paints; only capture
  fails, so this is the Wayland compositor, not the app. Visual review
  currently has to come from Shane or from DOM/computed-style probes.
  `electron/effect-specimens.ts` generates the specimen page for when capture
  works again.
- **Effects are not yet exposed in the inspector.** They are stored per node
  and rendered — but there is no UI to
  toggle them. Until there is, a user cannot reach the feature.
- **`magnet` is a transform input, not a prop.** It has no on/off flag, so
  nothing can enable it. Deliberate for now; noted so it does not get
  mistaken for a working feature.
- **The desktop backend does not exist.** The registry has capability gating
  (`DESKTOP_CAPABILITIES`) but no native emitter.
- **No AI assistant surface.** The ops are ready to be grounded on;
  nothing consumes them yet.
