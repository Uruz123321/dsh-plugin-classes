/**
 * Repair sessions that are bound to a plugin-class preset which no longer exists.
 *
 * Deleting a class retires its preset id, so a *blank* session that had selected
 * that class can no longer be adopted — and the New Session surface reuses that
 * blank session, which makes "new session" fail with `agent-preset/not-found`.
 * That is a data-level break, and no `agentPresets.select` can fix it directly
 * because adopting the session mounts the missing preset first.
 *
 * This script breaks the deadlock the only safe way: it temporarily re-creates a
 * class whose id yields the missing preset, waits for the host to register it,
 * rebinds the affected blank sessions to the host baseline, and then removes the
 * temporary classes again.
 *
 * Usage: node scripts/repair-sessions.mjs [--dry-run]
 */
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const BASE_URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:19387'
const ENTRY_ID = 'dsh-plugin-classes'
const HOST_PRESET_ID = 'cls-host'
const dryRun = process.argv.includes('--dry-run')

const b64 = (value) => Buffer.from(value).toString('base64')
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

function mintCookie() {
  const text = readFileSync(path.join(DSH_HOME, '.credentials.yaml'), 'utf8').replace(/\r/gu, '')
  const match = /client-connection\/browser-session:\s*\n\s*kind:[^\n]*\n\s*payload:\s*\n\s*version:[^\n]*\n\s*secret:\s*([A-Za-z0-9_-]+)/u.exec(text)
  if (match === null) throw new Error('browser-session secret not found')
  const secret = Buffer.from(match[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  const authority = new URL(BASE_URL).host
  const name = 'dsh-auth-' + b64(createHash('sha256').update(authority).digest())
  const now = Date.now()
  const body = b64(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 86400000 }), 'utf8'))
  return name + '=v1.' + body + '.' + b64(createHmac('sha256', secret).update(body).digest())
}

const cookie = mintCookie()

async function call(endpoint, args) {
  const response = await fetch(new URL('/api/' + endpoint, BASE_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: 'repair-' + endpoint.replace('/', '-'), method: endpoint, payload: { args } }),
  })
  return (await response.json()).result
}
async function value(endpoint, args) {
  const result = await call(endpoint, args)
  if (!result || result.ok !== true) throw new Error(`${endpoint} failed: ${JSON.stringify(result && result.error)}`)
  return result.value
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/** Read the plugin-class namespace value. */
async function classState() {
  const describe = await value('settings/describe', {})
  const namespace = (describe.namespaces ?? []).find(row => row.ns === ENTRY_ID)
  return { classes: [], ...(namespace?.value ?? {}) }
}

/** Poll the roster for a preset id. */
async function waitPreset(presetId, attempts = 25) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const roster = await value('agentPresets/list', {})
    if ((roster.presets ?? []).some(row => row.id === presetId)) return true
    await sleep(200)
  }
  return false
}

console.log(`host: ${BASE_URL}${dryRun ? ' (dry run)' : ''}\n`)

const roster = await value('agentPresets/list', {})
const known = new Set((roster.presets ?? []).map(row => row.id))
const sessions = await value('session/list', { _request: {} })
const items = sessions.items ?? []
console.log(`sessions: ${items.length}, presets: ${known.size}`)

/** Blank sessions whose preset a class preset no longer exists. */
const broken = []
for (const item of items) {
  const preset = item.projections?.values?.agentPreset
  if (typeof preset !== 'string' || !preset.startsWith('cls-')) continue
  if (known.has(preset)) continue
  broken.push({ sessionId: item.sessionId, preset, blank: item.blank === true })
}
if (broken.length === 0) {
  console.log('no session is bound to a missing class preset — nothing to repair')
  process.exit(0)
}
console.log('sessions bound to a missing class preset:')
for (const row of broken) console.log(`  ${row.sessionId} blank=${row.blank} preset=${row.preset}`)

// Every missing preset id maps back to a class id (`cls-<id>`); a combination
// preset (`cls-a+b`) is repaired through its first member, which is enough to
// make the id resolvable again for a blank session.
const missingClassIds = [...new Set(broken.map(row => {
  const rest = row.preset.slice('cls-'.length)
  return rest.split('+')[0]
}).filter(id => id !== '' && id !== 'host'))]
console.log(`temporary classes to create: ${JSON.stringify(missingClassIds)}`)
if (dryRun) process.exit(0)

const state = await classState()
const userClasses = Array.isArray(state.classes) ? state.classes : []
const missing = new Set(missingClassIds)
const temporary = [...missing]
  .filter(id => !userClasses.some(row => row.id === id))
  .map(id => ({ id, name: `(修复临时) ${id}`, description: 'repair-sessions.mjs', base: 'standard', remove: [], add: [] }))

if (temporary.length > 0) {
  await value('settings/update', { ns: ENTRY_ID, patch: { classes: [...userClasses, ...temporary] }, expectedRevision: undefined })
  for (const pluginClass of temporary) {
    const ready = await waitPreset('cls-' + pluginClass.id)
    console.log(`  ${'cls-' + pluginClass.id}: ${ready ? 'registered' : 'NOT registered'}`)
  }
}

let rebindFailures = 0
for (const row of broken) {
  const result = await call('agentPresets/select', { agentId: row.sessionId, agentPreset: HOST_PRESET_ID })
  if (result && result.ok === true) {
    console.log(`  ${row.sessionId} → ${HOST_PRESET_ID}`)
  } else {
    rebindFailures += 1
    console.log(`  ${row.sessionId} rebind FAILED: ${JSON.stringify(result && result.error)}`)
  }
}

const after = await classState()
const remaining = (Array.isArray(after.classes) ? after.classes : [])
  .filter(row => !missing.has(row.id) || !temporary.some(temp => temp.id === row.id))
await value('settings/update', { ns: ENTRY_ID, patch: { classes: remaining }, expectedRevision: undefined })
console.log(`temporary classes removed (${temporary.length})`)

const verified = await value('session/list', { _request: {} })
const stillBroken = (verified.items ?? []).filter(item => {
  const preset = item.projections?.values?.agentPreset
  return typeof preset === 'string' && preset.startsWith('cls-') && !new Set((roster.presets ?? []).map(row => row.id)).has(preset)
})
console.log(`\nremaining broken sessions: ${stillBroken.length}, rebind failures: ${rebindFailures}`)
process.exit(stillBroken.length === 0 && rebindFailures === 0 ? 0 : 1)
