/**
 * Build lib/templates.json from the shipped Web bundle's agent presets.
 *
 * A class composes a full agent exactly like a preset does, groups included, so
 * the template must keep the Loader's own row dialect: `!!js` gates become the
 * structural `{ __jsExpr }` nodes the Loader already recognizes
 * (`isJsExpr(value) === value instanceof Object && '__jsExpr' in value`), which
 * survives JSON and our own config round-trip.
 *
 * Usage: node scripts/gen-templates.mjs <merge-repo-root>
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = process.argv[2] ?? 'E:\\orb-build\\merge'
// `yaml` is a deployment dependency here (the desktop profile ships it), not a
// dependency of this package: the generator is a build-time helper only.
const YAML_CANDIDATES = [
  path.join(repo, 'node_modules', 'yaml', 'dist', 'index.js'),
  'E:\\DeepSeek Orb\\dsh-home\\profiles\\desktop\\node_modules\\yaml\\dist\\index.js',
]
let yamlEntry
for (const candidate of YAML_CANDIDATES) {
  try {
    await fs.access(candidate)
    yamlEntry = candidate
    break
  } catch {}
}
if (yamlEntry === undefined) throw new Error(`yaml not found; looked in ${YAML_CANDIDATES.join(', ')}`)
const { parseDocument, isScalar, isMap, isSeq } = await import(pathToFileURL(yamlEntry).href)
const presetsDir = path.join(repo, 'packages', 'bundle', 'web-app', 'presets')
const outFile = new URL('../lib/templates.json', import.meta.url)

/** Preset id -> patch file, in the order a picker should offer them. */
const SOURCES = [
  ['standard', 'standard.patch.yml'],
  ['minimal', 'minimal.patch.yml'],
  ['ptc', 'ptc.patch.yml'],
]

/** Tags the Loader's own dump uses; `!!js` carries an expression string. */
const customTags = [
  {
    tag: 'tag:yaml.org,2002:js',
    resolve(value) {
      return { __jsExpr: String(value) }
    },
  },
]

/**
 * Convert one parsed YAML node into the plain JSON shape the Loader accepts.
 * @param {unknown} node - a yaml Document node.
 * @returns {unknown} plain JSON value; `!!js` nodes keep their expression.
 */
function toPlain(node) {
  if (isScalar(node)) return node.value
  if (isSeq(node)) return node.items.map(toPlain)
  if (isMap(node)) {
    const out = {}
    for (const item of node.items) {
      const key = isScalar(item.key) ? item.key.value : String(item.key)
      out[key] = toPlain(item.value)
    }
    return out
  }
  return undefined
}

/**
 * Extract the insert rows of one preset patch file.
 * @param {string} file - absolute patch path.
 * @returns {Promise<object>} row list of the first `@deepseek-ai/dsh-agent-preset` declaration.
 */
async function readPreset(file) {
  const text = await fs.readFile(file, 'utf8')
  const doc = parseDocument(text, { customTags })
  if (doc.errors.length > 0) throw new Error(`${path.basename(file)}: ${doc.errors[0].message}`)
  const root = toPlain(doc.contents)
  const inserts = Array.isArray(root) ? root.flatMap(row => row?.insert ?? []) : []
  const declaration = inserts.find(row => row?.name === '@deepseek-ai/dsh-agent-preset')
  if (declaration === undefined) throw new Error(`${path.basename(file)}: no agent preset declaration`)
  return declaration.config
}

const templates = {}
for (const [id, file] of SOURCES) {
  const config = await readPreset(path.join(presetsDir, file))
  templates[id] = {
    name: config.name ?? id,
    description: config.description ?? '',
    order: config.order ?? 100,
    plugins: config.plugins ?? [],
  }
}

await fs.mkdir(path.dirname(new URL(outFile).pathname.replace(/^\/([A-Za-z]:)/, '$1')), { recursive: true })
await fs.writeFile(outFile, `${JSON.stringify(templates, null, 2)}\n`, 'utf8')
const summary = Object.entries(templates).map(([id, value]) => `${id}: ${value.plugins.length} rows`).join(', ')
console.log(`wrote ${outFile.pathname.replace(/^\/([A-Za-z]:)/, '$1')} (${summary})`)
