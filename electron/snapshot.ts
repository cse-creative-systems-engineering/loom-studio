/**
 * Screenshot harness.
 *
 * Renders the app with a seeded demo scene and writes a PNG. Exists so the
 * review agents (and a human) look at the real product rather than inferring
 * it from source. Usage: `npm run shot`
 */

import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

const here = __dirname
const out = process.env.LOOM_SHOT ?? path.join(here, '../../docs/shots/loom-editor.png')

// capturePage() throws UnknownVizError on this Wayland + GPU-compositing path.
// Software rendering makes captures deterministic; this process never shows a
// window, so there is no cost to the real app. Must be called before ready.
app.disableHardwareAcceleration()

async function run() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0b0d13',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })

  await win.loadFile(path.join(here, '../renderer/index.html'), { search: 'demo=1' })
  // Let fonts, layout, and the seeded scene settle.
  await new Promise((r) => setTimeout(r, 1200))

  const image = await win.webContents.capturePage()
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, image.toPNG())
  console.log(`SHOT ${out} ${image.getSize().width}x${image.getSize().height}`)
  app.exit(0)
}

app.whenReady().then(() => {
  void run().catch((e) => {
    console.error('SHOT-THREW', e)
    app.exit(1)
  })
})
