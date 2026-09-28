/**
 * Preload — the only bridge between the editor UI and Node.
 *
 * The renderer runs sandboxed with contextIsolation, so anything not exposed
 * here is unreachable. The document being designed is untrusted presentation
 * and must never gain reach through this bridge.
 *
 * The preview channel is deliberately narrow: the editor can ASK to open,
 * close, or pin the preview window, and can PUSH a document.
 *
 * Both windows load THIS preload, so the preview window sees the same
 * `loomHost` object. The boundary is enforced in the main process, not here:
 * file, autosave and preview-open/update IPC is honoured only from the editor
 * window, and no window may navigate away from its own page.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('loomHost', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  experimental: process.env.LOOM_EXPERIMENTAL === '1',

  /**
   * Persistence. The renderer cannot touch the filesystem — it asks, the main
   * process does it. That keeps the designed document in a separate trust
   * domain from the tool editing it.
   */
  save: (name: string, contents: string) => ipcRenderer.invoke('doc:save', name, contents),
  exportHtml: (name: string, contents: string) => ipcRenderer.invoke('doc:export-html', name, contents),
  exportReact: (name: string, contents: string) => ipcRenderer.invoke('doc:export-react', name, contents),
  open: () => ipcRenderer.invoke('doc:open'),
  autosave: (name: string, contents: string) =>
    ipcRenderer.invoke('doc:write-recent', name, contents),
  readAutosave: (name: string) => ipcRenderer.invoke('doc:read-recent', name),
})

const isPreviewWindow = process.argv.some((a) => a.includes('preview.html'))

contextBridge.exposeInMainWorld('loomPreview', {
  /** True in the detached preview window. */
  isPreviewWindow,

  /** Editor -> main: show the preview window carrying this document. */
  open: (doc: unknown) => ipcRenderer.invoke('preview:open', doc),
  /** Editor -> main: refresh the open preview without focusing or opening. */
  update: (doc: unknown) => ipcRenderer.invoke('preview:update', doc),
  close: () => ipcRenderer.invoke('preview:close'),
  setAlwaysOnTop: (on: boolean) => ipcRenderer.invoke('preview:set-always-on-top', on),

  /** Main -> preview: a new document arrived. */
  onDocument: (cb: (doc: unknown) => void) => {
    const h = (_e: unknown, doc: unknown) => cb(doc)
    ipcRenderer.on('preview:document', h)
    return () => ipcRenderer.removeListener('preview:document', h)
  },

  /** Main -> editor: the user closed the preview window. */
  onClosed: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('preview:closed', h)
    return () => ipcRenderer.removeListener('preview:closed', h)
  },
})

const isDesktopWindow = process.argv.some((a) => a.includes('desktop.html'))

/**
 * Run on desktop. The editor asks to run (or re-place) the design as a real
 * window, or to stop; the running window receives the document and may ask
 * for its empty parts to let clicks through. Placement is decided in main.
 */
contextBridge.exposeInMainWorld('loomDesktop', {
  isDesktopWindow,
  run: (doc: unknown, target: unknown) => ipcRenderer.invoke('desktop:run', { doc, target }),
  stop: () => ipcRenderer.invoke('desktop:stop'),
  ignoreMouse: (ignore: boolean) => ipcRenderer.invoke('desktop:ignore-mouse', ignore),
  onDocument: (cb: (doc: unknown) => void) => {
    const h = (_e: unknown, doc: unknown) => cb(doc)
    ipcRenderer.on('desktop:document', h)
    return () => ipcRenderer.removeListener('desktop:document', h)
  },
  onClosed: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('desktop:closed', h)
    return () => ipcRenderer.removeListener('desktop:closed', h)
  },
})

/**
 * AI agents (editor window only; main checks the sender). Main relays a tool
 * request from an agent's MCP bridge; the editor runs it against the live
 * store and answers. The editor never reaches the agent or the socket itself.
 */
contextBridge.exposeInMainWorld('loomAi', {
  onRequest: (cb: (reqId: string, method: string, params: unknown) => void) => {
    const h = (_e: unknown, reqId: string, method: string, params: unknown) => cb(reqId, method, params)
    ipcRenderer.on('ai:request', h)
    return () => ipcRenderer.removeListener('ai:request', h)
  },
  respond: (reqId: string, reply: unknown) => ipcRenderer.invoke('ai:response', reqId, reply),
  /** The Assistant: which agents can run, send a message, stop, keys. */
  providers: () => ipcRenderer.invoke('ai:providers'),
  send: (req: unknown) => ipcRenderer.invoke('ai:send', req),
  cancel: () => ipcRenderer.invoke('ai:cancel'),
  saveKey: (provider: string, key: string | null) => ipcRenderer.invoke('ai:save-key', provider, key),
  onEvent: (cb: (runId: string, event: unknown) => void) => {
    const h = (_e: unknown, runId: string, event: unknown) => cb(runId, event)
    ipcRenderer.on('ai:event', h)
    return () => ipcRenderer.removeListener('ai:event', h)
  },
})

/** The render window (offscreen): receives a job, reports when it is drawn. */
contextBridge.exposeInMainWorld('loomRender', {
  onJob: (cb: (job: unknown) => void) => {
    const h = (_e: unknown, job: unknown) => cb(job)
    ipcRenderer.on('render:job', h)
    return () => ipcRenderer.removeListener('render:job', h)
  },
  done: (id: string, result: unknown) => ipcRenderer.invoke('render:done', id, result),
})
