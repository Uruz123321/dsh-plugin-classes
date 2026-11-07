/**
 * Host-side verification probe for the desktop profile.
 *
 * The Web host authenticates every `/api` call with an authority-bound cookie
 * signed by the `client-connection/browser-session` secret in
 * `$DSH_HOME/.credentials.yaml`, so this script mints that cookie from the
 * local secret and calls the Remote endpoints over loopback — the same wire the
 * browser uses. Nothing is written; the secret never leaves the process.
 *
 * Usage: node scripts/probe.mjs <endpoint> [<endpoint> ...]
 * Example: node scripts/probe.mjs agentPresets/list pluginInventory/list
 */
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const BASE_URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:19387'

/** base64url without padding, the encoding the host's cookie writer uses. */
function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

/**
 * Read the browser-session signing secret out of the credential file.
 * @returns {Buffer} 32-byte secret.
 */
function browserSessionSecret() {
  const text = readFileSync(path.join(DSH_HOME, '.credentials.yaml'), 'utf8')
  const lines = text.split(/\r?\n/u)
  let inRecord = false
  for (const line of lines) {
    if (/^ {2}[\w@"'./-]+:\s*$/u.test(line)) inRecord = line.trim() === 'client-connection/browser-session:'
    if (!inRecord) continue
    const match = /^\s+secret:\s*([A-Za-z0-9_-]+)\s*$/u.exec(line)
    if (match !== null) {
      const decoded = Buffer.from(match[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
      if (decoded.byteLength !== 32) throw new Error('browser-session secret is not 32 bytes')
      return decoded
    }
  }
  throw new Error('no client-connection/browser-session secret in .credentials.yaml')
}

/**
 * Mint the cookie the host accepts for this authority.
 * @returns {string} `name=value` for the Cookie header.
 */
function mintCookie() {
  const secret = browserSessionSecret()
  const authority = new URL(BASE_URL).host
  const name = 'dsh-auth-' + encodeBase64Url(createHash('sha256').update(authority).digest())
  const now = Date.now()
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + 7 * 24 * 60 * 60 * 1000 }
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const signature = encodeBase64Url(createHmac('sha256', secret).update(body).digest())
  return name + '=v1.' + body + '.' + signature
}

/**
 * Call one Remote endpoint over the `/api` bridge.
 * @param {string} cookie - Cookie header value.
 * @param {string} endpoint - `<namespace>/<method>`.
 * @param {unknown} payload - request payload (`{ args }` for Typert calls).
 * @returns {Promise<{status: number, body: unknown}>}
 */
async function call(cookie, endpoint, payload) {
  const response = await fetch(new URL('/api/' + endpoint, BASE_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: 'probe-' + endpoint.replace('/', '-'), method: endpoint, payload }),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body }
}

const argv = process.argv.slice(2)
let outPath
const endpoints = []
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === '--out') {
    outPath = argv[(index += 1)]
    continue
  }
  endpoints.push(argv[index])
}
if (endpoints.length === 0) {
  console.error('usage: node scripts/probe.mjs [--out file] <endpoint> [<endpoint> ...]')
  process.exit(2)
}

const cookie = mintCookie()
if (outPath !== undefined) {
  const collected = {}
  for (const endpoint of endpoints) {
    collected[endpoint] = await call(cookie, endpoint, { args: {} })
  }
  await writeFile(outPath, JSON.stringify(collected, null, 2), 'utf8')
  console.log(`wrote ${outPath} (${endpoints.join(', ')})`)
} else {
  for (const endpoint of endpoints) {
    const result = await call(cookie, endpoint, { args: {} })
    console.log(`\n=== ${endpoint} → HTTP ${result.status}`)
    console.log(JSON.stringify(result.body, null, 2).slice(0, 200000))
  }
}
