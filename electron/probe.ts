/**
 * Reparent index probe.
 *
 * Reproduces the bug the functionality review demonstrated: reparenting to the
 * END of the current parent landed one slot short. Kept separate from the
 * layout probe because reparent index conventions are the easiest thing in
 * this codebase to get subtly wrong and the hardest to notice by eye.
 */

import { app, BrowserWindow } from 'electron'
import path from 'node:path'

const here = __dirname

async function run() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  await win.loadFile(path.join(here, '../renderer/index.html'))
  await new Promise((r) => setTimeout(r, 600))

  const report = await win.webContents.executeJavaScript(
    'window.__loomProbe ? window.__loomProbe() : "MISSING"',
  )

  if (typeof report === 'string') {
    console.log(report)
    app.exit(1)
    return
  }

  const cases = report as Array<{ case: string; got?: string[]; restored?: string[]; want: string[] }>
  let failed = 0
  for (const r of cases) {
    const got = r.got ?? r.restored ?? []
    const ok = JSON.stringify(got) === JSON.stringify(r.want)
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.case}`)
    if (!ok) {
      console.log(`      got  ${JSON.stringify(got)}`)
      console.log(`      want ${JSON.stringify(r.want)}`)
    }
  }
  console.log(`\n${cases.length - failed}/${cases.length} reparent cases correct`)
  app.exit(failed === 0 ? 0 : 1)
}

app.whenReady().then(() => {
  void run().catch((e) => {
    console.error('PROBE-THREW', e)
    app.exit(1)
  })
})
