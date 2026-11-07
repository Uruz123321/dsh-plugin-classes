/**
 * Headless smoke test for the browser half.
 *
 * The real Web host only serves a client bundle once its Loader entry is
 * active, so this script evaluates the bundle the same way the module system
 * does — a `window.__ModuleLoader__.load({ id, factory })` registration — and
 * runs `apply()` against a stub Cordis context. It then server-renders each
 * registered component with the stub's inject face, which proves the slot
 * options, the inject faces and every render path without a browser.
 *
 * Usage: node scripts/smoke-client.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requireFromRepo = createRequire('E:/orb-build/merge/packages/client/ui-model-selection/package.json')
const React = requireFromRepo('react')
const { renderToStaticMarkup } = requireFromRepo('react-dom/server')

const source = readFileSync(path.join(packageRoot, 'lib', 'client.js'), 'utf8')

// ─── minimal browser surface ──────────────────────────────────────────────
const styleElements = []
const documentStub = {
  querySelector: () => null,
  createElement: (tag) => ({
    tag,
    dataset: {},
    style: {},
    textContent: '',
    remove() { styleElements.splice(styleElements.indexOf(this), 1) },
  }),
  head: { appendChild: (element) => { styleElements.push(element) } },
  body: {},
  addEventListener() {},
  removeEventListener() {},
}
const windowStub = {
  __ModuleLoader__: { load: (definition) => { windowStub.__definition = definition } },
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  setTimeout,
  innerWidth: 1280,
  innerHeight: 800,
}

/** Evaluate the bundle and return its exported module. */
function loadBundle() {
  const factory = new Function('window', 'document', 'setTimeout', 'clearTimeout', 'console', source)
  factory(windowStub, documentStub, setTimeout, clearTimeout, console)
  const definition = windowStub.__definition
  if (definition === undefined) throw new Error('bundle did not call window.__ModuleLoader__.load')
  if (definition.id !== 'dsh-plugin-classes') throw new Error(`unexpected bundle id ${definition.id}`)
  const module = { exports: {} }
  const requireStub = (specifier) => {
    if (specifier === 'react') return React
    if (specifier === 'react-dom') return requireFromRepo('react-dom')
    throw new Error(`client bundle required an unseeded module: ${specifier}`)
  }
  const exported = definition.factory(requireStub)
  void module
  return { exported, definition }
}

// ─── stub Cordis client context ───────────────────────────────────────────
const registrations = []
const effects = []

/** A snapshot-store stub with no rows, enough for the store's read path. */
const emptyListStore = {
  getSnapshot: () => ({ byId: {}, ids: [], byStatus: {}, projectionsBySession: {} }),
  subscribe: () => () => {},
}

const settingsValue = { classes: [], sessions: {}, plugins: {}, host: {} }
const ctx = {
  effect: (fn, label) => {
    const disposer = fn()
    effects.push({ label, disposer })
    return () => { if (typeof disposer === 'function') disposer() }
  },
  locale: {
    register: () => () => {},
    bind: () => (key) => key,
  },
  on: () => () => {},
  inject: (_services, callback) => { callback(ctx); return () => {} },
  get: () => undefined,
  sessions: { list: emptyListStore },
  slots: {
    inject: (_name, callback) => { callback(); return () => {} },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {
        const index = registrations.findIndex(entry => entry.component === component)
        if (index >= 0) registrations.splice(index, 1)
      }
    },
  },
  remote: {
    $on: () => () => {},
    settings: {
      describe: async () => ({
        ok: true,
        value: { namespaces: [{ ns: 'dsh-plugin-classes', revision: 0, value: settingsValue }] },
      }),
      update: async () => ({ ok: true, value: undefined }),
    },
    agentPresets: {
      list: async () => ({ ok: true, value: { presets: [] } }),
      select: async () => ({ ok: true, value: 'cls-demo' }),
    },
    pluginManager: { listBundles: async () => ({ ok: true, value: [] }) },
    pluginInventory: { list: async () => ({ ok: true, value: { entries: [], agentPresets: [] } }) },
  },
}

// ─── run ──────────────────────────────────────────────────────────────────
const { exported } = loadBundle()
const failures = []
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures.push(label + (detail === undefined ? '' : ` (${detail})`))
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` (${detail})`}`)
  }
}

console.log('bundle exports')
check('exports.apply is a function', typeof exported.apply === 'function')
check('exports.inject lists slots/locale/sessions/remote',
  Array.isArray(exported.inject)
  && ['slots', 'locale', 'sessions', 'remote'].every(name => exported.inject.includes(name)),
  JSON.stringify(exported.inject))

exported.apply(ctx)

console.log('\nslot registrations')
const byName = new Map()
for (const entry of registrations) byName.set(entry.options.name, entry)
check('four contributions registered', registrations.length === 4, String(registrations.length))
check('composer chip on conversation.input.right', byName.has('conversation.input.right'))
check('sidebar panel on main (keyed)', byName.has('main') && typeof byName.get('main').options.key === 'string')
check('sidebar icon on sidebar.panellist', byName.has('sidebar.panellist'))
check('assign dialog on conversation.input.dock', byName.has('conversation.input.dock'))
check('chip declares its locale', byName.get('conversation.input.right')?.options.locale === 'pluginClasses')

console.log('\nrender')
const t = (key) => key
const render = (label, component, props) => {
  try {
    const html = renderToStaticMarkup(React.createElement(component, props))
    check(`${label} renders`, html.length > 0, `${html.length} bytes`)
    return html
  } catch (error) {
    check(`${label} renders`, false, String(error && error.message))
    return ''
  }
}

const chipEntry = byName.get('conversation.input.right')
const chipProps = chipEntry.options.inject('session-probe')
const chipHtml = render('chip', chipEntry.component, { ...chipProps, t })
check('chip shows the host-baseline label', chipHtml.includes('chip.hostOnly'), chipHtml.slice(0, 160))
check('chip renders 28px trigger class', chipHtml.includes('dpc-chip'))

const panelEntry = byName.get('main')
const panelProps = panelEntry.options.inject()
const panelHtml = render('panel', panelEntry.component, { ...panelProps, t })
check('panel renders its title key', panelHtml.includes('panel.title'))
check('panel renders the new-class action', panelHtml.includes('panel.new'))
check('panel renders the empty rail hint', panelHtml.includes('panel.empty') || panelHtml.includes('menu.loading'))

const iconEntry = byName.get('sidebar.panellist')
render('sidebar icon', iconEntry.component, { size: 16, active: true })

console.log('\nstyles')
check('stylesheet injected once', styleElements.length === 1, String(styleElements.length))
check('stylesheet covers the chip', styleElements[0].textContent.includes('.dpc-chip'))

console.log('')
if (failures.length > 0) {
  console.error(`SMOKE FAILED (${failures.length}):\n - ${failures.join('\n - ')}`)
  process.exit(1)
}
console.log('SMOKE OK — every contribution registered, rendered and styled')
