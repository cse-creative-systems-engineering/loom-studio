/**
 * Layout probe for the peek preview.
 *
 * Verifies the miniature stays INSIDE its own column: the rendered stage
 * (after the CSS scale) must be no wider and no taller than the panel body.
 * This is the check that catches a preview overlapping the canvas.
 */

import { app, BrowserWindow } from 'electron'
import path from 'node:path'

const here = __dirname

// Software rendering keeps geometry deterministic for measurement. Must be
// called before app is ready.
app.disableHardwareAcceleration()

async function run() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  await win.loadFile(path.join(here, '../renderer/index.html'), { search: 'demo=1' })
  await new Promise((r) => setTimeout(r, 1200))

  const report = (await win.webContents.executeJavaScript(
    'window.__loomLayoutProbe ? window.__loomLayoutProbe() : "MISSING"',
  )) as Array<{ name: string; pass: boolean; detail: string }> | string

  if (typeof report === 'string') {
    console.log(report)
    app.exit(1)
    return
  }

  let failed = 0
  for (const r of report) {
    if (!r.pass) failed++
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`)
  }
  console.log(`\n${report.length - failed}/${report.length} layout checks passed`)
  app.exit(failed === 0 ? 0 : 1)
}

app.whenReady().then(() => {
  void run().catch((e) => {
    console.error('PROBE-THREW', e)
    app.exit(1)
  })
})
