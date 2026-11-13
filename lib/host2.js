/**
 * Plugin classes for DeepSeek Harness — host half.
 *
 * Model
 * -----
 * - The **host class** is implicit and global: it is not an entry in `classes`,
 *   so nothing can delete it, and it is the baseline every session composes.
 *   It owns the base template (the harness's own agent rows) and may itself add
 *   or remove rows.
 * - A **user class** is a delta: rows it removes from the baseline plus plugins
 *   it adds on top.
 * - A **session** names a set of user classes (zero or more). Its composition is
 *   the host baseline with each named class's delta applied in order, so a
 *   session can combine several classes without them seeing each other.
 *
 * Every distinct composition becomes an ordinary `@deepseek-ai/dsh-agent-preset`
 * definition (`cls-host` for the bare baseline, `cls-a+b` for a combination), so
 * DSH's own scope machinery gives isolation for free: a session mounts only what
 * its composition names, and everything else is not merely hidden but unmounted.
 *
 * State lives in this plugin's own volatile config fields, which the Web client
 * edits through `settings.update`. A volatile-only change is committed into the
 * running fiber's references without a remount, so editing classes or a
 * session's class set re-registers presets live (a running session keeps the
 * composition it already mounted).
 *
 * @module dsh-plugin-classes
 */
import { readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'

/** Prefix every class preset id carries, so clients can tell classes from shipped presets. */
export const PRESET_PREFIX = 'cls-'

/** The implicit global class: baseline composition, never listed, never deleted. */
export const HOST_CLASS_ID = 'host'

/** Preset id of the bare host baseline. */
export const HOST_PRESET_ID = `${PRESET_PREFIX}${HOST_CLASS_ID}`

/** Separator between class ids inside a combination preset id. */
export const COMBO_SEPARATOR = '+'

/** Preset id for one class id. */
export function presetIdOf(classId) {
  return `${PRESET_PREFIX}${String(classId).replace(/[^A-Za-z0-9._-]/g, '-')}`
}

/**
 * Preset id of a class combination: the host baseline alone, one class, or
 * several classes joined in sorted order (so the same set always names one
 * preset, and the id is a pure function of the selection).
 * @param classIds - selected user-class ids; `host` and duplicates are ignored.
 * @returns the preset id for that composition.
 */
export function comboPresetId(classIds) {
  const ids = [...new Set((classIds ?? []).map(String))]
    .filter(id => id !== '' && id !== HOST_CLASS_ID)
    .sort()
  if (ids.length === 0) return HOST_PRESET_ID
  return PRESET_PREFIX + ids.map(id => id.replace(/[^A-Za-z0-9._-]/g, '-')).join(COMBO_SEPARATOR)
}

/** Class ids named by a combination preset id (empty for the host preset). */
export function classIdsOf(presetId) {
  const id = String(presetId ?? '')
  if (!id.startsWith(PRESET_PREFIX)) return undefined
  const rest = id.slice(PRESET_PREFIX.length)
  if (rest === HOST_CLASS_ID) return []
  if (rest === '') return undefined
  return rest.split(COMBO_SEPARATOR).filter(part => part !== '')
}

/** Single-class preset id → class id, or undefined for a combination / foreign preset. */
export function classIdOf(presetId) {
  const ids = classIdsOf(presetId)
  return ids !== undefined && ids.length === 1 ? ids[0] : undefined
}

/**
 * Row-shaped agent composition templates, generated from the shipped Web
 * bundle's own presets by `scripts/gen-templates.mjs`. `!!js` gates survive as
 * the Loader's structural `{ __jsExpr }` node, which is what makes a template a
 * faithful copy rather than a lossy one.
 */
export const TEMPLATES = JSON.parse(readFileSync(new URL('./templates.json', import.meta.url), 'utf8'))

/** One row a class adds. */
const addRow = z.object({
  /** Row id; empty means "derive one from the module name". */
  id: z.string().default(''),
  /** Module specifier of an installed plugin. */
  name: z.string(),
  /** Row-level disable, for a plugin kept in the class but switched off. */
  disabled: z.boolean().default(false),
  /** Config passed to the row, exactly as a preset row would declare it. */
  config: z.any(),
})

/** One user class. */
const classShape = z.object({
  /** Stable identity; single-class presets are `cls-<id>`. */
  id: z.string(),
  /** Display name the pickers show. */
  name: z.string(),
  /** One sentence on what the class is for. */
  description: z.string().default(''),
  /** Legacy field: the baseline now comes from the host class. */
  base: z.string().default('standard'),
  /**
   * Soft-deleted: still composed and still registered, never listed. Deleting a
   * class must not retire its preset id — a session may already be bound to it,
   * and a missing preset makes that session (and the New Session surface that
   * reuses it) fail outright.
   */
  hidden: z.boolean().default(false),
  /**
   * Other classes this class pulls in, applied in order before its own delta.
   * This is what lets a class stand for a group of plugins without re-listing
   * them: ticking `A` composes `A`'s includes, then `A`'s own removals and
   * additions. Cycles and diamonds are resolved by applying each class at most
   * once per composition (first occurrence wins).
   */
  include: z.array(z.string()).default([]),
  /** Row ids or module names this class removes from the baseline. */
  remove: z.array(z.string()).default([]),
  /** Installed plugins this class mounts on top of the baseline. */
  add: z.array(addRow).default([]),
})


/** Config the profile patch persists. */
export const Config = z.object({
  /** Roster order of the first class preset; shipped presets sit at 1..N. */
  orderStart: z.number().default(100),
  /** User classes. Volatile: edits apply without a remount. */
  classes: z.array(classShape).volatile().default([]),
  /** The implicit host baseline. Volatile, and never part of `classes`. */
  host: z.object({
    /** Template key in {@link TEMPLATES}. */
    base: z.string().default('standard'),
    /** Classes the baseline pulls in before its own delta. */
    include: z.array(z.string()).default([]),
    /** Rows the baseline leaves out. */
    remove: z.array(z.string()).default([]),
    /** Plugins every session mounts, on top of the template. */
    add: z.array(addRow).default([]),
  }).volatile().default({}),
  /** Session id -> selected user-class ids (empty/absent means the bare baseline). */
  sessions: z.dict(z.array(z.string())).volatile().default({}),
  /** Installed package name -> class ids it was filed into (empty means "not in any class"). */
  plugins: z.dict(z.array(z.string())).volatile().default({}),
  /**
   * Installed package or row name -> a short human note about what it does.
   * Written by the panel, editable at any time, and purely informational: it
   * never changes a composition, so it is volatile like the rest of the state.
   */
  notes: z.dict(z.string()).volatile().default({}),
  /** Turn the host preset into the deployment default once, for new sessions. */
  defaultToHost: z.boolean().default(true),
})

/** Required services: the preset registry owning scopes, activation and session binding. */
export const inject = ['agentPresets']

/** Loader entry name, used in diagnostics. */
export const name = 'plugin-classes'

/**
 * Recursively drop rows, keeping group structure intact.
 * @param rows - template or composed rows.
 * @param removed - row ids and module names to drop.
 * @returns the remaining rows; a group whose children all went is dropped too.
 */
function filterRows(rows, removed) {
  const kept = []
  for (const row of rows) {
    const key = row.id ?? row.name
    if (removed.has(key) || removed.has(row.name)) continue
    if (row.group === true && Array.isArray(row.config)) {
      const children = filterRows(row.config, removed)
      if (children.length === 0) continue
      kept.push({ ...row, config: children })
      continue
    }
    kept.push(structuredClone(row))
  }
  return kept
}

/** A row id derived from a module specifier: stable, readable, Loader-safe. */
function rowIdFor(moduleName) {
  const tail = String(moduleName).split('/').filter(part => part !== '' && part !== '@').pop() ?? 'plugin'
  return `add-${tail.replace(/[^A-Za-z0-9._-]/g, '-')}`
}

/**
 * Append one class's added rows, skipping module names already present (first
 * class wins, so combining classes never duplicates a plugin).
 * @param rows - the composition built so far (mutated).
 * @param additions - the class's `add` entries.
 * @param seen - module names already present (mutated).
 */
function appendAdditions(rows, additions, seen) {
  for (const addition of additions ?? []) {
    if (typeof addition?.name !== 'string' || addition.name === '' || seen.has(addition.name)) continue
    seen.add(addition.name)
    const row = {
      id: addition.id !== undefined && addition.id !== '' ? addition.id : rowIdFor(addition.name),
      name: addition.name,
    }
    if (addition.config !== undefined && addition.config !== null) row.config = structuredClone(addition.config)
    if (addition.disabled === true) row.disabled = true
    rows.push(row)
  }
}

/**
 * Compose the rows of one class set: the host baseline first, then each named
 * class's includes, removals and additions in order.
 *
 * A class may `include` other classes, so a group of plugins can be selected
 * through the class that stands for them. Includes are applied depth-first
 * before the class's own delta, exactly as if the caller had selected them
 * first, and every class is applied at most once per composition — that is what
 * makes a diamond (two classes including the same third) neither duplicate a
 * plugin nor recurse forever on a cycle.
 *
 * @param classIds - selected user-class ids.
 * @param classes - the configured user classes.
 * @param host - the configured host baseline.
 * @returns the row list handed to the preset registry.
 */
export function composeRows(classIds, classes, host) {
  const baseline = host ?? {}
  const template = TEMPLATES[baseline.base] ?? TEMPLATES.standard
  let current = filterRows(template.plugins, new Set((baseline.remove ?? []).map(String)))
  const seen = new Set(current.map(row => row.name))
  const byId = new Map((classes ?? []).map(pluginClass => [pluginClass.id, pluginClass]))
  /** Class ids already applied in this composition (cycle and diamond guard). */
  const applied = new Set()

  /** Apply one class: its includes first, then its own removals and additions. */
  const applyClass = (rawId) => {
    const classId = String(rawId ?? '')
    if (classId === '' || classId === HOST_CLASS_ID || applied.has(classId)) return
    applied.add(classId)
    const pluginClass = byId.get(classId)
    if (pluginClass === undefined) return
    for (const nested of pluginClass.include ?? []) applyClass(nested)
    current = filterRows(current, new Set((pluginClass.remove ?? []).map(String)))
    appendAdditions(current, pluginClass.add, seen)
  }

  for (const nested of baseline.include ?? []) applyClass(nested)
  appendAdditions(current, baseline.add, seen)
  for (const classId of classIds ?? []) applyClass(classId)
  return current
}

/**
 * Register every composition the config names, and keep doing so as the config
 * changes.
 * @param ctx - plugin context (carries `agentPresets`).
 * @param config - this plugin's config; every state field is a volatile reference.
 */
export function apply(ctx, config) {
  /** preset id -> the live registration this plugin owns. */
  const registered = new Map()
  let queue = Promise.resolve()

  const read = (field, fallback) => {
    const value = typeof field?.get === 'function' ? field.get() : field
    return value === undefined || value === null ? fallback : value
  }
  const classesOf = () => {
    const value = read(config.classes, [])
    return Array.isArray(value) ? value : []
  }
  const hostOf = () => {
    const value = read(config.host, {})
    return typeof value === 'object' && value !== null ? value : {}
  }
  const sessionsOf = () => {
    const value = read(config.sessions, {})
    return typeof value === 'object' && value !== null ? value : {}
  }
  const orderStart = () => (typeof config.orderStart === 'number' ? config.orderStart : 100)
  const classById = id => classesOf().find(candidate => candidate.id === id)

  /** Display name of one composition. */
  function nameOf(classIds) {
    if (classIds.length === 0) return '宿主基线'
    const names = classIds.map(id => classById(id)?.name).filter(value => typeof value === 'string' && value !== '')
    return names.length === 0 ? `组合 ${classIds.join('+')}` : names.join(' + ')
  }

  /** Every composition the current config names, keyed by preset id. */
  function wantedPresets() {
    const wanted = new Map()
    const classes = classesOf()
    const host = hostOf()

    wanted.set(HOST_PRESET_ID, {
      name: '宿主基线',
      description: '全局基线：所有会话都会挂载的组合',
      order: 0,
      plugins: composeRows([], classes, host),
    })
    classes.forEach((pluginClass, index) => {
      wanted.set(presetIdOf(pluginClass.id), {
        name: pluginClass.name?.trim() || pluginClass.id,
        description: pluginClass.description ?? '',
        order: orderStart() + index,
        plugins: composeRows([pluginClass.id], classes, host),
      })
    })
    for (const ids of Object.values(sessionsOf())) {
      if (!Array.isArray(ids) || ids.length === 0) continue
      const known = [...new Set(ids.map(String))].filter(id => id !== HOST_CLASS_ID && classById(id) !== undefined).sort()
      if (known.length === 0) continue
      const presetId = comboPresetId(known)
      if (wanted.has(presetId)) continue
      wanted.set(presetId, {
        name: nameOf(known),
        description: `组合：${known.join(' + ')}`,
        order: orderStart() + classes.length,
        plugins: composeRows(known, classes, host),
      })
    }
    return wanted
  }

  /** Drop every registration that is no longer wanted, then reconcile the rest. */
  async function reconcile() {
    const wanted = wantedPresets()

    for (const [presetId, entry] of [...registered]) {
      if (wanted.has(presetId) && entry.signature === signatureOf(wanted.get(presetId))) continue
      registered.delete(presetId)
      try {
        await entry.dispose()
      } catch (error) {
        ctx.logger?.warn?.(`plugin-classes: dropping ${presetId} failed: ${String(error)}`)
      }
    }

    for (const [presetId, definition] of wanted) {
      if (registered.has(presetId)) continue
      const signature = signatureOf(definition)
      try {
        const dispose = await ctx.agentPresets.register({
          id: presetId,
          name: definition.name,
          ...(definition.description === '' ? {} : { description: definition.description }),
          order: definition.order,
          plugins: definition.plugins,
        })
        registered.set(presetId, { dispose, signature })
      } catch (error) {
        // A duplicate or refused definition leaves the roster honest: the
        // failure is visible in `agentPresets.list()` as `broken`.
        ctx.logger?.warn?.(`plugin-classes: registering ${presetId} failed: ${String(error)}`)
        registered.set(presetId, { dispose: async () => {}, signature })
      }
    }
  }

  /** Serialize reconciliations: registration awaits activation and must not interleave. */
  function schedule() {
    queue = queue.then(reconcile, reconcile).catch(error => {
      ctx.logger?.warn?.(`plugin-classes: reconcile failed: ${String(error)}`)
    })
    return queue
  }

  /**
   * Make the host baseline the default for sessions created from now on, once:
   * a later choice made in Settings stays untouched because only an unset
   * `selectedDefault` is replaced.
   */
  function adoptDefault() {
    if (config.defaultToHost === false) return
    ctx.inject(['settings'], (child) => {
      child.effect(() => {
        const registry = ctx.get('agentPresets')
        const selected = registry?.config?.selectedDefault
        const current = typeof selected?.get === 'function' ? selected.get() : undefined
        if (current !== undefined && current !== null && current !== '') return () => {}
        void child.settings
          .update('agent-preset-registry', { selectedDefault: HOST_PRESET_ID }, undefined)
          .catch((error) => { ctx.logger?.warn?.(`plugin-classes: default preset: ${String(error)}`) })
        return () => {}
      }, 'plugin-classes: default preset')
    })
  }

  // Our own entry's volatile commit is the only edit signal the Loader gives us.
  ctx.on('loader/volatile-update', () => { void schedule() })

  ctx.effect(() => () => {
    // `allSettled` takes values, not thunks: call each disposer to actually
    // release the registration (a leaked one would make the next mount fail as
    // a duplicate preset id).
    const teardown = [...registered.values()].map(entry => entry.dispose)
    registered.clear()
    return Promise.allSettled(teardown.map(dispose => dispose()))
  }, 'plugin-classes: preset registrations')

  // Our own page edits this namespace, so the generated settings form stays out
  // of the way (the fields remain readable and writable through the Remote).
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  adoptDefault()
  void schedule()
}

/** Stable string for one definition, to decide whether a re-registration is needed. */
function signatureOf(definition) {
  return JSON.stringify([definition.name, definition.description, definition.order, definition.plugins])
}
