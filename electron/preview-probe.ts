/**
 * Live-preview probe (main process).
 *
 * Drives the REAL editor window + preview window the way the UI does and
 * asserts the loop end to end: open shows the current document, a pushed
 * update reaches the already-open window without reopening it, and close
 * destroys it. No pixels involved — DOM text assertions only, so it runs
 * headless. Usage: `npm run probe:preview` (builds first).
 */

import { app, BrowserWindow, screen } from 'electron'
// Side effect: registers the REAL preview/save IPC handlers from main.ts,
// so this probe drives production code, not a copy.
import { setClosePromptForProbe, mcpServerConfig } from './main'
import { spawn } from 'node:child_process'
import fs from 'node:fs'

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

  // AI agents: the MCP bridge, launched exactly as Claude Code / Codex would
  // launch it from Loom's config, speaks raw MCP and builds in the live editor.
  {
    await win.webContents.executeJavaScript(`(() => { window.__loomStore.loadDocument({ version: 1, meta: { name: 'ai', targets: ['web'], created: 0 }, root: null, nodes: {} }); return true })()`, true)
    const cfg = mcpServerConfig()
    step('Loom hands out an MCP server config', !!cfg && cfg.args[0]!.endsWith('mcp-bridge.cjs'))
    if (cfg) {
      const mode = fs.statSync(cfg.env.LOOM_MCP_SOCKET!).mode & 0o777
      step('the socket is private to this user', mode === 0o600, mode.toString(8))
      // Socket paths are capped near 104-108 bytes: one under a long data
      // directory crashed Loom's main process with EINVAL.
      step('the socket path is short, whatever the data directory', cfg.env.LOOM_MCP_SOCKET!.length <= 100, `${cfg.env.LOOM_MCP_SOCKET!.length} chars`)
      const talk = async (env: Record<string, string>, msgs: object[]) => {
        const child = spawn(cfg.command, cfg.args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
        const replies: Array<Record<string, unknown>> = []
        let buf = ''
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (c: string) => {
          buf += c
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            replies.push(JSON.parse(buf.slice(0, nl)))
            buf = buf.slice(nl + 1)
          }
        })
        for (const m of msgs) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
          const want = replies.length + ('id' in m ? 1 : 0)
          for (let i = 0; i < 100 && replies.length < want; i++) await new Promise((r) => setTimeout(r, 50))
        }
        child.stdin.end()
        return replies
      }
      const r = await talk(cfg.env, [
        { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } },
        { method: 'notifications/initialized' },
        { id: 2, method: 'tools/list' },
        { id: 3, method: 'tools/call', params: { name: 'add_component', arguments: { type: 'Panel', parent_id: null, props: { title: 'Built by an agent' } } } },
        { id: 4, method: 'tools/call', params: { name: 'add_component', arguments: { type: 'Nope', parent_id: null } } },
      ])
      const init = r.find((x) => x.id === 1)?.result as { serverInfo?: { name?: string }; capabilities?: { tools?: object } } | undefined
      step('MCP handshake: Loom introduces itself with tools', init?.serverInfo?.name === 'loom' && !!init?.capabilities?.tools)
      const tools = (r.find((x) => x.id === 2)?.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? []
      step('tools/list returns the building tools', tools.some((t) => t.name === 'add_component') && tools.some((t) => t.name === 'dock'), `${tools.length} tools`)
      const call = r.find((x) => x.id === 3)?.result as { content?: Array<{ text: string }>; isError?: boolean } | undefined
      const built = await win.webContents.executeJavaScript(`(() => { const d = window.__loomStore.doc; return d.root ? d.nodes[d.root].props.title : null })()`, true)
      step('a tool call builds in the live editor', !call?.isError && built === 'Built by an agent', `${JSON.stringify(call).slice(0, 100)} -> ${built}`)
      const err = r.find((x) => x.id === 4)?.result as { isError?: boolean; content?: Array<{ text: string }> } | undefined
      step('a refused call comes back as an MCP tool error', err?.isError === true && /unknown component/.test(err?.content?.[0]?.text ?? ''))
      const forged = await talk({ ...cfg.env, LOOM_MCP_TOKEN: 'x'.repeat(48) }, [
        { id: 1, method: 'tools/call', params: { name: 'remove', arguments: { ids: ['anything'] } } },
      ])
      const fr = forged[0]?.result as { isError?: boolean; content?: Array<{ text: string }> } | undefined
      step('a wrong token is refused before reaching the editor', fr?.isError === true && /bad token/.test(fr?.content?.[0]?.text ?? ''))
    }
  }

  // Run on desktop: a sidebar docked left in the design runs docked to the
  // left edge of the real screen, full usable height, transparent, and
  // follows the dock when it changes. Driven through the editor's button.
  {
    await win.webContents.executeJavaScript(`(() => { const s = window.__loomStore;
      s.loadDocument({ version: 1, meta: { name: 'run', targets: ['web'], created: 0 }, root: null, nodes: {} });
      s.addStarter('chat-sidebar', null, 0, 0); s.select([]); return true })()`, true)
    await new Promise((r) => setTimeout(r, 600))
    await win.webContents.executeJavaScript(`document.querySelector('.titlebar .tb-run')?.click()`, true)
    let dw: BrowserWindow | undefined
    for (let i = 0; i < 40 && !dw; i++) {
      await new Promise((r) => setTimeout(r, 250))
      dw = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getTitle() === 'Loom — Running on desktop')
    }
    step('Run opens the design as its own window', !!dw)
    if (dw) {
      if (dw.webContents.isLoading()) await new Promise((r) => dw!.webContents.once('did-finish-load', () => r(undefined)))
      await new Promise((r) => setTimeout(r, 800))
      const work = screen.getDisplayMatching(win.getBounds()).workArea
      const b = dw.getBounds()
      step('docked left, it sits on the left edge of the real screen, full height', b.x === work.x && b.y === work.y && b.height === work.height && Math.abs(b.width - 360) <= 2, `${JSON.stringify(b)} in ${JSON.stringify(work)}`)
      const inside = await dw.webContents.executeJavaScript(`({ text: document.body.innerText.slice(0, 200), bg: getComputedStyle(document.body).backgroundColor, stage: getComputedStyle(document.querySelector('.dw-stage')).backgroundColor })`, true)
      step('it draws the design and nothing behind it', /Assistant/.test(inside.text) && inside.bg === 'rgba(0, 0, 0, 0)' && inside.stage === 'rgba(0, 0, 0, 0)', JSON.stringify(inside).slice(0, 160))
      step('it has no frame and stays on top', !dw.isResizable() && dw.isAlwaysOnTop())
      await win.webContents.executeJavaScript(`(() => { const s = window.__loomStore; s.commit({ op: 'setProp', id: s.doc.root, key: 'anchor', value: 'right' }, 'dock right'); return true })()`, true)
      await new Promise((r) => setTimeout(r, 800))
      const b2 = dw.getBounds()
      step('docking it right moves it to the right edge, live', b2.x + b2.width === work.x + work.width && b2.height === work.height, JSON.stringify(b2))
      const closed = new Promise((r) => dw!.once('closed', () => r(true)))
      await win.webContents.executeJavaScript(`document.querySelector('.titlebar .tb-run')?.click()`, true)
      const gone = await Promise.race([closed, new Promise((r) => setTimeout(() => r(false), 3000))])
      const off = await win.webContents.executeJavaScript(`document.querySelector('.titlebar .tb-run')?.getAttribute('aria-pressed')`, true)
      step('Stop closes it and the button turns off', gone === true && off === 'false', `closed=${gone} pressed=${off}`)
    }
  }

  // Closing with unsaved changes: Shane found the window simply would not
  // close (the page's beforeunload guard, with no question asked). Now the
  // question is asked, Cancel keeps the window, and closing always works.
  await win.webContents.executeJavaScript(`(() => { const s = window.__loomStore; s.addComponent('Label', s.doc.root, 10, 10); return s.dirty })()`, true)
  let asked = 0
  setClosePromptForProbe(() => {
    asked++
    return false
  })
  win.close()
  await new Promise((r) => setTimeout(r, 800))
  step('closing with unsaved changes asks first', asked === 1, `asked ${asked} time(s)`)
  step('answering Cancel keeps the window open', !win.isDestroyed())
  setClosePromptForProbe(() => {
    asked++
    return true
  })
  const closed = new Promise((r) => win!.once('closed', () => r(true)))
  win.close()
  const didClose = await Promise.race([closed, new Promise((r) => setTimeout(() => r(false), 3000))])
  step('answering Close closes it, unsaved changes or not', didClose === true && asked === 2, `closed=${didClose} asked=${asked}`)

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
