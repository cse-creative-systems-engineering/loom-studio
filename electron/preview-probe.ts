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
// Side effect: registers the REAL preview/save IPC handlers from main.ts,
// so this probe drives production code, not a copy.
import './main'

// The editor window main.ts creates loads the seeded demo scene. It must be
// THAT window the probe drives: preview IPC is honoured only from the editor
// window main.ts registered (see `fromEditor`), so a second window of the
// probe's own is refused, which is how this probe went red after the IPC
// guard landed. Set before `whenReady`, when main.ts reads it.
process.env.LOOM_DEMO = '1'

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

  let win: BrowserWindow | undefined
  for (let i = 0; i < 60 && !win; i++) {
    win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'))
    if (!win) await new Promise((r) => setTimeout(r, 250))
  }
  if (!win) throw new Error('main.ts created no editor window')
  if (win.webContents.isLoading()) await new Promise((r) => win?.webContents.once('did-finish-load', () => r(undefined)))
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
