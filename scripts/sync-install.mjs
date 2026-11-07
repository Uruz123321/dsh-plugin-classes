/**
 * Copy this plugin into the desktop profile's node_modules.
 *
 * A junction/symlink would fail: Node resolves a module's real path before it
 * resolves that module's own imports, so `@deepseek-ai/schemastery` would be
 * looked up beside `dsh_orb/plugin-classes` instead of inside the profile. A
 * physical copy keeps dependency resolution next to the profile's other
 * plugins, which is where the Loader expects a bundle to live.
 *
 * Usage: node scripts/sync-install.mjs [profileDir]
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profileDir = process.argv[2] ?? process.env.DSH_PROFILE_DIR ?? path.join(process.env.DSH_HOME ?? '', 'profiles', 'desktop')
const target = path.join(profileDir, 'node_modules', 'dsh-plugin-classes')

/** Files that belong to the installed plugin (and nothing else). */
const ENTRIES = ['package.json', 'cordis.patch.yml', 'lib', 'README.md']

await mkdir(target, { recursive: true })
for (const entry of ENTRIES) {
  const source = path.join(packageRoot, entry)
  try {
    await stat(source)
  } catch {
    continue
  }
  const destination = path.join(target, entry)
  if (entry === 'lib') {
    // Mirror lib exactly: stale bundles would otherwise keep loading.
    await rm(destination, { recursive: true, force: true })
  }
  await cp(source, destination, { recursive: true, force: true })
}

const installed = await readdir(target)
console.log(`installed ${path.basename(packageRoot)} -> ${target}`)
console.log(`entries: ${installed.join(', ')}`)
