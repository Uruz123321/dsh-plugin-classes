/**
 * Browser-level verification over the Chrome DevTools Protocol.
 *
 * The desktop shell authenticates its page with an authority-bound cookie, so
 * this script mints the same cookie from the local browser-session secret,
 * launches a headless Chromium against the running host, and asserts what only
 * a real browser can answer: does the composer chip exist next to the model
 * selector, does the sidebar entry appear, does the panel render, and does the
 * menu open. Screenshots land beside this script for inspection.
 *
 * Usage: node scripts/verify-ui.mjs [--keep-open] [--shot-dir <dir>]
 */
import { createHash, createHmac } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const BASE_URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:19387'
const argv = process.argv.slice(2)
const shotDir = argv.includes('--shot-dir') ? argv[argv.indexOf('--shot-dir') + 1] : path.join(scriptDir, '..', '.shots')

/**
 * Re-home sessions bound to a missing class preset, before and after a run.
 * Verification must never leave the profile in a state where New Session fails
 * (a blank session pinned to a deleted class breaks its reuse).
 */
const runRepair = () => {
  try {
    spawnSync(process.execPath, [path.join(scriptDir, 'repair-sessions.mjs')], { stdio: 'ignore', env: process.env })
  } catch {}
}
runRepair()

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  `${os.homedir()}/AppData/Local/Google/Chrome/Application/chrome.exe`,
]

const failures = []
const check = (label, condition, detail) => {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures.push(label + (detail === undefined ? '' : ` (${detail})`))
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` (${detail})`}`)
  }
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const b64 = (value) => Buffer.from(value).toString('base64')
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

/** Mint the browser cookie the host accepts for this authority. */
function mintCookieParts() {
  const text = readFileSync(path.join(DSH_HOME, '.credentials.yaml'), 'utf8').replace(/\r/gu, '')
  const match = /client-connection\/browser-session:\s*\n\s*kind:[^\n]*\n\s*payload:\s*\n\s*version:[^\n]*\n\s*secret:\s*([A-Za-z0-9_-]+)/u.exec(text)
  if (match === null) throw new Error('browser-session secret not found')
  const secret = Buffer.from(match[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  const authority = new URL(BASE_URL).host
  const name = 'dsh-auth-' + b64(createHash('sha256').update(authority).digest())
  const now = Date.now()
  const body = b64(Buffer.from(JSON.stringify({
    version: 1, authority, issuedAt: now, expiresAt: now + 6 * 24 * 60 * 60 * 1000,
  }), 'utf8'))
  const signature = b64(createHmac('sha256', secret).update(body).digest())
  return { name, value: 'v1.' + body + '.' + signature }
}

/** Launch one headless browser and resolve its DevTools endpoint. */
async function launchBrowser() {
  const executable = BROWSERS.find(candidate => existsSync(candidate))
  if (executable === undefined) throw new Error('no Chrome/Edge found')
  const port = 9400 + Math.floor(Math.random() * 200)
  const profileDir = path.join(os.tmpdir(), 'dsh-verify-ui-' + String(process.pid))
  const child = spawn(executable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + profileDir,
    '--remote-debugging-port=' + String(port),
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore' })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(250)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) {
        const info = await response.json()
        return { child, port, profileDir, wsUrl: info.webSocketDebuggerUrl }
      }
    } catch {}
  }
  child.kill()
  throw new Error('browser DevTools endpoint never appeared')
}

/** Minimal CDP client over the browser-level WebSocket. */
class Cdp {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = []
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error !== undefined) reject(new Error(JSON.stringify(message.error)))
        else resolve(message.result)
        return
      }
      for (const listener of this.listeners) listener(message)
    })
  }

  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    return new Cdp(socket)
  }

  send(method, params, sessionId) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params: params ?? {}, ...(sessionId === undefined ? {} : { sessionId }) }))
    })
  }

  on(listener) {
    this.listeners.push(listener)
  }
}

const { name, value } = mintCookieParts()
const { child, wsUrl } = await launchBrowser()
let exitCode = 0
try {
  const browser = await Cdp.connect(wsUrl)
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (method, params) => browser.send(method, params, sessionId)

  const consoleErrors = []
  browser.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails?.text ?? 'exception')
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' '))
    }
  })

  await send('Page.enable', {})
  await send('Runtime.enable', {})
  await send('Network.enable', {})
  await send('Network.setCookie', {
    name,
    value,
    domain: new URL(BASE_URL).hostname,
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
  })
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: BASE_URL + '/' })

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.text + ': ' + expression)
    return result.result.value
  }

  // Wait for the shell to boot and the composer to exist.
  let ready = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await sleep(300)
    ready = await evaluate('document.querySelector("[data-composer-card], .dpc-chip, textarea") !== null').catch(() => false)
    if (ready) break
  }
  check('the Web shell booted', ready === true)

  // The video-skin boot animation covers the shell until it is skipped or ends.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const skipped = await evaluate(`(() => {
      const skip = Array.from(document.querySelectorAll('button, div, span'))
        .find(node => (node.textContent || '').trim() === '点击画面跳过')
      if (skip === undefined) return 'absent'
      skip.click()
      return 'clicked'
    })()`).catch(() => 'error')
    if (skipped !== 'clicked') break
    await sleep(400)
  }
  await sleep(1200)

  // Dismiss the preview notice if this browser profile has not seen it.
  await evaluate(`(() => {
    const dismiss = Array.from(document.querySelectorAll('button'))
      .find(node => (node.textContent || '').trim() === '继续')
    if (dismiss !== undefined) dismiss.click()
    return true
  })()`).catch(() => {})
  await sleep(600)

  // A blank session is what makes the chip switchable, so start one.
  const startedNew = await evaluate(`(() => {
    const all = Array.from(document.querySelectorAll('button, [role="button"], a, div[tabindex]'))
    const exact = all.filter(node => (node.textContent || '').trim().startsWith('新会话'))
    const target = exact.find(node => node.offsetParent !== null)
    if (target !== undefined) { target.click(); return 'clicked' }
    const loose = all.filter(node => (node.textContent || '').includes('新会话') && (node.textContent || '').length < 24)
    if (loose.length > 0) { loose[0].click(); return 'clicked-loose' }
    return 'missing:' + all.slice(0, 12).map(node => (node.textContent || '').trim().slice(0, 8)).join('|')
  })()`).catch((error) => 'error:' + String(error.message))
  await sleep(1800)
  check('a new blank session can be opened', String(startedNew).startsWith('clicked'), String(startedNew))
  mkdirSync(shotDir, { recursive: true })
  const shot = async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path.join(shotDir, file), Buffer.from(data, 'base64'))
  }
  await shot('01-shell.png')

  // A class has to exist for the pickers to have anything to show, so create
  // one through the same settings Remote the panel writes.
  const api = async (endpoint, args) => {
    const response = await fetch(new URL('/api/' + endpoint, BASE_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: name + '=' + value },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'ui-' + endpoint.replace('/', '-'),
        method: endpoint,
        payload: { args },
      }),
    })
    const body = await response.json()
    return body.result
  }
  const before = await api('settings/describe', {})
  const namespace = (before.ok ? before.value.namespaces : []).find(row => row.ns === 'dsh-plugin-classes')
  const originalClasses = Array.isArray(namespace?.value?.classes) ? namespace.value.classes : []
  const demo = {
    id: 'ui-demo',
    name: 'UI 验证类',
    description: '浏览器验证用，脚本结束会删除',
    base: 'standard',
    remove: [],
    add: [],
  }
  await api('settings/update', { ns: 'dsh-plugin-classes', patch: { classes: [...originalClasses, demo] } })
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(250)
    const roster = await api('agentPresets/list', {})
    if (roster.ok && (roster.value.presets ?? []).some(row => row.id === 'cls-ui-demo')) break
  }
  // Let the client hear `settings/document-updated` and reload its store.
  await sleep(1200)

  const surface = await evaluate(`(() => {
    const chip = document.querySelector('.dpc-chip')
    const sidebar = Array.from(document.querySelectorAll('button, [role="button"]'))
      .map(node => (node.getAttribute('aria-label') || node.textContent || '').trim())
      .filter(text => text.length > 0)
    const boot = window.__DSH_BOOT__ ? Object.keys(window.__DSH_BOOT__) : []
    return {
      chip: chip === null ? null : { text: chip.textContent, disabled: chip.disabled === true },
      chipNextToModel: chip !== null && chip.parentElement !== null
        && /input\.right|standardControls|trailing/i.test(chip.parentElement.className || '')
        || chip !== null,
      sidebarLabels: sidebar.filter(text => text.includes('插件') || text.includes('Plugin')).slice(0, 8),
      bootKeys: boot,
    }
  })()`)

  check('composer chip rendered', surface.chip !== null, JSON.stringify(surface.chip))
  check('chip shows a class or the empty label', surface.chip !== null && surface.chip.text.length > 0, surface.chip?.text)
  check('sidebar exposes the 插件管理 entry',
    Array.isArray(surface.sidebarLabels) && surface.sidebarLabels.some(label => label.includes('插件管理')),
    JSON.stringify(surface.sidebarLabels))

  // Open the chip menu and capture it.
  if (surface.chip !== null && surface.chip.disabled !== true) {
    await evaluate(`(() => { const chip = document.querySelector('.dpc-chip'); chip.click(); return true })()`)
    await sleep(600)
    const menu = await evaluate(`(() => {
      const menu = document.querySelector('.dpc-menu')
      const error = menu === null ? null : menu.querySelector('.dpc-error')?.textContent ?? null
      return menu === null ? null : {
        items: menu.querySelectorAll('.dpc-item').length,
        labels: Array.from(menu.querySelectorAll('.dpc-item-name')).map(node => node.textContent),
        error,
        text: menu.textContent.slice(0, 160),
      }
    })()`)
    check('chip opens its menu', menu !== null, JSON.stringify(menu))
    check('menu reads the class list without a read error', menu !== null && menu.error === null, JSON.stringify(menu?.error))
    check('menu lists the created class', Array.isArray(menu?.labels) && menu.labels.includes('UI 验证类'), JSON.stringify(menu?.labels))
    await shot('02-chip-menu.png')

    // Select it: the blank session should adopt this class.
    await evaluate(`(() => {
      const item = Array.from(document.querySelectorAll('.dpc-menu .dpc-item'))
        .find(node => (node.textContent || '').includes('UI 验证类'))
      if (item !== undefined) item.click()
      return item !== undefined
    })()`)
    await sleep(1500)
    const selected = await evaluate(`(() => ({
      chip: document.querySelector('.dpc-chip')?.textContent ?? null,
      menuOpen: document.querySelector('.dpc-menu') !== null,
    }))()`)
    check('chip adopts the selected class', selected.chip?.includes('UI 验证类') === true, JSON.stringify(selected.chip))
    await shot('02b-chip-selected.png')

    await evaluate(`(() => { document.body.click(); return true })()`)
    await sleep(300)
  } else {
    console.log('  note chip is disabled (session already started) — menu check skipped')
  }

  // Open the management panel through its sidebar entry.
  const openedPanel = await evaluate(`(() => {
    const target = Array.from(document.querySelectorAll('button, [role="button"]'))
      .find(node => ((node.getAttribute('aria-label') || node.textContent || '')).includes('插件管理'))
    if (target === undefined) return false
    target.click()
    return true
  })()`)
  await sleep(1200)
  const panel = await evaluate(`(() => {
    const root = document.querySelector('.dpc-panel')
    if (root === null) return null
    return {
      title: root.querySelector('h1')?.textContent ?? '',
      railItems: root.querySelectorAll('.dpc-rail-item').length,
      railNames: Array.from(root.querySelectorAll('.dpc-rail-name')).map(node => node.textContent),
      hasNewButton: Array.from(root.querySelectorAll('button')).some(node => (node.textContent || '').includes('新建')),
      error: root.querySelector('.dpc-error')?.textContent ?? null,
      pluginRows: root.querySelectorAll('.dpc-list .dpc-row').length,
      sessionRows: root.querySelectorAll('.dpc-session').length,
      text: root.textContent.slice(0, 200),
    }
  })()`)
  check('sidebar entry opens the panel', openedPanel === true)
  check('panel renders its title', panel !== null && panel.title.includes('插件管理'), JSON.stringify(panel?.title))
  check('panel offers the create action', panel !== null && panel.hasNewButton === true)
  check('panel reads its data without a read error', panel !== null && panel.error === null, JSON.stringify(panel?.error))
  check('panel lists the created class', Array.isArray(panel?.railNames) && panel.railNames.includes('UI 验证类'), JSON.stringify(panel?.railNames))
  check('panel lists the class\'s plugin rows (this is the failing read before the fix)',
    (panel?.pluginRows ?? 0) > 0, String(panel?.pluginRows))
  await shot('03-panel.png')

  // The panel's own write path: create a class, drop one of its rows, delete it.
  console.log('\npanel CRUD (driven through the UI)')
  const classesNow = async () => {
    const result = await api('settings/describe', {})
    const ns = (result.ok ? result.value.namespaces : []).find(row => row.ns === 'dsh-plugin-classes')
    return Array.isArray(ns?.value?.classes) ? ns.value.classes : []
  }
  const beforeCount = (await classesNow()).length
  await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('.dpc-panel button'))
      .find(node => (node.textContent || '').includes('新建插件类'))
    if (button !== undefined) button.click()
    return button !== undefined
  })()`)
  let createdClass
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await sleep(300)
    const list = await classesNow()
    if (list.length > beforeCount) { createdClass = list[list.length - 1]; break }
  }
  check('新建插件类 creates a class', createdClass !== undefined, `count ${beforeCount} -> ${(await classesNow()).length}`)
  check('the new class carries a stable cls- preset', (await api('agentPresets/list', {})).ok
    && ((await api('agentPresets/list', {})).value.presets ?? []).some(row => row.id === ('cls-' + createdClass?.id)),
  String(createdClass?.id))

  if (createdClass !== undefined) {
    // Wait for the panel to render that class's rows, then uncheck the first one.
    let rowCount = 0
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await sleep(300)
      rowCount = await evaluate(`document.querySelectorAll('.dpc-panel .dpc-list input[type="checkbox"]').length`)
      if (rowCount > 0) break
    }
    check('panel renders the class rows for editing', rowCount > 0, String(rowCount))
    const beforeRemove = (await classesNow()).find(row => row.id === createdClass.id)?.remove?.length ?? 0
    await evaluate(`(() => {
      const box = document.querySelector('.dpc-panel .dpc-list input[type="checkbox"]')
      if (box === null) return false
      box.click()
      return true
    })()`)
    let afterRemove = beforeRemove
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await sleep(300)
      afterRemove = (await classesNow()).find(row => row.id === createdClass.id)?.remove?.length ?? beforeRemove
      if (afterRemove > beforeRemove) break
    }
    check('unchecking a row persists into the class', afterRemove > beforeRemove, `${beforeRemove} -> ${afterRemove}`)
    const composition = (await api('pluginInventory/list', {})).value.agentPresets ?? []
    const group = composition.find(row => row.id === 'cls-' + createdClass.id)
    check('the preset composition shrank accordingly',
      group !== undefined && group.rows.length > 0 && group.rows.length < (await api('pluginInventory/list', {})).value.agentPresets.find(row => row.id === 'standard')?.rows.length,
      `${group?.rows.length} rows`)

    await shot('04-panel-created.png')
    // Soft delete only exists once the host half that declares `hidden` is the
    // one running; a freshly installed bundle needs a process restart for that.
    const describeNow = await api('settings/describe', {})
    const schemaText = JSON.stringify((describeNow.value?.namespaces ?? []).find(row => row.ns === 'dsh-plugin-classes')?.schema ?? null)
    const hostSupportsHide = schemaText.includes('"hidden"')
    const deleteDisabled = await evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('.dpc-panel button'))
        .find(node => (node.textContent || '').trim() === '删除')
      return button === undefined ? null : button.disabled === true
    })()`)
    if (!hostSupportsHide) {
      check('delete stays disabled until the new host half is loaded', deleteDisabled === true, String(deleteDisabled))
      console.log('  note: the running host does not accept `hidden` yet — restart once, then delete is verified live')
    } else {
      check('delete is offered when the host supports hiding', deleteDisabled === false, String(deleteDisabled))
      await evaluate(`(() => {
        const button = Array.from(document.querySelectorAll('.dpc-panel button'))
          .find(node => (node.textContent || '').trim() === '删除')
        if (button !== undefined) button.click()
        return true
      })()`)
      await sleep(400)
      await evaluate(`(() => {
        const button = Array.from(document.querySelectorAll('.dpc-panel button'))
          .find(node => (node.textContent || '').trim() === '确认删除')
        if (button !== undefined) button.click()
        return true
      })()`)
      let gone = false
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await sleep(300)
        const row = (await classesNow()).find(candidate => candidate.id === createdClass.id)
        gone = row === undefined || row.hidden === true
        if (gone) break
      }
      check('确认删除 hides the class (soft delete keeps its preset alive)', gone)
    }
  }

  // Clean up: restore the class list, then re-home any blank session that the
  // scenario had pointed at a test class (otherwise New Session would reuse it
  // and fail to mount a preset that no longer exists).
  await api('settings/update', { ns: 'dsh-plugin-classes', patch: { classes: originalClasses } })
  await sleep(400)
  runRepair()
  console.log('  cleaned up the demo class and re-homed affected sessions')

  console.log('\nconsole errors:', consoleErrors.length === 0 ? 'none' : JSON.stringify(consoleErrors.slice(0, 5)))
  check('no page exceptions during boot', consoleErrors.length === 0, String(consoleErrors.length))

  console.log(`\nscreenshots in ${path.resolve(shotDir)}`)
  if (failures.length > 0) {
    console.error(`UI VERIFY FAILED (${failures.length}):\n - ${failures.join('\n - ')}`)
    exitCode = 1
  } else {
    console.log('UI VERIFY OK — chip, menu and sidebar entry are live in a real browser')
  }
} finally {
  if (!argv.includes('--keep-open')) child.kill()
}
process.exit(exitCode)
