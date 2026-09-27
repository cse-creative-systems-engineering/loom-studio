/**
 * Main-process entry for the verification harness.
 *
 * Boots the renderer, runs the self-test inside it, prints the JSON report to
 * stdout, and exits with a non-zero code if anything failed. Separate from
 * `main.ts` so the app itself never carries test code.
 */

import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

const here = __dirname

/**
 * Source-level invariants the renderer cannot check.
 *
 * These read the actual shipped files, so they fail if someone reintroduces a
 * sample project on the launch path — the kind of regression no unit test in
 * the page would ever notice, because the page is not what launches itself.
 */
function sourceChecks(): Array<{ name: string; pass: boolean; detail: string }> {
  const read = (rel: string): string => {
    try {
      return fs.readFileSync(path.join(here, '..', '..', rel), 'utf8')
    } catch (e) {
      return ''
    }
  }
  const entry = read('src/main.tsx')
  const main = read('electron/main.ts')

  // The only seedDemo call may live inside the explicit `demo === '1'` guard.
  const guarded =
    /get\('demo'\) === '1'\) \{\s*seedDemo\(store\)/.test(entry) ||
    /demo'\) === '1'\)\s*\{[\s\S]{0,80}?seedDemo\(store\)/.test(entry)
  const unguarded = entry.replace(/if\s*\([\s\S]*?\)\s*\{[\s\S]*?\}/, '').includes('seedDemo(store)')

  return [
    {
      name: 'the renderer entry seeds only behind the explicit demo flag',
      pass: guarded && !unguarded,
      detail: `guarded=${guarded} unguarded=${unguarded}`,
    },
    {
      name: 'the main process only requests the demo when LOOM_DEMO=1',
      pass: /process\.env\.LOOM_DEMO === '1'/.test(main),
      detail: '',
    },
    {
      name: 'no sample project is restored at launch',
      pass: !/restoreAutosave\(\)/.test(entry) && !/restoreAutosave\(\)/.test(main),
      detail: 'autosave restore must never run unattended',
    },
  ]
}

async function run() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const errors: string[] = []
  win.webContents.on('console-message', (_e, _lvl, message) => {
    if (message) errors.push(message)
  })

  await win.loadFile(path.join(here, '../renderer/index.html'))

  const report = await win.webContents.executeJavaScript(
    'window.__runSelfTest ? window.__runSelfTest().then(r => r, e => JSON.stringify({threw: e.message, stack: e.stack})) : "MISSING"',
    true,
  )

  const rendererErrors = errors.filter((e) => e.startsWith('RENDER-ERR:'))
  // Merge the main-process source checks into the one report, so a single
  // `npm run verify` covers behaviour AND the launch path.
  let parsed: {
    threw?: string
    checks?: Array<{ name: string; pass: boolean; detail: string }>
    allPass?: boolean
  } | null = null
  try {
    parsed = JSON.parse(report as string)
  } catch {
    parsed = null
  }
  // A THROW is a failure, full stop. Without this the merge below would report
  // the source checks alone and print allPass: true for a suite that never ran —
  // a harness that lies is worse than no harness.
  if (!parsed || typeof parsed.threw === 'string') {
    console.log(JSON.stringify({
      threw: parsed?.threw ?? 'the self-test did not return a report',
      stack: (parsed as { stack?: string } | null)?.stack ?? '',
      sourceChecks: sourceChecks(),
    }, null, 2))
    app.exit(1)
    return
  }
  const extra = sourceChecks()
  if (parsed) {
    parsed.checks = [...(parsed.checks ?? []), ...extra]
    const passed = parsed.checks.filter((c) => c.pass).length
    parsed.allPass = passed === parsed.checks.length
    console.log(JSON.stringify({ ...parsed, passed, total: parsed.checks.length }, null, 2))
  } else {
    console.log(report)
    console.log(JSON.stringify({ sourceChecks: extra }, null, 2))
  }
  if (rendererErrors.length) {
    console.log(JSON.stringify({ rendererErrors }, null, 2))
  }

  const ok = parsed ? parsed.allPass === true && rendererErrors.length === 0 : false
  app.exit(ok && rendererErrors.length === 0 ? 0 : 1)
}

app.whenReady().then(() => {
  void run().catch((e) => {
    // Print the real stack: "Cannot read properties of null" without a frame is
    // useless, and guessing at it is how bugs get "fixed" in the wrong place.
    console.error('SELFTEST-THREW', e)
    if (e instanceof Error && e.stack) console.error(e.stack)
    app.exit(1)
  })
})
