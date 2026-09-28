/**
 * Electron main process.
 *
 * Chromium flags are appended BEFORE app.whenReady() so the HTML-in-Canvas
 * experiment is available to the renderer. Enable it when you want to start
 * the GPU paint strategies; the plain-DOM path does not need it.
 */

import { app, BrowserWindow, dialog, ipcMain, screen, shell, type IpcMainInvokeEvent } from 'electron'
import { desktopBounds, type RunTarget } from '../src/model/desktop-run'
import { startAiSocket, type AiSocket } from './ai-socket'
import path from 'node:path'
import fs from 'node:fs/promises'
import { autosaveFileName, isExternalUrlAllowed } from './guards'

// This file is bundled to CommonJS for Electron's main process, where
// `import.meta.url` does not exist. esbuild passes `__dirname` through, so the
// CJS global is the right source for the base path here.
const here = __dirname

const EXPERIMENTAL = process.env.LOOM_EXPERIMENTAL === '1'

if (EXPERIMENTAL) {
  app.commandLine.appendSwitch('enable-features', 'CanvasDrawElement')
  app.commandLine.appendSwitch('enable-experimental-web-platform-features')
}

/**
 * Every window is locked to the page it was loaded with.
 *
 * A designed document can carry any link, and a window that navigates to a
 * remote page KEEPS the preload bridge — so a hostile file plus one click in
 * the preview would hand a web page `loomHost`. Navigation is therefore always
 * refused, and a link the OS can safely open goes to the real browser instead.
 * Programmatic `loadFile`/`loadURL` do not emit `will-navigate`, so the app's
 * own page loads are unaffected.
 */
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (isExternalUrlAllowed(url)) void shell.openExternal(url)
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrlAllowed(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
})

/**
 * The editor window. File and preview-control IPC is honoured only from it:
 * the preview window loads the same preload, and it must not be able to save,
 * open or autosave on the document's behalf.
 */
let editorWin: BrowserWindow | null = null

function fromEditor(e: IpcMainInvokeEvent): boolean {
  return editorWin !== null && !editorWin.isDestroyed() && e.sender === editorWin.webContents
}

const FORBIDDEN = { ok: false, error: 'forbidden' } as const

/**
 * Asked when the editor is closed with unsaved changes; true closes anyway.
 *
 * The page's `beforeunload` guard, on its own, made Electron keep the window
 * open WITHOUT asking: with unsaved changes the window simply would not close.
 * Closing must always be possible, so the question is a native dialog whose
 * default answer is to close. The probes swap in an answer (they cannot click
 * a native dialog).
 */
let closePrompt = (win: BrowserWindow): boolean =>
  dialog.showMessageBoxSync(win, {
    type: 'warning',
    title: 'Unsaved changes',
    message: 'This workspace has unsaved changes.',
    detail: 'Close Loom without saving them?',
    buttons: ['Close without saving', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }) === 0

/** Test hook for the probes: answer the unsaved-changes question. */
export function setClosePromptForProbe(answer: (win: BrowserWindow) => boolean): void {
  closePrompt = answer
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0b0d13',
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  editorWin = win
  // The page cancelled unloading (unsaved changes). Ask; calling
  // preventDefault here overrides the page and lets the window close.
  win.webContents.on('will-prevent-unload', (event) => {
    if (closePrompt(win)) event.preventDefault()
  })
  win.on('closed', () => {
    if (editorWin === win) editorWin = null
  })
  win.once('ready-to-show', () => win.show())

  const devUrl = process.env.LOOM_DEV_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    // LOOM_DEMO=1 is a TEST HOOK for the E2E probes, not a product setting: a
    // person launching Loom normally gets an empty workspace and places their
    // own first node. Nothing here ever seeds a document on its own.
    const demo = process.env.LOOM_DEMO === '1'
    void win.loadFile(
      path.join(here, '../renderer/index.html'),
      demo ? { search: 'demo=1' } : undefined,
    )
  }

  return win
}

/**
 * The live preview lives in its OWN window, not a column.
 *
 * A docked column forces the artifact down to a ~110px miniature with dead
 * space beside it, and steals canvas width from the thing the user is
 * actually designing. A detached, always-on-top window is what design tools
 * do, and it means the preview is opt-in and resizable by the OS.
 */
let previewWin: BrowserWindow | null = null

/**
 * Latest doc pushed while the preview window was still loading its first
 * paint. Without this, an update that lands mid-load is dropped while
 * `did-finish-load` delivers the older creation doc — the preview sits
 * one edit behind until the next change.
 */
let pendingPreviewDoc: unknown = undefined

/** Push a doc to the open preview, or stash it for `did-finish-load`. */
/**
 * Blur what is behind a translucent page with the platform's own material:
 * Windows 11 acrylic, macOS vibrancy. Linux has no such material in Electron,
 * so there the desktop shows through unblurred (the Page panel says so).
 */
function applyPageMaterial(doc: unknown) {
  if (previewWin) applyWindowMaterial(previewWin, doc)
}

function applyWindowMaterial(win: BrowserWindow, doc: unknown) {
  if (win.isDestroyed()) return
  const previewWin = win
  const page = (doc as { meta?: { page?: { background?: string; blur?: number } } } | null)?.meta?.page
  const blur = page && page.background !== 'none' ? page.blur ?? 0 : 0
  try {
    if (process.platform === 'win32') previewWin.setBackgroundMaterial(blur > 0 ? 'acrylic' : 'none')
    else if (process.platform === 'darwin') previewWin.setVibrancy(blur > 0 ? 'under-window' : null)
  } catch {
    // An older OS without the material: the page is simply unblurred.
  }
}

function sendPreviewDoc(doc: unknown) {
  applyPageMaterial(doc)
  if (previewWin && !previewWin.isDestroyed() && !previewWin.webContents.isLoading()) {
    previewWin.webContents.send('preview:document', doc)
  } else {
    pendingPreviewDoc = doc
  }
}

function openPreview(doc: unknown) {
  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.focus()
    return previewWin
  }

  const parent = editorWin
  previewWin = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 320,
    minHeight: 240,
    // Transparent: the window draws only the design. With no page background
    // the UI floats on the desktop, which is how a docked sidebar or an
    // overlay is actually judged.
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    show: false,
    // Frameless: the preview IS the built UI, with no OS chrome and no
    // in-window header. A floating pill (drag region) carries zoom/pin/close
    // so the window stays movable; the title remains for task switchers and
    // test harnesses that find the window by name.
    frame: false,
    title: 'Loom — Live Preview',
    alwaysOnTop: true,
    // Skip the taskbar: this is a companion surface, not a second app.
    skipTaskbar: true,
    ...(parent ? { x: parent.getBounds().x + parent.getBounds().width + 12 } : {}),
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  previewWin.once('ready-to-show', () => previewWin?.show())
  void previewWin.loadFile(path.join(here, '../renderer/preview.html'))

  // Keep it above the editor but let the user drop it below when they want.
  previewWin.setAlwaysOnTop(true, 'floating')
  previewWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  previewWin.on('closed', () => {
    previewWin = null
    // Tell the editor to flip its toggle back off.
    for (const w of BrowserWindow.getAllWindows()) {
      if (w !== previewWin) w.webContents.send('preview:closed')
    }
  })

  previewWin.webContents.on('did-finish-load', () => {
    // Flush the latest push if one arrived mid-load; otherwise the
    // creation doc. Either way the window never shows a stale paint.
    previewWin?.webContents.send(
      'preview:document',
      pendingPreviewDoc !== undefined ? pendingPreviewDoc : doc,
    )
    pendingPreviewDoc = undefined
  })

  return previewWin
}

/* ------------------------------------------------------------------ *
 * Run on desktop: the design as a real window on the real screen.
 *
 * A sidebar docked left in the design is docked to the left edge of the
 * monitor, full height of the usable area, drawn with no frame over a
 * transparent window. Placement is `desktopBounds` (src/model/desktop-run.ts),
 * pure and tested; this only creates, places, feeds and closes the window.
 * ------------------------------------------------------------------ */

let desktopWin: BrowserWindow | null = null
let pendingDesktopDoc: unknown = undefined

function runOnDesktop(payload: { doc: unknown; target: RunTarget }) {
  const display = editorWin ? screen.getDisplayMatching(editorWin.getBounds()) : screen.getPrimaryDisplay()
  const bounds = desktopBounds(payload.target, display.workArea)
  if (!desktopWin || desktopWin.isDestroyed()) {
    desktopWin = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      title: 'Loom — Running on desktop',
      webPreferences: {
        preload: path.join(here, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    const win = desktopWin
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.once('ready-to-show', () => win.showInactive())
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('desktop:document', pendingDesktopDoc ?? payload.doc)
      pendingDesktopDoc = undefined
    })
    win.on('closed', () => {
      if (desktopWin === win) desktopWin = null
      editorWin?.webContents.send('desktop:closed')
    })
    pendingDesktopDoc = payload.doc
    void win.loadFile(path.join(here, '../renderer/desktop.html'))
  } else {
    desktopWin.setBounds(bounds)
    if (desktopWin.webContents.isLoading()) pendingDesktopDoc = payload.doc
    else desktopWin.webContents.send('desktop:document', payload.doc)
  }
  applyWindowMaterial(desktopWin, payload.doc)
  return bounds
}

/**
 * The AI agents' way in (see ai-socket.ts). Started with the app; an agent
 * launched by Loom gets `mcpServerConfig()` so it can reach the live editor.
 */
let aiSocket: AiSocket | null = null

/** How an MCP client launches Loom's server: Loom's own Electron, as Node. */
export function mcpServerConfig(): { command: string; args: string[]; env: Record<string, string> } | null {
  if (!aiSocket) return null
  return {
    command: process.execPath,
    args: [path.join(here, 'mcp-bridge.cjs')],
    env: { ELECTRON_RUN_AS_NODE: '1', ...aiSocket.bridgeEnv() },
  }
}

app.whenReady().then(() => {
  createWindow()
  try {
    aiSocket = startAiSocket(() => editorWin)
    aiSocket.writeConfig(mcpServerConfig()!)
  } catch (e) {
    // No AI this run; the editor itself must still open.
    console.error(`[loom] AI connection unavailable: ${e instanceof Error ? e.message : String(e)}`)
    aiSocket = null
  }
  app.on('will-quit', () => aiSocket?.close())

  ipcMain.handle('desktop:run', (e, payload: { doc: unknown; target: RunTarget }) => {
    if (!fromEditor(e)) return null
    if (!payload || typeof payload !== 'object' || !payload.target || typeof payload.target.anchor !== 'string') return null
    const t = payload.target
    if (![t.w, t.h, t.x, t.y].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
    return runOnDesktop(payload)
  })
  ipcMain.handle('desktop:stop', () => {
    desktopWin?.close()
    return true
  })
  // From the running window itself: pass clicks through its empty parts
  // (Windows and macOS forward the pointer so it can take them back).
  ipcMain.handle('desktop:ignore-mouse', (e, ignore: boolean) => {
    if (!desktopWin || e.sender !== desktopWin.webContents) return false
    desktopWin.setIgnoreMouseEvents(ignore === true, { forward: true })
    return true
  })

  ipcMain.handle('preview:open', (e, doc: unknown) => {
    if (!fromEditor(e)) return false
    openPreview(doc)
    // Explicit open takes focus; the send (or stash) follows.
    sendPreviewDoc(doc)
    return true
  })

  ipcMain.handle('preview:update', (e, doc: unknown) => {
    if (!fromEditor(e)) return false
    // Live sync while building: deliver WITHOUT focusing and WITHOUT
    // opening. Focusing here would yank keyboard focus out of the editor on
    // every keystroke and drag frame. Updates to a closed window are
    // dropped — reopening unasked would pop windows at the user.
    if (previewWin && !previewWin.isDestroyed()) sendPreviewDoc(doc)
    return true
  })

  ipcMain.handle('preview:close', () => {
    previewWin?.close()
    previewWin = null
    return true
  })

  ipcMain.handle('preview:set-always-on-top', (_e, on: boolean) => {
    previewWin?.setAlwaysOnTop(on, 'floating')
    return true
  })

  /* ------------------------------------------------------------------ *
   * Persistence.
   *
   * All disk access lives in the main process. The renderer is sandboxed with
   * contextIsolation, so it cannot reach the filesystem at all — the designed
   * document and the tool that edits it stay in separate trust domains.
   * ------------------------------------------------------------------ */

  ipcMain.handle('doc:save', async (e, suggestedName: string, contents: string) => {
    if (!fromEditor(e)) return FORBIDDEN
    const win = editorWin
    if (!win) return { ok: false, error: 'no window' }
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save Loom document',
      defaultPath: path.join(app.getPath('documents'), suggestedName || 'untitled.loom.json'),
      filters: [{ name: 'Loom document', extensions: ['json'] }],
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    try {
      await fs.writeFile(filePath, contents, 'utf8')
      return { ok: true, path: filePath }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle('doc:export-html', async (e, suggestedName: string, contents: string) => {
    if (!fromEditor(e)) return FORBIDDEN
    // Standalone web export. Same trust shape as save: the renderer hands
    // over bytes, the main process picks the path and writes them.
    const win = editorWin
    if (!win) return { ok: false, error: 'no window' }
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export standalone HTML',
      defaultPath: path.join(app.getPath('documents'), suggestedName || 'untitled.html'),
      filters: [{ name: 'HTML document', extensions: ['html'] }],
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    try {
      await fs.writeFile(filePath, contents, 'utf8')
      return { ok: true, path: filePath }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle('doc:export-react', async (e, suggestedName: string, contents: string) => {
    if (!fromEditor(e)) return FORBIDDEN
    // Standalone React module export. Same trust shape as the HTML export.
    const win = editorWin
    if (!win) return { ok: false, error: 'no window' }
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export React component',
      defaultPath: path.join(app.getPath('documents'), suggestedName || 'untitled.jsx'),
      filters: [{ name: 'React component', extensions: ['jsx'] }],
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    try {
      await fs.writeFile(filePath, contents, 'utf8')
      return { ok: true, path: filePath }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle('doc:open', async (e) => {
    if (!fromEditor(e)) return FORBIDDEN
    const win = editorWin
    if (!win) return { ok: false, error: 'no window' }
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Open Loom document',
      properties: ['openFile'],
      filters: [{ name: 'Loom document', extensions: ['json'] }],
    })
    if (canceled || !filePaths[0]) return { ok: false, canceled: true }
    try {
      const contents = await fs.readFile(filePaths[0], 'utf8')
      return { ok: true, path: filePaths[0], contents }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle('doc:write-recent', async (e, suggestedName: unknown, contents: unknown) => {
    // Autosave to a known location, no dialog. This is what makes a crash
    // survivable rather than fatal. The name is renderer-supplied and joined
    // onto a real directory, so it must be a bare slug — never a path.
    if (!fromEditor(e)) return FORBIDDEN
    const name = autosaveFileName(suggestedName)
    if (name === null || typeof contents !== 'string') return { ok: false, error: 'invalid autosave name' }
    try {
      const dir = path.join(app.getPath('userData'), 'autosave')
      await fs.mkdir(dir, { recursive: true })
      const file = path.join(dir, name)
      await fs.writeFile(file, contents, 'utf8')
      return { ok: true, path: file }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle('doc:read-recent', async (e, suggestedName: unknown) => {
    if (!fromEditor(e)) return FORBIDDEN
    const name = autosaveFileName(suggestedName)
    if (name === null) return { ok: false }
    try {
      const file = path.join(app.getPath('userData'), 'autosave', name)
      const contents = await fs.readFile(file, 'utf8')
      return { ok: true, path: file, contents }
    } catch {
      return { ok: false }
    }
  })

  // The preview window is a companion: closing it must NOT quit the app.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Only quit when the EDITOR closes, never when the preview does.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    const editor = BrowserWindow.getAllWindows().some(
      (w) => !w.isDestroyed() && w.getTitle() !== 'Loom — Live Preview',
    )
    if (!editor) app.quit()
  }
})
