# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-11-19

### Added

- **Classes can include other classes.** A class carries an `include: [classId]` list that
  is composed depth-first *before* its own removals and additions, so a class can stand
  for a group of plugins without re-listing them; ticking it in the composer selects the
  whole group. Composition applies each class at most once, so diamonds do not duplicate a
  plugin and cycles terminate instead of recursing. The panel gains an "includes" section
  whose candidate list already hides ids that would close a cycle, and the rail badge shows
  `⟲n` next to the existing `+n`.
- **Editable per-plugin notes.** Every plugin row in the panel (class rows, additions,
  available plugins, host-level plugins) carries a one-line note describing what the
  plugin does. Click it to edit, Enter or blur to save, Escape to discard. Notes live in
  the shared `notes` map keyed by package or row name, so the same text appears wherever
  that plugin is listed; they are informational only and never change a composition.

### Changed

- `composeRows()` now expands includes through a shared `applied` set; the previous
  per-class loop is replaced by one recursive `applyClass()` so ordering, deduplication
  and cycle handling all live in one place.

## [0.1.0] — 2026-11-07

First public release.

### Added

- **Plugin classes**: named groups of add/remove deltas over a host baseline; a session can
  select several classes at once, and each distinct composition is registered as an ordinary
  `@deepseek-ai/dsh-agent-preset` definition (`cls-host`, `cls-a`, `cls-a+b`).
- **Composer chip** next to the model selector: tick/untick a class on a not-yet-started
  session and the composition changes live; on a started session a new class opens a
  one-turn temporary session instead (DSH locks the composition after the first turn).
- **Class manager panel** in the sidebar: create, rename, hide classes; tick the plugins a
  class contains; see unassigned plugins and which sessions use a class.
- **New-plugin dialog**: after installing a plugin, choose which classes it belongs to; the
  plugin is registered into those classes and disabled at the host layer by default so only
  the chosen classes can see it.
- **Host baseline** (`cls-host`): always mounted, hidden from editing, default for new
  sessions, holding a static copy of the shipped `standard` preset (`lib/templates.json`).
- **Deletion is hiding**: hiding a class keeps its preset registered so sessions bound to it
  still open; `scripts/repair-sessions.mjs` recovers sessions damaged by older revisions.

### Publication

- `package.json`: `engines.dsh`, `dsh.manifestVersion`, `dsh.compatibility`, `repository`,
  `homepage`, `bugs`, `author`, `publishConfig`, `test`/`check` scripts, `files` whitelist.
- Added `LICENSE` (MIT), `README.md` (English), `README.zh.md`, `CHANGELOG.md`,
  `scripts/check-manifest.mjs` and a GitHub Actions check workflow.
