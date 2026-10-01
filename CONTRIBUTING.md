# Contributing to Loom Studio

Loom is being built in the open, and you are invited: **fork it, branch it,
break it, and tell us what you find.** Bug reports, tool critiques, design
ideas and pull requests are all welcome.

## Try it

```bash
git clone https://github.com/cse-creative-systems-engineering/loom-studio.git
cd loom-studio
npm install
npm start            # build and launch the desktop app
npm run dev          # or the renderer alone in a browser, on :5178
```

## Talk to us

- **Discussions:** ideas, questions, show-and-tell (share what you built
  and the export it produced).
- **Issues:** bugs, and "this tool falls short" reports. The templates ask
  for what makes them actionable.
- Every tool is held to the bar in
  [`docs/component-depth.md`](docs/component-depth.md). If a tool misses it,
  that is exactly the issue we want.

## Fork, branch, pull request

1. Fork the repo and create a branch from `master` (`yourname/what-it-does`).
2. Make the change. Match the surrounding code: its naming, its comment
   style, its idioms. Comments say *why*, not *what*.
3. Run the checks. A pull request with a red check will not be merged.
   ```bash
   npm run typecheck
   npm run verify          # the self-test, ~1100 checks in a real renderer
   ```
   If you touched the canvas, the preview or dragging, also run the probes:
   `npm run probe:preview`, `npm run probe:layout`, `npm run probe:drag`.
4. Add a self-test check for what you changed (`electron/selftest.ts`). The
   suite is how Loom keeps its promises: every property changes the output,
   every area is styleable, and canvas, preview and export agree.
5. Open the pull request with a short description of what changed and why,
   plus a screenshot for anything visible.

## The rules the codebase enforces

These are checked by the self-test, so they are not just preferences:

- **What you see is what ships.** The canvas, Preview and every export
  render through the same code.
- **No control lies.** Every property and list field must visibly change
  the output (the property audit).
- **Every area is styleable.** Anything a tool draws is a named part
  (the area audit).
- **Whatever a UI can do on its own, a Loom UI does.** Controls work in the
  export, keyboard included.
- **Old files keep opening.** A rename migrates, and the migration is
  reported.

## License of contributions

Loom Studio is source-available under the
[PolyForm Noncommercial License 1.0.0](LICENSE): free to use, test, study,
fork and modify for any **noncommercial** purpose, while it is in
development.

By submitting a contribution you agree that it is licensed under the same
terms, and that the project maintainer may also distribute it under other
license terms in the future (for example, if Loom Studio is later offered
commercially or under an open-source license).

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
