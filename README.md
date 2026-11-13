# dsh-plugin-classes

Plugin **classes** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): split your installed plugins into mutually invisible groups, so a session mounts only the plugins it belongs to — and switch classes right next to the model selector.

Installing a plugin in DSH is global: every session sees every tool. With classes you can keep, say, a *coding* set, a *writing* set, a *research* set and a *clean* set with nothing extra, and each session loads only its own. Plugins outside the session's classes are not merely disabled: they do not exist in its tool catalog or prompt.

中文说明见 [README.zh.md](./README.zh.md)。

## How it works

No second loader. Every distinct composition is registered as an ordinary
[`@deepseek-ai/dsh-agent-preset`](https://github.com/deepseek-ai/deepseek-harness) definition, so scope isolation, session binding and restart recovery all reuse DSH's own machinery:

```
host baseline (template rows − removals + additions)
  ⊕ class A deltas  ⊕ class B deltas  →  agentPresets.register({ id: 'cls-a+b', plugins: [...] })
  →  a session bound to that composition mounts only those plugins
```

A class is stored as plain data in the plugin row's **volatile config** inside the profile's `cordis.patch.yml` (`classes`, `host`, `sessions`, `plugins`). Editing a class or toggling a class for a session retires the previous revision and registers the new one, so it applies **live** — no restart, and running sessions keep the composition they already mounted.

## Features

| Feature | Behavior |
|---|---|
| Plugin classes | Named groups with add/remove deltas over the host baseline; a session can select several at once |
| Classes include classes | A class can list other classes in `include`; they compose before its own delta, so ticking one class selects a whole group. Cycles terminate and a diamond mounts each plugin once — the panel's candidate list already hides ids that would close a cycle |
| Per-plugin notes | Every plugin row carries an editable one-line note on what the plugin does; saved in the shared `notes` map (keyed by package/row name), so the same text shows wherever that plugin appears. Informational only |
| Host baseline | Global, always included, not listed for editing; it is the default composition for new sessions (`cls-host`) and holds the base template (`standard`) |
| Composer chip | A class multi-select chip left of the model selector; toggling a class on a **not-yet-started** session swaps the preset immediately |
| Class manager panel | Sidebar entry: create / rename / hide classes, tick the plugins a class contains, see unassigned plugins and which sessions use a class |
| New-plugin dialog | After installing a plugin, a centered dialog asks which classes it belongs to; confirmed plugins are registered into those classes and disabled at the host layer so only the chosen classes can see them |
| Mid-session switch | Once a session has started DSH locks its composition; ticking a **new** class opens a one-turn temporary session (same workspace, original classes + new one) that is archived when done. Already-ticked classes cannot be unticked |
| Deletion is hiding | Hiding a class removes it from the picker but **keeps its preset registered**, so sessions (including empty ones) bound to it still open — see [Troubleshooting](#troubleshooting) |

## Install

```sh
# npm
dsh plugin --profile web add dsh-plugin-classes

# straight from GitHub (no registry)
dsh plugin --profile web add github:Uruz123321/dsh-plugin-classes

# local development checkout
dsh plugin --profile web add link:/absolute/path/to/dsh-plugin-classes
```

`dsh plugin add` also appends the package to the profile's `dsh.profile.bundles`. **A newly added bundle is only imported at startup**: restart the app (Electron desktop) or `dsh web` process after installing. Editing classes afterwards needs no restart.

Manual install (used when a profile manages its own `node_modules`, e.g. the Electron desktop app):

1. Copy the package into `<DSH_HOME>/profiles/<profile>/node_modules/dsh-plugin-classes` as a **physical copy** — a junction/symlink breaks `@deepseek-ai/*` resolution, because Node resolves the real path first.
2. Add `"dsh-plugin-classes": "link:../../path/to/it"` (or the published version) to `dependencies`, and `"dsh-plugin-classes"` to `dsh.profile.bundles`.
3. Restart.

## Compatibility

| Requirement | Value |
|---|---|
| DSH | `>=0.2.0-rc.2 <0.3.0` (verified on 0.2.0-rc.2; 0.2.1-rc.x untested) |
| Node | `>=20.18` |
| Profiles | `web`, `desktop` |
| DSH services it uses | `settings`, `agentPresets` (with `register`/`select`/`list`), `pluginManager` (`listBundles`/`setBundleEnabled`), `pluginInventory`, `session` |

It does **not** work on profiles without agent presets: the whole design is built on the preset registry. Declared in `package.json` under `engines.dsh` and `dsh.compatibility`.

## Security and trust boundary

A DSH plugin runs in-process with the host's privileges — this one is no exception, and it is deliberately honest about what that means:

- It **registers and retires agent presets** (`agentPresets.register`) — i.e. it decides which plugins mount in which session.
- It can **disable bundle rows at the host layer** (`pluginManager.setBundleEnabled`); that is how "hide this plugin from the host baseline" is implemented.
- It writes only its own row's volatile config in the profile's `cordis.patch.yml`, and reads the plugin inventory.

It makes **no network requests**, contains **no telemetry**, reads **no credentials**, and writes **no files** outside the profile config. Installing it is equivalent to granting the ability to reshape other sessions' plugin composition; treat it like any other host-code plugin (same trust as shell access).

## Known limitations

- A started session cannot change composition (DSH locks it after the first turn); ticking a new class opens a one-turn temporary session instead, and that answer is not back-filled into the original session.
- A newly added **bundle** needs a process restart; class edits do not.
- Classes only take over agent-plane plugins. Host-level plugins stay visible to every session unless the new-plugin dialog is used with "disable at the host layer".
- The host baseline starts from a static copy of the shipped `standard` preset (`lib/templates.json`). If your deployment edited `standard`, the baseline does not follow automatically — edit the `host:` field in the profile's `dsh-plugin-classes` row instead.
- All state lives in volatile config, so it travels with the profile's `cordis.patch.yml` (copy that file to migrate).

## Troubleshooting

**"New session" fails / a session won't open after deleting a class** — `agent-preset/not-found: Unknown agent preset: cls-xxx`. An empty session's header records the preset it chose; retiring that preset breaks session adoption, and "new session" reuses the same empty session, so the whole entry point breaks. The current design hides classes instead of retiring them and rebinds empty sessions before deleting. For damage already done: `node scripts/repair-sessions.mjs` temporarily recreates the missing presets, rebinds affected empty sessions to `cls-host`, then retires the temporary classes.

**`cannot get property "remote.settings" without inject`** — a client plugin must list every remote namespace it reads (`remote.settings`, `remote.agentPresets`, `remote.pluginManager`, `remote.pluginInventory`, `remote.session`); `remote` alone is only the hub, and Cordis refuses undeclared property reads.

**`/plugins/<pkg>/client.js` 404s** — normal. The bundle route carries a revision (`plugins/??<pkg>/client.js&rev=<rev>`); check the `__DSH_BOOT__` manifest in the page rather than guessing the URL.

**Edits to `lib/host*.js` don't take effect after a hot reload** — Node's ESM cache is keyed by URL, so a same-named module returns the old code. Restart the process, or rename the entry file (this repo went `host.js` → `host2.js` once for exactly that reason). The client bundle is not affected: refresh the page.

## Development

```sh
npm test          # host smoke (baselines, deltas, combinations, teardown) + client smoke (SSR of all contributions)
npm run check     # validates this package's publish manifest
npm pack --dry-run
```

Extra scripts that drive a **running** instance (they sign a browser cookie from `$DSH_HOME/.credentials.yaml` and call `/api`, read-only):

```sh
node scripts/probe.mjs agentPresets/list pluginInventory/list settings/describe
node scripts/verify-live.mjs        # host: row active, host preset is default, combinations registered
node scripts/verify-ui.mjs          # headless Chromium: chip, panel, create → untick → delete
node scripts/verify-ui2.mjs         # headless Chromium: new-plugin dialog, two classes, screenshots in .shots/
```

Screenshots of the UI live in `.shots/`.

## License

MIT — see [LICENSE](./LICENSE).
