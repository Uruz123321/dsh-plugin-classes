#!/usr/bin/env node
/**
 * Publish-manifest check for dsh-plugin-classes.
 *
 * Validates the package.json fields a DeepSeek Harness plugin needs to be
 * installable and listable, plus that every path named by the manifest actually
 * exists. Run with `npm run check` (also part of `prepublishOnly`).
 *
 * Exit code 1 on any hard problem. A remaining OWNER placeholder in the repo
 * URLs is only a warning: it is the one edit a fork has to make.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(root, p))

const problems = []
const warnings = []
const ok = []

const fail = (msg) => problems.push(msg)
const warn = (msg) => warnings.push(msg)
const pass = (msg) => ok.push(msg)

let pkg
try {
  pkg = JSON.parse(read('package.json'))
} catch (error) {
  console.error(`cannot parse package.json: ${error.message}`)
  process.exit(1)
}

/** A non-empty string, optionally matching a shape. */
function requireString(field, value, { min = 1, pattern, label } = {}) {
  if (typeof value !== 'string' || value.trim().length < min) {
    fail(`${field} must be a string of at least ${min} characters`)
    return false
  }
  if (pattern && !pattern.test(value)) {
    fail(`${field} does not look like ${label ?? 'the expected shape'}: ${value}`)
    return false
  }
  pass(field)
  return true
}

// ---- identity -------------------------------------------------------------
requireString('name', pkg.name, { pattern: /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/, label: 'an npm package name' })
requireString('version', pkg.version, { pattern: /^\d+\.\d+\.\d+(?:-[\w.]+)?$/, label: 'a semver version' })
if (typeof pkg.description !== 'string' || pkg.description.length < 40) {
  fail('description should be at least 40 characters (it is the market card text)')
} else {
  pass('description')
}
requireString('license', pkg.license)
requireString('author', pkg.author)

// ---- DSH metadata ---------------------------------------------------------
if (!pkg.dsh || typeof pkg.dsh !== 'object') fail('dsh is required: a DSH plugin declares dsh.bundle')
const dsh = pkg.dsh ?? {}

if (!dsh.bundle || !dsh.bundle.patch) {
  fail('dsh.bundle.patch is required — without it `dsh plugin add` cannot mount the package')
} else {
  const patches = Array.isArray(dsh.bundle.patch) ? dsh.bundle.patch : [dsh.bundle.patch]
  for (const patch of patches) {
    if (!exists(patch)) fail(`dsh.bundle.patch "${patch}" does not exist`)
    else pass(`dsh.bundle.patch → ${patch}`)
  }
}

if (dsh.client && dsh.client.platform !== 'web') {
  fail('dsh.client.platform should be "web" for this plugin')
} else if (dsh.client) {
  pass('dsh.client.platform → web')
}

if (dsh.manifestVersion !== 1) warn('dsh.manifestVersion is 1 for the current format; declare it explicitly')
else pass('dsh.manifestVersion')

if (!pkg.engines || !pkg.engines.dsh) warn('engines.dsh is missing: state the compatible DSH range')
else pass('engines.dsh')

const compat = dsh.compatibility
if (!compat || typeof compat !== 'object') {
  warn('dsh.compatibility is missing: users and markets read it for the supported range')
} else {
  if (compat.dsh !== pkg.engines?.dsh) warn('dsh.compatibility.dsh and engines.dsh disagree')
  if (!Array.isArray(compat.profiles) || compat.profiles.length === 0) {
    warn('dsh.compatibility.profiles is empty')
  } else pass('dsh.compatibility')
}

// ---- publish surface ------------------------------------------------------
if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
  fail('files whitelist is required so tests and screenshots never ship')
} else {
  for (const entry of pkg.files) {
    if (entry === 'node_modules' || entry.startsWith('scripts') || entry.startsWith('.')) {
      fail(`files must not contain "${entry}"`)
      continue
    }
    const target = path.join(root, entry)
    if (!fs.existsSync(target)) fail(`files entry "${entry}" does not exist`)
  }
  pass(`files (${pkg.files.join(', ')})`)
}

for (const doc of ['README.md', 'README.zh.md', 'LICENSE', 'CHANGELOG.md']) {
  if (!exists(doc)) fail(`${doc} is missing`)
  else pass(doc)
}

// ---- entry points ---------------------------------------------------------
const entries = [pkg.main, ...Object.values(pkg.exports ?? {}).flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v ?? {})))]
for (const entry of [...new Set(entries.filter(Boolean))]) {
  if (entry === './package.json') continue
  if (!exists(entry.replace(/^\.\//, ''))) fail(`entry point ${entry} does not exist`)
}
pass('entry points resolve')

// ---- repository URLs ------------------------------------------------------
for (const [field, value] of [
  ['repository.url', pkg.repository?.url],
  ['homepage', pkg.homepage],
  ['bugs.url', pkg.bugs?.url],
]) {
  if (typeof value !== 'string') {
    fail(`${field} is required for registry/market listing`)
    continue
  }
  if (value.includes('OWNER')) warn(`${field} still contains the OWNER placeholder: ${value}`)
  else pass(field)
}

// ---- scripts --------------------------------------------------------------
if (!pkg.scripts?.test) warn('scripts.test is missing: CI cannot verify the package')
if (!pkg.scripts?.prepublishOnly) warn('scripts.prepublishOnly is missing: a broken package can be published')

// ---- report ---------------------------------------------------------------
const line = (mark, list) => list.forEach((msg) => console.log(`  ${mark} ${msg}`))
if (ok.length) line('ok  ', ok)
if (warnings.length) line('warn', warnings)
if (problems.length) {
  line('FAIL', problems)
  console.error(`\nMANIFEST INVALID — ${problems.length} problem(s), ${warnings.length} warning(s)`)
  process.exit(1)
}
console.log(`\nMANIFEST OK — ${ok.length} checks, ${warnings.length} warning(s)`)
