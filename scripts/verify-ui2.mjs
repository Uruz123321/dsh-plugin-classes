/**
 * Browser verification for the multi-class model.
 *
 * Covers what the earlier scenario does not: the host baseline as the default
 * class, ticking several classes in the composer chip, unticking one, and the
 * dialog that files a newly downloaded plugin into classes.
 *
 * Usage: node scripts/verify-ui2.mjs [--keep-open]
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
const ENTRY_ID = 'dsh-plugin-classes'
const argv = process.argv.slice(2)
const shotDir = path.join(scriptDir, '..', '.shots')

/**
 * Re-home sessions bound to a missing class preset, before and after a run.
 * Verification must never leave the profile in a state where New Session fails.
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

/** Mint the browser cookie the host accepts. */
function mintCookie() {
  const text = readFileSync(path.join(DSH_HOME, '.credentials.yaml'), 'utf8').replace(/\r/gu, '')
  const match = /client-connection\/browser-session:\s*\n\s*kind:[^\n]*\n\s*payload:\s*\n\s*version:[^\n]*\n\s*secret:\s*([A-Za-z0-9_-]+)/u.exec(text)
  if (match === null) throw new Error('browser-session secret not found')
  const secret = Buffer.from(match[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  const authority = new URL(BASE_URL).host
  const name = 'dsh-auth-' + b64(createHash('sha256').update(authority).digest())
  const now = Date.now()
  const body = b64(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 86400000 }), 'utf8'))
  return { name, value: 'v1.' + body + '.' + b64(createHmac('sha256', secret).update(body).digest()) }
}

const cookie = mintCookie()

/** One Remote call over /api. */
async function api(endpoint, args) {
  const response = await fetch(new URL('/api/' + endpoint, BASE_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookie.name + '=' + cookie.value },
    body: JSON.stringify({ type: 'client-request', rpcId: 'v2-' + endpoint.replace('/', '-'), method: endpoint, payload: { args } }),
  })
  return (await response.json()).result
}
const value = async (endpoint, args) => {
  const result = await api(endpoint, args)
  if (!result || result.ok !== true) throw new Error(`${endpoint} failed: ${JSON.stringify(result && result.error)}`)
  return result.value
}
const namespaceValue = async () => {
  const describe = await value('settings/describe', {})
  return (describe.namespaces ?? []).find(row => row.ns === ENTRY_ID)?.value ?? {}
}

/** Launch headless Chromium and return its DevTools browser endpoint. */
async function launch() {
  const executable = BROWSERS.find(candidate => existsSync(candidate))
  if (executable === undefined) throw new Error('no Chrome/Edge found')
  const port = 9600 + Math.floor(Math.random() * 200)
  const child = spawn(executable, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(os.tmpdir(), 'dsh-v2-' + String(process.pid)),
    '--remote-debugging-port=' + String(port), '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(250)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return { child, wsUrl: (await response.json()).webSocketDebuggerUrl }
    } catch {}
  }
  child.kill()
  throw new Error('DevTools endpoint never appeared')
}

console.log(`host: ${BASE_URL}\n`)

// ─── prepare two classes, and a plugin that needs filing ────────────────────
const before = await namespaceValue()
const originalClasses = Array.isArray(before.classes) ? before.classes : []
const originalSessions = before.sessions && typeof before.sessions === 'object' ? before.sessions : {}
const originalPlugins = before.plugins && typeof before.plugins === 'object' ? before.plugins : {}
const demoClasses = [
  { id: 'ui2-a', name: 'UI2 甲', description: '多选验证 A', base: 'standard', remove: ['tool-web'], add: [] },
  { id: 'ui2-b', name: 'UI2 乙', description: '多选验证 B', base: 'standard', remove: [], add: [{ id: '', name: 'dsh-whale-widget', disabled: false }] },
]
await value('settings/update', { ns: ENTRY_ID, patch: { classes: [...originalClasses, ...demoClasses] } })
for (let attempt = 0; attempt < 25; attempt += 1) {
  await sleep(250)
  const roster = await value('agentPresets/list', {})
  if ((roster.presets ?? []).some(row => row.id === 'cls-ui2-a')) break
}
// Pretend "dsh-video-skin" was just downloaded and never filed.
// `settings.update` merges objects, so a deleted key has to go through
// `settings.replace` with the whole section — otherwise the key survives the
// merge and no plugin is ever "pending".
const pendingName = 'dsh-video-skin'
const pluginsForPrompt = Object.assign({}, originalPlugins)
delete pluginsForPrompt[pendingName]
await value('settings/replace', {
  ns: ENTRY_ID,
  section: {
    classes: [...originalClasses, ...demoClasses],
    host: before.host ?? {},
    sessions: originalSessions,
    plugins: pluginsForPrompt,
  },
  expectedRevision: undefined,
})

const { child, wsUrl } = await launch()
let exitCode = 0
try {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (waiter === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined) waiter.reject(new Error(JSON.stringify(message.error)))
    else waiter.resolve(message.result)
  })
  const raw = (method, params, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params: params ?? {}, ...(sessionId === undefined ? {} : { sessionId }) }))
  })
  const { targetId } = await raw('Target.createTarget', { url: 'about:blank' })
  const attached = await raw('Target.attachToTarget', { targetId, flatten: true })
  const sessionId0 = attached.sessionId
  const send = (method, params) => raw(method, params, sessionId0)

  await send('Page.enable', {})
  await send('Runtime.enable', {})
  await send('Network.enable', {})
  await send('Network.setCookie', {
    name: cookie.name, value: cookie.value, domain: new URL(BASE_URL).hostname, path: '/', httpOnly: true, sameSite: 'Strict',
  })
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: BASE_URL + '/' })

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  const shot = async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    mkdirSync(shotDir, { recursive: true })
    writeFileSync(path.join(shotDir, file), Buffer.from(data, 'base64'))
  }

  for (let attempt = 0; attempt < 80; attempt += 1) {
    await sleep(300)
    if (await evaluate('document.querySelector("[data-composer-card], .dpc-chip, textarea") !== null').catch(() => false)) break
  }
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
  await evaluate(`(() => {
    const dismiss = Array.from(document.querySelectorAll('button')).find(node => (node.textContent || '').trim() === '继续')
    if (dismiss !== undefined) dismiss.click()
    return true
  })()`).catch(() => {})
  await sleep(1200)

  console.log('1. the assign dialog for a new plugin')
  let dialog = null
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await sleep(300)
    dialog = await evaluate(`(() => {
      const root = document.querySelector('.dpc-dialog')
      if (root === null) return null
      return {
        title: root.querySelector('h2')?.textContent ?? '',
        items: Array.from(root.querySelectorAll('.dpc-dialog-item')).map(node => node.textContent),
        hasLater: Array.from(root.querySelectorAll('button')).some(node => (node.textContent || '').includes('暂不加入')),
      }
    })()`)
    if (dialog !== null) break
  }
  check('the assign dialog appears for an unfiled plugin', dialog !== null, JSON.stringify(dialog))
  check('it lists the classes to choose from', (dialog?.items ?? []).some(text => text.includes('UI2 甲')), JSON.stringify(dialog?.items))
  await shot('10-assign-dialog.png')
  await evaluate(`(() => {
    const later = Array.from(document.querySelectorAll('.dpc-dialog button')).find(node => (node.textContent || '').includes('暂不加入'))
    if (later !== undefined) later.click()
    return true
  })()`)
  await sleep(1500)
  const filed = (await namespaceValue()).plugins || {}
  check('“暂不加入” records the plugin as handled', filed[pendingName] !== undefined, JSON.stringify(filed[pendingName]))

  console.log('\n2. a fresh session starts on the host baseline')
  await evaluate(`(() => {
    const target = Array.from(document.querySelectorAll('button, [role="button"], a, div[tabindex]'))
      .filter(node => (node.textContent || '').trim().startsWith('新会话'))
      .find(node => node.offsetParent !== null)
    if (target !== undefined) target.click()
    return target !== undefined
  })()`)
  await sleep(1800)
  const hostChip = await evaluate(`document.querySelector('.dpc-chip')?.textContent ?? null`)
  check('a new session shows the host baseline only', (hostChip || '').includes('仅宿主基线'), String(hostChip))
  const rosterNow = await value('agentPresets/list', {})
  check('the host class is the deployment default',
    (rosterNow.presets ?? []).some(row => row.id === 'cls-host' && row.isDefault === true),
    JSON.stringify((rosterNow.presets ?? []).filter(row => row.isDefault).map(row => row.id)))

  console.log('\n3. ticking two classes in the chip')
  const openChip = async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (await evaluate(`document.querySelector('.dpc-menu') !== null`)) return true
      await evaluate(`(() => { document.querySelector('.dpc-chip').click(); return true })()`)
      await sleep(500)
    }
    return await evaluate(`document.querySelector('.dpc-menu') !== null`)
  }
  const clickClass = async (name) => {
    await openChip()
    const clicked = await evaluate(`(() => {
      const item = Array.from(document.querySelectorAll('.dpc-menu .dpc-item'))
        .find(node => (node.textContent || '').includes(${JSON.stringify(name)}))
      if (item === undefined) return false
      item.click()
      return true
    })()`)
    await sleep(2000)
    return clicked
  }
  await openChip()
  check('chip menu opened', (await evaluate(`document.querySelector('.dpc-menu') !== null`)) === true)
  check('ticked first class', (await clickClass('UI2 甲')) === true)
  const afterFirst = await evaluate(`document.querySelector('.dpc-chip')?.textContent ?? ''`)
  check('chip shows the first class', afterFirst.includes('UI2 甲'), afterFirst)
  check('ticked second class', (await clickClass('UI2 乙')) === true)
  const afterSecond = await evaluate(`document.querySelector('.dpc-chip')?.textContent ?? ''`)
  check('chip shows both classes', afterSecond.includes('UI2 甲') && afterSecond.includes('UI2 乙'), afterSecond)
  await shot('11-chip-two-classes.png')

  const sessionState = await namespaceValue()
  const recordedSessions = Object.entries(sessionState.sessions || {})
  const withTwo = recordedSessions.find(([, ids]) => Array.isArray(ids) && ids.includes('ui2-a') && ids.includes('ui2-b'))
  check('both classes are recorded for the session', withTwo !== undefined, JSON.stringify(recordedSessions))
  const combos = await value('agentPresets/list', {})
  check('the combination preset exists', (combos.presets ?? []).some(row => row.id === 'cls-ui2-a+ui2-b'),
    JSON.stringify((combos.presets ?? []).map(row => row.id)))

  console.log('\n4. unticking one class')
  check('unticked the first class', (await clickClass('UI2 甲')) === true)
  const afterUnpick = await evaluate(`document.querySelector('.dpc-chip')?.textContent ?? ''`)
  check('chip keeps only the second class', afterUnpick.includes('UI2 乙') && !afterUnpick.includes('UI2 甲'), afterUnpick)
  const afterValue = await namespaceValue()
  const single = Object.entries(afterValue.sessions || {})
    .find(([, ids]) => Array.isArray(ids) && ids.includes('ui2-b') && !ids.includes('ui2-a'))
  check('the session record shrank to one class', single !== undefined,
    JSON.stringify(Object.entries(afterValue.sessions || {})))
  await shot('12-chip-one-class.png')

  console.log('\n5. panel reflects the model')
  await evaluate(`(() => {
    const target = Array.from(document.querySelectorAll('button, [role="button"]'))
      .find(node => ((node.getAttribute('aria-label') || node.textContent || '')).includes('插件管理'))
    if (target !== undefined) target.click()
    return target !== undefined
  })()`)
  await sleep(1200)
  const panel = await evaluate(`(() => {
    const root = document.querySelector('.dpc-panel')
    if (root === null) return null
    return {
      rail: Array.from(root.querySelectorAll('.dpc-rail-name')).map(node => node.textContent),
      hostNote: root.querySelector('.dpc-rail-host')?.textContent ?? null,
      hasBaseSelect: root.querySelector('#dpc-base') !== null,
      error: root.querySelector('.dpc-error')?.textContent ?? null,
      rows: root.querySelectorAll('.dpc-list .dpc-row').length,
    }
  })()`)
  check('panel lists both classes', (panel?.rail ?? []).includes('UI2 甲') && (panel?.rail ?? []).includes('UI2 乙'), JSON.stringify(panel?.rail))
  check('panel marks the host baseline as hidden', panel?.hostNote !== null && String(panel?.hostNote).length > 0, String(panel?.hostNote))
  check('the per-class base selector is gone', panel?.hasBaseSelect === false)
  check('panel has no read error', panel?.error === null, String(panel?.error))
  await shot('13-panel.png')

  // ─── cleanup ─────────────────────────────────────────────────────────────
  await value('settings/replace', {
    ns: ENTRY_ID,
    section: {
      classes: originalClasses,
      host: before.host ?? {},
      sessions: originalSessions,
      plugins: originalPlugins,
    },
    expectedRevision: undefined,
  })
  await sleep(500)
  // The scenario ticked test classes on a blank session; re-home whatever is now
  // bound to a preset that the restore removed, so New Session keeps working.
  runRepair()
  console.log('\n  restored the previous classes, sessions and assignments (sessions re-homed)')
  if (failures.length > 0) {
    console.error(`UI2 VERIFY FAILED (${failures.length}):\n - ${failures.join('\n - ')}`)
    exitCode = 1
  } else {
    console.log('UI2 VERIFY OK — baseline default, multi-select add/remove, assign dialog, panel')
  }
} finally {
  if (!argv.includes('--keep-open')) child.kill()
}
process.exit(exitCode)
