/**
 * Read the boot manifest the browser receives, to prove the host composed this
 * plugin's client bundle (the `/plugins` route itself is revision-addressed, so
 * the manifest — not a bare route fetch — is the authoritative check).
 *
 * Usage: node scripts/probe-boot.mjs [<package>]
 */
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const BASE_URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:19387'
const wanted = process.argv[2] ?? 'dsh-plugin-classes'

const b64 = (value) => Buffer.from(value).toString('base64')
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

const credentials = readFileSync(path.join(DSH_HOME, '.credentials.yaml'), 'utf8').replace(/\r/gu, '')
const match = /client-connection\/browser-session:\s*\n\s*kind:[^\n]*\n\s*payload:\s*\n\s*version:[^\n]*\n\s*secret:\s*([A-Za-z0-9_-]+)/u.exec(credentials)
if (match === null) throw new Error('browser-session secret not found')
const secret = Buffer.from(match[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
const authority = new URL(BASE_URL).host
const name = 'dsh-auth-' + b64(createHash('sha256').update(authority).digest())
const now = Date.now()
const body = b64(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 86400000 }), 'utf8'))
const cookie = name + '=v1.' + body + '.' + b64(createHmac('sha256', secret).update(body).digest())

const response = await fetch(new URL('/', BASE_URL), { headers: { cookie } })
const html = await response.text()
console.log(`index: HTTP ${response.status}, ${html.length} bytes`)

const bootMatch = /window\.__DSH_BOOT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/u.exec(html)
if (bootMatch === null) {
  console.log('no __DSH_BOOT__ found')
  process.exit(1)
}
let boot
try {
  boot = JSON.parse(bootMatch[1].replaceAll('\\u003c', '<'))
} catch (error) {
  console.log('boot manifest is not plain JSON:', String(error.message))
  const index = html.indexOf(wanted)
  console.log(index >= 0 ? `package appears in the raw HTML near ${index}` : 'package absent from the raw HTML')
  process.exit(0)
}

const rows = boot.entries ?? boot.rows ?? []
const hits = JSON.stringify(boot).includes(wanted)
console.log(`boot entries: ${rows.length}`)
console.log(`mentions ${wanted}: ${hits}`)
for (const row of rows) {
  const text = JSON.stringify(row)
  if (text.includes(wanted)) console.log('  row:', text.slice(0, 320))
}
const scripts = [...html.matchAll(/\/plugins\/\?\?[^"']*rev=[^"']*/gu)].map(match => match[0])
console.log(`combo scripts: ${scripts.length}`)
for (const script of scripts) {
  if (script.includes(wanted)) console.log('  combo:', script.slice(0, 320))
}
