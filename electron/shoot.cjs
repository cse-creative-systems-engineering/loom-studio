// Off-screen screenshots of pages for review pages and before/after pairs.
//
//   xvfb-run -a npx electron electron/shoot.cjs shots.json
//
// shots.json: [{ "url": "...", "out": "file.png", "width": 1240, "height": 900,
//               "js": "optional setup script, may return a promise", "full": true }]
// `full` grows the window to the page's height before capturing.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

const shots = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const within = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(`timed out: ${what}`) })])

app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  for (const s of shots) {
    const win = new BrowserWindow({ show: false, width: s.width ?? 1240, height: s.height ?? 900, webPreferences: { offscreen: true } })
    try {
      // A page that rewrites itself (document.write) reads as an aborted load,
      // so the load is awaited loosely and the page given time to settle.
      win.loadURL(s.url).catch(() => undefined)
      await sleep(s.wait ?? 2500)
      if (s.js) await within(win.webContents.executeJavaScript(s.js, true), 10000, 'setup')
      await sleep(700)
      if (s.full) {
        const h = await within(win.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)'), 5000, 'height')
        win.setContentSize(s.width ?? 1240, Math.min(h, 6000))
        await sleep(900)
      }
      const img = await within(win.webContents.capturePage(), 10000, 'capture')
      fs.writeFileSync(s.out, img.toPNG())
      console.log('wrote', s.out, JSON.stringify(img.getSize()))
    } catch (e) {
      console.log('FAILED', s.out, String(e))
    }
    win.destroy()
  }
  app.quit()
})
