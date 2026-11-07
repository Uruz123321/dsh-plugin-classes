/**
 * Focused probe: why the assign dialog does (not) render.
 *
 * Removes one installed plugin from the assignment record, opens the page, and
 * reads the live client store through the plugin's debug handle, so a missing
 * dialog can be attributed to either "nothing pending" or "not rendered".
 *
 * Usage: node scripts/probe-assign.mjs [<package>]
 */
import { createHash, createHmac } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const BASE_URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:19387'
const ENTRY_ID = 'dsh-plugin-classes'
const target = process.argv[2] ?? 'dsh-video-skin'

const b64 = (value) => Buffer.from(value).toString('base64')
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
const text = readFileSync(path.join(DSH_HOME, '.credentials.yaml'), 'utf8').replace(/\r/gu, '')
const match = /client-connection\/browser-session:\s*\n\s*kind:[^\n]*\n\s*payload:\s*\n\s*version:[^\n]*\n\s*secret:\s*([A-Za-z0-9_-]+)/u.exec(text)
const secret = Buffer.from(match[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
const authority = new URL(BASE_URL).host
const now = Date.now()
const body = b64(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 86400000 }), 'utf8'))
const cookieName = 'dsh-auth-' + b64(createHash('sha256').update(authority).digest())
const cookieValue = 'v1.' + body + '.' + b64(createHmac('sha256', secret).update(body).digest())

async function api(endpoint, args) {
  const response = await fetch(new URL('/api/' + endpoint, BASE_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieName + '=' + cookieValue },
    body: JSON.stringify({ type: 'client-request', rpcId: 'pa', method: endpoint, payload: { args } }),
  })
  return (await response.json()).result
}
const value = async (endpoint, args) => {
  const result = await api(endpoint, args)
  if (!result || result.ok !== true) throw new Error(`${endpoint}: ${JSON.stringify(result && result.error)}`)
  return result.value
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const namespace = async () => {
  const describe = await value('settings/describe', {})
  return (describe.namespaces ?? []).find(row => row.ns === ENTRY_ID)?.value ?? {}
}

const before = await namespace()
const plugins = Object.assign({}, before.plugins || {})
const removed = plugins[target]
delete plugins[target]
await value('settings/update', { ns: ENTRY_ID, patch: { plugins } })
console.log(`removed assignment for ${target} (was ${JSON.stringify(removed)})`)

const bundles = await value('pluginManager/listBundles', {})
const installed = (bundles ?? []).filter(bundle => bundle.installed === true).map(bundle => bundle.name)
console.log('installed:', JSON.stringify(installed))
console.log('expected pending on load:', JSON.stringify(installed.filter(name => plugins[name] === undefined)))

const executable = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
].find(candidate => existsSync(candidate))
const port = 9800 + Math.floor(Math.random() * 100)
const child = spawn(executable, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + path.join(os.tmpdir(), 'dsh-pa-' + String(process.pid)),
  '--remote-debugging-port=' + String(port), '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })

try {
  let wsUrl
  for (let attempt = 0; attempt < 60 && wsUrl === undefined; attempt += 1) {
    await sleep(250)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) wsUrl = (await response.json()).webSocketDebuggerUrl
    } catch {}
  }
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let nextId = 1
  const pending = new Map()
  const errors = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails?.text)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' '))
    }
    const waiter = pending.get(message.id)
    if (waiter === undefined) return
    pending.delete(message.id)
    waiter.resolve(message.result)
  })
  const raw = (method, params, sessionId) => new Promise((resolve) => {
    const id = nextId++
    pending.set(id, { resolve })
    socket.send(JSON.stringify({ id, method, params: params ?? {}, ...(sessionId === undefined ? {} : { sessionId }) }))
  })
  const { targetId } = await raw('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await raw('Target.attachToTarget', { targetId, flatten: true })
  const send = (method, params) => raw(method, params, sessionId)
  await send('Page.enable', {})
  await send('Runtime.enable', {})
  await send('Network.enable', {})
  await send('Network.setCookie', { name: cookieName, value: cookieValue, domain: new URL(BASE_URL).hostname, path: '/', httpOnly: true, sameSite: 'Strict' })
  await send('Page.navigate', { url: BASE_URL + '/' })

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    return result.result?.value
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(300)
    if (await evaluate(`document.querySelector('[data-composer-card], .dpc-chip, textarea') !== null`)) break
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const skipped = await evaluate(`(() => {
      const skip = Array.from(document.querySelectorAll('button, div, span')).find(node => (node.textContent || '').trim() === '点击画面跳过')
      if (skip === undefined) return 'absent'
      skip.click()
      return 'clicked'
    })()`)
    if (skipped !== 'clicked') break
    await sleep(400)
  }
  await evaluate(`(() => {
    const dismiss = Array.from(document.querySelectorAll('button')).find(node => (node.textContent || '').trim() === '继续')
    if (dismiss !== undefined) dismiss.click()
    return true
  })()`)
  await sleep(2500)

  console.log('\nclient store:')
  console.log('  status:', await evaluate(`window.__dshPluginClasses?.state()?.status ?? 'no handle'`))
  console.log('  pending():', JSON.stringify(await evaluate(`window.__dshPluginClasses?.pending?.() ?? 'no handle'`)))
  console.log('  plugin names:', JSON.stringify(await evaluate(`Object.keys(window.__dshPluginClasses?.state()?.plugins ?? {})`)))
  console.log('  bundles installed:', JSON.stringify(await evaluate(`(window.__dshPluginClasses?.state()?.bundles ?? []).filter(b => b.installed === true).map(b => b.name)`)))
  console.log('  .dpc-overlay in DOM:', await evaluate(`document.querySelectorAll('.dpc-overlay').length`))
  console.log('  .dpc-dialog in DOM:', await evaluate(`document.querySelectorAll('.dpc-dialog').length`))
  console.log('  console errors:', errors.length === 0 ? 'none' : JSON.stringify(errors.slice(0, 3)))
} finally {
  child.kill()
  await value('settings/update', { ns: ENTRY_ID, patch: { plugins: before.plugins ?? {} } })
  console.log('\nrestored the assignment record')
}
