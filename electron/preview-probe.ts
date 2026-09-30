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
import { setClosePromptForProbe, mcpServerConfig, renderForProbe } from './main'
import { spawn } from 'node:child_process'
import fs from 'node:fs'

// The editor window main.ts creates loads the seeded demo scene. It must be
// THAT window the probe drives: preview IPC is honoured only from the editor
// window main.ts registered (see `fromEditor`), so a second window of the
// probe's own is refused, which is how this probe went red after the IPC
// guard landed. Set before `whenReady`, when main.ts reads it.
process.env.LOOM_DEMO = '1'
// The Assistant's scripted stand-in agent (electron/test-agent.cjs): the
// whole send -> agent -> MCP -> editor path, with no model and no cost.
process.env.LOOM_AI_TEST_AGENT = require('node:path').join(__dirname, '..', '..', 'electron', 'test-agent.cjs')

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

  // The agents' eyes: `render` returns a real image of the design as it
  // ships; `check_layout` measures real problems on the real boxes.
  {
    const png = (b64: string) => { const b = Buffer.from(b64, 'base64'); return { sig: b.subarray(1, 4).toString(), w: b.readUInt32BE(16), h: b.readUInt32BE(20) } }
    const clean = await win.webContents.executeJavaScript(`(() => { const s = window.__loomStore;
      s.loadDocument({ version: 1, meta: { name: 'eyes', targets: ['web'], created: 0, page: { background: 'theme' } }, root: null, nodes: {} });
      s.addComponent('Panel', null, 0, 0, { anchor: 'fill', flow: true });
      const r = s.doc.root; s.commit({ op: 'setFlow', id: r, flow: true }, 'flow');
      const card = s.dropComponent('Card', r, 0, 0); s.addComponent('Heading', card, 0, 0, { text: 'Welcome back' });
      return { doc: s.doc, card } })()`, true)
    const img = await renderForProbe(clean.doc, 'desktop', 'image')
    const p1 = img.ok ? png(img.png as string) : null
    step('render returns a PNG of the whole desktop screen', !!p1 && p1.sig === 'PNG' && p1.w === 1280 && p1.h >= 800, JSON.stringify(p1 ?? img).slice(0, 120))
    const crop = await renderForProbe(clean.doc, 'desktop', 'image', clean.card)
    const p2 = crop.ok ? png(crop.png as string) : null
    step('render can crop to one node', !!p2 && p2.w < 1280 && p2.w > 100, JSON.stringify(p2))
    // Sized as the export sizes: a padded full-width button fits its card
    // (content-box sizing drew it wider than the card on this surface).
    const fit = await win.webContents.executeJavaScript(`(() => { const s = window.__loomStore;
      s.loadDocument({ version: 1, meta: { name: 'fit', targets: ['web'], created: 0 }, root: null, nodes: {} });
      s.addComponent('Panel', null, 0, 0, { anchor: 'fill' }); const r = s.doc.root;
      const card = s.addComponent('Card', r, 40, 40, { w: 300, padding: 0 }); s.commit({ op: 'setFlow', id: card, flow: true }, 'flow');
      s.addComponent('Button', card, 0, 0, { label: 'Get started', fullWidth: true });
      return s.doc })()`, true)
    const fitReport = (await renderForProbe(fit, 'desktop', 'measure')).result as { issues: Array<{ detail: string }>; boxSizing: string } | undefined
    step('the render window sizes boxes as the export does (border-box)', fitReport?.boxSizing === 'border-box' && fitReport.issues.length === 0, `${fitReport?.boxSizing} ${fitReport?.issues.map((i) => i.detail).join(' | ')}`)
    const ok = await renderForProbe(clean.doc, 'desktop', 'measure')
    const okIssues = (ok.result as { issues: Array<{ kind: string; detail: string }> } | undefined)?.issues ?? []
    step('check_layout finds nothing wrong with a clean design', ok.ok === true && okIssues.length === 0, okIssues.map((i) => i.detail).join(' | ').slice(0, 200))
    const broken = await win.webContents.executeJavaScript(`(() => { const s = window.__loomStore;
      s.loadDocument({ version: 1, meta: { name: 'broken', targets: ['web'], created: 0, page: { background: 'theme' } }, root: null, nodes: {} });
      s.addComponent('Panel', null, 0, 0, { anchor: 'fill' }); const r = s.doc.root;
      s.addComponent('Card', r, 1150, 40, { w: 300, h: 120 });
      const a = s.addComponent('Button', r, 40, 300, { label: 'One' }); s.addComponent('Button', r, 60, 305, { label: 'Two' });
      s.addComponent('Label', r, 40, 400, { text: 'Hard to read', color: '#1b1f2a' });
      s.addComponent('IconButton', r, 40, 500, {});
      s.addComponent('Link', r, 40, 600, { text: 'A link much too long for its narrow box', truncate: true, maxWidth: 80 });
      return s.doc })()`, true)
    const bad = await renderForProbe(broken, 'phone', 'measure')
    const kinds = new Set(((bad.result as { issues: Array<{ kind: string }> } | undefined)?.issues ?? []).map((i) => i.kind))
    step('check_layout finds a node off the screen and outside its container', kinds.has('offscreen') && kinds.has('overflows-parent'), [...kinds].join(','))
    step('check_layout finds overlapping free nodes', kinds.has('overlap'))
    step('check_layout finds low-contrast text', kinds.has('low-contrast'))
    step('check_layout finds tap targets too small for a phone', kinds.has('small-target'))
    step('check_layout finds text that is cut off', kinds.has('clipped-text'))
    // And through MCP, as an agent calls them: an image, and the issues.
    const cfg = mcpServerConfig()!
    const child = spawn(cfg.command, cfg.args, { env: { ...process.env, ...cfg.env }, stdio: ['pipe', 'pipe', 'pipe'] })
    const replies: Array<Record<string, unknown>> = []
    let buf = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (c: string) => { buf += c; let nl: number; while ((nl = buf.indexOf('\n')) >= 0) { replies.push(JSON.parse(buf.slice(0, nl))); buf = buf.slice(nl + 1) } })
    for (const m of [{ id: 1, method: 'tools/call', params: { name: 'render', arguments: { viewport: 'desktop' } } }, { id: 2, method: 'tools/call', params: { name: 'check_layout', arguments: { viewport: 'phone' } } }]) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
      for (let i = 0; i < 300 && !replies.some((r) => r.id === m.id); i++) await new Promise((r) => setTimeout(r, 50))
    }
    child.stdin.end()
    const rimg = (replies.find((r) => r.id === 1)?.result as { content?: Array<{ type: string; mimeType?: string; data?: string }> } | undefined)?.content ?? []
    step('an agent gets render as an MCP image', rimg[0]?.type === 'image' && rimg[0]?.mimeType === 'image/png' && png(rimg[0].data!).sig === 'PNG', JSON.stringify(rimg.map((c) => c.type)))
    const rchk = (replies.find((r) => r.id === 2)?.result as { content?: Array<{ text: string }> } | undefined)?.content?.[0]?.text ?? ''
    step('an agent gets check_layout issues it can act on', /overlaps/.test(rchk) && /tap target/.test(rchk), rchk.slice(0, 120))
  }

  // The Assistant, end to end with the scripted agent: type, send, watch it
  // build, undo the whole turn in one step, follow up, see an error, stop.
  {
    await win.webContents.executeJavaScript(`(() => { const s = window.__loomStore;
      s.loadDocument({ version: 1, meta: { name: 'assist', targets: ['web'], created: 0 }, root: null, nodes: {} });
      s.addComponent('Panel', null, 0, 0, { w: 1280, h: 800 }); s.select([]); return true })()`, true)
    const ask = async (text: string) => {
      await win.webContents.executeJavaScript(`(() => {
        const ta = document.querySelector('.assistant .as-input');
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true }));
        return true })()`, true)
      await new Promise((r) => setTimeout(r, 150))
      await win.webContents.executeJavaScript(`document.querySelector('.assistant .as-send')?.click()`, true)
    }
    const idle = async (ms = 15000) => {
      for (let i = 0; i < ms / 200; i++) {
        await new Promise((r) => setTimeout(r, 200))
        const busy = await win.webContents.executeJavaScript(`Boolean(document.querySelector('.assistant .as-send.stop'))`, true)
        if (!busy) return true
      }
      return false
    }
    for (let i = 0; i < 40; i++) {
      const ok = await win.webContents.executeJavaScript(`!document.querySelector('.assistant .as-input')?.disabled`, true)
      if (ok) break
      await new Promise((r) => setTimeout(r, 250))
    }
    const h0 = await win.webContents.executeJavaScript(`window.__loomStore.history.length`, true)
    await ask('card: Quarterly plan')
    await idle()
    const after = await win.webContents.executeJavaScript(`(() => { const s = window.__loomStore; const cards = Object.values(s.doc.nodes).filter((n) => n.type === 'Card'); return { cards: cards.map((c) => c.props.title), hist: s.history.length, label: s.history[s.history.length - 1]?.label, thread: document.querySelector('.assistant .as-thread')?.innerText ?? '' } })()`, true)
    step('the assistant builds on the canvas from a message', after.cards.includes('Quarterly plan'), JSON.stringify(after.cards))
    step('its whole turn is one undo step, named for the message', after.hist === h0 + 1 && /^AI: card: Quarterly plan/.test(after.label), `${h0} -> ${after.hist} "${after.label}"`)
    step('the conversation shows the reply and the steps', /Added a card titled/.test(after.thread) && /add Card/.test(after.thread), after.thread.slice(0, 120))
    // Messages stack, never overlap (a reply was absolutely positioned over
    // the thread by a class-name collision with the panel itself).
    const stacked = await win.webContents.executeJavaScript(`(() => { const r = [...document.querySelectorAll('.as-thread > *')].map((e) => e.getBoundingClientRect()); return r.every((b, i) => i === 0 || b.top >= r[i - 1].bottom - 1) })()`, true)
    step('the thread stacks its messages without overlap', stacked === true)
    await ask('card: Second')
    await idle()
    const follow = await win.webContents.executeJavaScript(`(() => { const s = window.__loomStore; return Object.values(s.doc.nodes).filter((n) => n.type === 'Button').map((b) => b.props.label) })()`, true)
    step('a follow-up continues the same conversation', follow.includes('Follow-up'), JSON.stringify(follow))
    await win.webContents.executeJavaScript(`window.__loomStore.undo(); true`, true)
    const undone = await win.webContents.executeJavaScript(`Object.values(window.__loomStore.doc.nodes).filter((n) => n.type === 'Card').map((c) => c.props.title)`, true)
    step('undo takes back the whole last turn', JSON.stringify(undone) === JSON.stringify(['Quarterly plan']), JSON.stringify(undone))
    await ask('fail please')
    await idle()
    const err = await win.webContents.executeJavaScript(`document.querySelector('.assistant .as-error')?.textContent ?? ''`, true)
    step('an agent error is shown in the conversation', /could not add/i.test(err), err)
    const n0 = await win.webContents.executeJavaScript(`Object.keys(window.__loomStore.doc.nodes).length`, true)
    await ask('slow card: never')
    await new Promise((r) => setTimeout(r, 900))
    // While it builds, the conversation folds to one live line so the canvas
    // stays in view; "Show" opens it anyway.
    const folded = await win.webContents.executeJavaScript(`(() => { const live = document.querySelector('.assistant .as-live'); const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect(); const r = live?.getBoundingClientRect(); return { live: !!live, thread: !!document.querySelector('.assistant .as-thread'), text: live?.textContent ?? '', h: r ? Math.round(r.height) : 0, share: r ? +(r.height / wrap.height).toFixed(3) : 1 } })()`, true)
    step('while the agent builds, the conversation is one live line, not a panel over the canvas', folded.live && !folded.thread && /Building/.test(folded.text) && folded.h <= 36, JSON.stringify(folded))
    await win.webContents.executeJavaScript(`document.querySelector('.assistant .as-live-show')?.click()`, true)
    await new Promise((r) => setTimeout(r, 150))
    const shown = await win.webContents.executeJavaScript(`!!document.querySelector('.assistant .as-thread') && !document.querySelector('.assistant .as-live')`, true)
    step('Show opens the conversation mid-turn', shown === true)
    await win.webContents.executeJavaScript(`document.querySelector('.assistant .as-send.stop')?.click()`, true)
    const stopped = await idle(5000)
    await new Promise((r) => setTimeout(r, 4500))
    const n1 = await win.webContents.executeJavaScript(`Object.keys(window.__loomStore.doc.nodes).length`, true)
    const stopText = await win.webContents.executeJavaScript(`[...document.querySelectorAll('.assistant .as-error')].pop()?.textContent ?? ''`, true)
    step('Stop ends a turn before it builds anything', stopped && n1 === n0 && /Stopped/.test(stopText), `stopped=${stopped} nodes ${n0}->${n1} "${stopText}"`)
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
      const sizing = await dw.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.dw-stage')).boxSizing`, true)
      step('it sizes boxes as the export does (border-box)', sizing === 'border-box', sizing)
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
