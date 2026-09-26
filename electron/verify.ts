/**
 * Main-process entry for the verification harness.
 *
 * Boots the renderer, runs the self-test inside it, prints the JSON report to
 * stdout, and exits with a non-zero code if anything failed. Separate from
 * `main.ts` so the app itself never carries test code.
 */

import { app, BrowserWindow } from 'electron'
import path from 'node:path'

const here = __dirname

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
    'window.__runSelfTest ? window.__runSelfTest() : "MISSING"',
    true,
  )

  const rendererErrors = errors.filter((e) => e.startsWith('RENDER-ERR:'))
  console.log(report)
  if (rendererErrors.length) {
    console.log(JSON.stringify({ rendererErrors }, null, 2))
  }

  let ok = false
  try {
    ok = JSON.parse(report as string).allPass === true
  } catch {
    ok = false
  }
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
