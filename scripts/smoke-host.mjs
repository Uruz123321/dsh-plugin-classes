/**
 * Host-half smoke test: drive `apply()` against a stub agent-preset registry.
 *
 * The desktop profile composes new bundles only at startup, so this proves the
 * registration lifecycle — host baseline, single classes, multi-class
 * combinations, edits and teardown — without restarting anything.
 *
 * Usage: node scripts/smoke-host.mjs
 */
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// The host module imports DSH's own services, so it must be loaded from the
// profile install (where those peers resolve), not from the workspace checkout.
const installed = path.join(
  process.env.DSH_PROFILE_DIR ?? path.join(process.env.DSH_HOME ?? '', 'profiles', 'desktop'),
  'node_modules',
  'dsh-plugin-classes',
  'lib',
  'host2.js',
)
const modulePath = process.argv[2] ?? installed
const host = await import(pathToFileURL(modulePath).href)
console.log(`host module: ${modulePath}\n`)

const failures = []
const check = (label, condition, detail) => {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures.push(label + (detail === undefined ? '' : ` (${detail})`))
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` (${detail})`}`)
  }
}

/** Live state the volatile references return. */
const state = {
  classes: [],
  host: {},
  sessions: {},
  plugins: {},
}
const registrations = []
const disposals = []
/** Preset id -> live definition, the roster the stub registry actually holds. */
const live = new Map()
const listeners = {}
const effects = []
const updates = []

const ctx = {
  fiber: { id: 'stub-fiber' },
  logger: { warn: (message) => console.log(`  [warn] ${message}`), info: () => {}, debug: () => {} },
  on: (event, listener) => {
    listeners[event] = listener
    return () => { delete listeners[event] }
  },
  effect: (fn, label) => {
    const disposer = fn()
    effects.push({ label, disposer })
    return () => {}
  },
  get: (key) => (key === 'agentPresets' ? { config: { selectedDefault: { get: () => 'standard' } } } : undefined),
  inject: (services, callback) => {
    if (Array.isArray(services) ? services.includes('settings') : services === 'settings') {
      callback({
        effect: (fn) => { effects.push({ label: 'settings', disposer: fn() }) },
        settings: {
          configure: () => () => {},
          update: async (ns, patch) => { updates.push([ns, patch]) },
        },
      })
    }
    return () => {}
  },
  agentPresets: {
    register: async (definition) => {
      registrations.push(definition)
      live.set(definition.id, definition)
      return async () => {
        disposals.push(definition.id)
        if (live.get(definition.id) === definition) live.delete(definition.id)
      }
    },
  },
}

const config = {
  orderStart: 100,
  defaultToHost: false,
  classes: { get: () => state.classes },
  host: { get: () => state.host },
  sessions: { get: () => state.sessions },
  plugins: { get: () => state.plugins },
}

/** Let the plugin's serialized reconcile queue run to completion. */
const settle = () => new Promise(resolve => setTimeout(resolve, 40))
const fire = () => listeners['loader/volatile-update']?.()
const ids = () => [...live.keys()]
const preset = id => live.get(id)
const moduleNames = id => (preset(id)?.plugins ?? []).map(row => row.name)

console.log('initial apply')
host.apply(ctx, config)
await settle()
check('host baseline preset registered', live.has('cls-host'), JSON.stringify(ids()))
check('host baseline carries the template rows',
  (preset('cls-host')?.plugins ?? []).length === host.TEMPLATES.standard.plugins.length,
  String(preset('cls-host')?.plugins.length))
check('host baseline is not a user class', state.classes.length === 0)

console.log('\nfirst class (delta on the baseline)')
state.classes = [{
  id: 'alpha',
  name: '编码',
  description: '只写代码',
  base: 'standard',
  remove: ['tool-web'],
  add: [{ id: '', name: 'dsh-whale-widget', disabled: false }],
}]
fire()
await settle()
check('single-class preset registered', live.has('cls-alpha'), JSON.stringify(ids()))
check('baseline row removed by the class', !moduleNames('cls-alpha').includes('@deepseek-ai/dsh-tool-web'))
check('plugin added by the class', moduleNames('cls-alpha').includes('dsh-whale-widget'))
check('baseline rows kept', moduleNames('cls-alpha').includes('@deepseek-ai/dsh-persona'))
check('platform gate survives composition',
  JSON.stringify(preset('cls-alpha')?.plugins ?? []).includes('__jsExpr'))

console.log('\nsecond class')
state.classes = [...state.classes, {
  id: 'beta', name: '研究', base: 'standard', remove: [], add: [{ id: '', name: 'dsh-posterflow-ai', disabled: false }],
}]
fire()
await settle()
check('both classes registered', live.has('cls-alpha') && live.has('cls-beta'), JSON.stringify(ids()))
check('second class keeps the removed row', moduleNames('cls-beta').includes('@deepseek-ai/dsh-tool-web'))
check('second class adds its own plugin', moduleNames('cls-beta').includes('dsh-posterflow-ai'))
check('roster order increments from orderStart', preset('cls-beta')?.order === 101, String(preset('cls-beta')?.order))

console.log('\ncombined session (multi-class)')
state.sessions = { 'session-1': ['beta', 'alpha'] }
fire()
await settle()
const combo = 'cls-alpha+beta'
check('combination preset registered', live.has(combo), JSON.stringify(ids()))
check('combination order is canonical (sorted ids)', host.comboPresetId(['beta', 'alpha']) === combo)
check('combination removes what either class removes', !moduleNames(combo).includes('@deepseek-ai/dsh-tool-web'))
check('combination adds both plugins',
  moduleNames(combo).includes('dsh-whale-widget') && moduleNames(combo).includes('dsh-posterflow-ai'))
check('host-only selection maps to the host preset', host.comboPresetId([]) === 'cls-host')
check('preset id round-trips to class ids',
  JSON.stringify(host.classIdsOf(combo)) === JSON.stringify(['alpha', 'beta']),
  JSON.stringify(host.classIdsOf(combo)))

console.log('\nduplicate plugin across classes is mounted once')
state.classes = state.classes.map(row => row.id === 'beta'
  ? { ...row, add: [...row.add, { id: '', name: 'dsh-whale-widget', disabled: false }] }
  : row)
fire()
await settle()
check('whale appears once in the combination',
  moduleNames(combo).filter(name => name === 'dsh-whale-widget').length === 1,
  JSON.stringify(moduleNames(combo).filter(name => name === 'dsh-whale-widget')))

console.log('\nsame signature is not re-registered')
const before = registrations.length
fire()
await settle()
check('no extra registration for an unchanged composition', registrations.length === before, String(registrations.length))

console.log('\nhost baseline edit reaches every preset')
state.host = { base: 'standard', remove: ['tool-skill'], add: [] }
fire()
await settle()
check('host preset drops the row', !moduleNames('cls-host').includes('@deepseek-ai/dsh-tool-skill'))
check('single class inherits the host edit', !moduleNames('cls-alpha').includes('@deepseek-ai/dsh-tool-skill'))
check('combination inherits the host edit', !moduleNames(combo).includes('@deepseek-ai/dsh-tool-skill'))

console.log('\ndelete a class and its combination')
state.classes = state.classes.filter(row => row.id !== 'beta')
state.sessions = { 'session-1': ['alpha'] }
fire()
await settle()
check('deleted class preset retired', !live.has('cls-beta'), JSON.stringify(ids()))
check('combination preset retired', !live.has(combo), JSON.stringify(ids()))
check('host baseline still there', live.has('cls-host'))

console.log('\nteardown effect')
for (const effect of effects) {
  if (typeof effect.disposer === 'function') await effect.disposer()
}
check('teardown disposes every registration', live.size === 0, JSON.stringify(ids()))

console.log('')
if (failures.length > 0) {
  console.error(`HOST SMOKE FAILED (${failures.length}):\n - ${failures.join('\n - ')}`)
  process.exit(1)
}
console.log('HOST SMOKE OK — host baseline, deltas, combinations and teardown all behave')
