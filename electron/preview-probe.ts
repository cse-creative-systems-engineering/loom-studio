/**
 * Live-preview probe (main process).
 *
 * Drives the REAL editor window + preview window the way the UI does and
 * asserts the loop end to end: open shows the current document, a pushed
 * update reaches the already-open window without reopening it, and close
 * destroys it. No pixels involved — DOM text assertions only, so it runs
 * headless. Usage: `npm run probe:preview` (builds first).
 */

import { app, BrowserWindow } from 'electron'
import path from 'node:path'
// Side effect: registers the REAL preview/save IPC handlers from main.ts,
// so this probe drives production code, not a copy.
import './main'

const here = __dirname

interface Step {
  name: string
  pass: boolean
  detail: string
}

async function run() {
  const steps: Step[] = []
  const step = (name: string, pass: boolean, detail = '') => {
    steps.push({ name, pass, detail })
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  await win.loadFile(path.join(here, '../renderer/index.html'), { search: 'demo=1' })
  await new Promise((r) => setTimeout(r, 1500))

  const hasBridge = await win.webContents.executeJavaScript('Boolean(window.loomPreview && window.__loomStore)', true)
  step('editor exposes preview bridge + store', hasBridge === true)

  const docJson = await win.webContents.executeJavaScript('JSON.stringify(window.__loomStore.doc)', true)
  step('editor holds a seeded document', typeof docJson === 'string' && (docJson as string).includes('Telemetry Console'),
    `${(docJson as string).length} bytes`)

  const previewWindows = () =>
    BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.getTitle() === 'Loom — Live Preview')

  // Open with the live doc.
  await win.webContents.executeJavaScript(`window.loomPreview.open(${docJson as string})`, true)
  await new Promise((r) => setTimeout(r, 1500))
  const opened = previewWindows()
  step('preview window opens', opened.length === 1, `${opened.length} preview window(s)`)
  const pv = opened[0]

  if (pv) {
    const text = await pv.webContents.executeJavaScript(
      `document.querySelector('.pvwin-stage')?.textContent?.slice(0, 120) ?? 'NO-STAGE'`,
      true,
    )
    step('preview shows the document content', typeof text === 'string' && (text as string).includes('Telemetry Console'),
      String(text).slice(0, 80))

    // Frameless contract: just the built UI plus a floating control pill —
    // no header bar, no window decorations inside the page.
    const chrome = await pv.webContents.executeJavaScript(
      `({ float: Boolean(document.querySelector('.pvwin-float')), bar: Boolean(document.querySelector('.pvwin-bar')),
         close: Boolean(document.querySelector('.pvwin-float [title="Close preview"]')) })`,
      true,
    ) as { float: boolean; bar: boolean; close: boolean }
    step('preview has floating controls', chrome.float === true)
    step('preview has no header bar', chrome.bar === false)
    step('floating controls can close', chrome.close === true)

    // Live update through the dedicated update channel: rename, push,
    // preview must follow WITHOUT a new window and WITHOUT focusing.
    // Replace ALL occurrences (meta.name plus node text) — asserting the
    // stage proves content flows.
    const renamed = (docJson as string).split('Telemetry Console').join('Renamed Live')
    const hasUpdate = await win.webContents.executeJavaScript('Boolean(window.loomPreview.update)', true)
    step('preview update channel exists', hasUpdate === true)
    await win.webContents.executeJavaScript(`window.loomPreview.update(${renamed})`, true)
    await new Promise((r) => setTimeout(r, 800))
    const after = previewWindows()
    const text2 = await pv.webContents.executeJavaScript(
      `document.querySelector('.pvwin-stage')?.textContent?.slice(0, 120) ?? 'NO-STAGE'`,
      true,
    )
    step('live update reaches the open window', (text2 as string).includes('Renamed Live'), String(text2).slice(0, 80))
    step('update does not reopen the window', after.length === 1 && after[0] === pv && !pv.isDestroyed())

    await win.webContents.executeJavaScript('window.loomPreview.close()', true)
    await new Promise((r) => setTimeout(r, 800))
    step('close destroys the preview window', previewWindows().length === 0 && pv.isDestroyed())
  }

  const failed = steps.filter((s) => !s.pass).length
  console.log(`\n${steps.length - failed}/${steps.length} preview probe steps pass`)
  app.exit(failed === 0 ? 0 : 1)
}

app.whenReady().then(() => {
  void run().catch((e) => {
    console.error('PREVIEW-PROBE-THREW', e)
    app.exit(1)
  })
})
