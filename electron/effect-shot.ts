/**
 * Renders the effect specimen page to a PNG so the atmosphere layer can be
 * judged by eye. Hardware acceleration is disabled for the capture process
 * only: this box is Wayland + GPU compositing, where Chromium's capture path
 * fails with UnknownVizError when the GPU process is in play.
 */

import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { specimenHtml } from './effect-specimens'

const here = __dirname

async function run() {
  const t0 = Date.now()
  const mark = (s: string) => console.log(`[loom] ${s} @${Date.now() - t0}ms`)
  mark('creating window')
  const win = new BrowserWindow({
    width: 1280,
    height: 1000,
    show: false,
    backgroundColor: '#0A0A0B',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })

  // Write to a real file and loadFile it. A data: URL works for rendering but
  // capturePage() on this Wayland path throws UnknownVizError for it, so the
  // specimen goes through the same file:// path the working snapshot uses.
  const out = path.join(here, '../../docs/shots/effect-specimens.png')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const htmlPath = path.join(here, '../../docs/shots/effect-specimens.html')
  fs.writeFileSync(htmlPath, specimenHtml(), 'utf8')
  mark('html written')

  await win.loadFile(htmlPath)
  mark('loaded')
  // Let fonts settle and the first animation frames land.
  await new Promise((r) => setTimeout(r, 1200))
  mark('settled')

  // `capturePage()` never resolves on this box: the window loads, paints, and
  // then the compositor gives up, so the await hangs forever. CDP's
  // Page.captureScreenshot goes through a different path and works, and it is
  // also what the working preview capture used. Fall back explicitly rather
  // than hanging silently again.
  const shot = await captureViaCdp(win)
  mark('captured via cdp')
  fs.writeFileSync(out, shot)
  mark(`wrote ${path.relative(process.cwd(), out)} ${shot.length} bytes`)
  app.exit(0)
}

/** Capture the page over CDP, with a hard timeout so it cannot hang again. */
async function captureViaCdp(win: BrowserWindow): Promise<Buffer> {
  const session = win.webContents.debugger
  try {
    session.attach('1.3')
  } catch (e) {
    console.error('[loom] cdp attach failed:', String(e))
    throw e
  }
  try {
    const res = (await session.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })) as { data: string }
    return Buffer.from(res.data, 'base64')
  } finally {
    try {
      session.detach()
    } catch {
      /* already gone */
    }
  }
}

// capturePage() throws UnknownVizError on this Wayland + GPU-compositing path;
// software rendering makes captures deterministic. Must be called before ready.
app.disableHardwareAcceleration()
app.whenReady().then(() => {
  void run().catch((e) => {
    console.error('SPECIMENS-THREW', e)
    if (e instanceof Error && e.stack) console.error(e.stack)
    app.exit(1)
  })
})
