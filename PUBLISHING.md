# Publishing dsh-plugin-classes

Everything a DeepSeek Harness plugin needs to be installable and listable is in this
repository. What is **not** done — because it needs accounts — is the three upload steps at
the end. This file is the checklist.

## 0. State of this checkout

| Item | State |
|---|---|
| `dsh.bundle.patch` + `dsh.client` (platform web) | ✅ |
| Publish manifest (`engines.dsh`, `dsh.manifestVersion`, `dsh.compatibility`, `repository`, `homepage`, `bugs`, `author`, `files`, `LICENSE`, `publishConfig`) | ✅ |
| English + Chinese README, CHANGELOG, MIT LICENSE | ✅ |
| `npm test` (host + client smoke), `npm run check` (manifest) | ✅ passing |
| `npm pack` contents (8 files, ~38 kB, no scripts/tests/screenshots) | ✅ |
| Installs from the tarball into a clean profile and composes as a third bundle layer (`dsh --dump-config`) | ✅ verified |
| Live verification on the running app (`scripts/verify-live.mjs`, 28 checks) | ✅ |
| Git repository with a first commit | ✅ local only, **no remote** |
| npm publish | ❌ needs an authenticated npm account |
| GitHub repository / `dsh-plugin` topic | ❌ needs a GitHub account |
| Market listing (dsh-plugin.org scan, awesome-dsh-plugin PR) | ❌ follows from GitHub |

## 1. The two things only you can provide

1. **Your GitHub owner** — replace the `OWNER` placeholder in exactly four places:

   ```sh
   # package.json
   repository.url   https://github.com/Uruz123321/dsh-plugin-classes.git
   homepage         https://github.com/Uruz123321/dsh-plugin-classes#readme
   bugs.url         https://github.com/Uruz123321/dsh-plugin-classes/issues
   # LICENSE copyright line, if you want a real name there
   ```

   `npm run check` prints a warning while the placeholder is still present; it does not fail.

2. **An npm account** (only needed for the npm route; the GitHub route works without it):

   ```sh
   npm login --registry=https://registry.npmjs.org
   ```

## 2. This machine needs two fixes before any publish command

Both are local configuration, not repository problems:

1. **npm cache is unwritable**: `~/.npmrc` sets `cache=D:\Program Files\nodejs\node_cache`,
   which needs administrator rights, so every command that writes a log fails with
   `Log files were not written due to an error writing to the directory`. Either fix the
   line or pass a writable cache: `--cache "E:\DeepSeek Orb\dsh-home\dsh_orb\.npm-cache"`.
2. **The default registry is a read-only mirror**: `~/.npmrc` sets
   `registry=https://registry.npmmirror.com/`. Publishing must target the real registry
   explicitly (`--registry https://registry.npmjs.org`), which `publishConfig.registry` in
   `package.json` already does for `npm publish`.

## 3. GitHub (recommended first — no registry account needed)

```powershell
cd E:\DeepSeek Orb\dsh-home\dsh_orb\plugin-classes
git remote add origin https://github.com/Uruz123321/dsh-plugin-classes.git
git push -u origin main
```

Then on the repository page: **About → Topics → add `dsh-plugin`** (hard requirement for every
market scanner), and check that the description says what the plugin does.

Installability is immediate for anyone:

```sh
dsh plugin --profile web add github:Uruz123321/dsh-plugin-classes
```

## 4. npm

```powershell
cd E:\DeepSeek Orb\dsh-home\dsh_orb\plugin-classes
npm run check                      # manifest
npm test                           # smoke suites
npm pack --dry-run                 # review the 8 files that would ship
npm publish --registry=https://registry.npmjs.org
```

`prepublishOnly` runs `npm test && npm run check`, so a broken manifest cannot be published.
The name `dsh-plugin-classes` was unclaimed on the public registry when this was prepared
(`https://registry.npmjs.org/dsh-plugin-classes` → 404); re-check before publishing.

## 5. Market listing

There is **no official DeepSeek plugin marketplace** (the harness ships plugin management, not
a store). The community catalogues are:

| Where | How it picks the plugin up |
|---|---|
| [dsh-plugin.org / DSH Plugin Hub](https://dsh-plugin.org/zh/submit) | Automated scan of public GitHub repos carrying the `dsh-plugin` topic; README must show an install command. New entries start `unconfirmed` |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) → awesome-dsh-plugin.com + `dshmarket` | Open a PR adding `data/plugins/<owner>__<repo>.yml`. Its CI requires: `dsh.bundle` declared (we have it), repository older than one day, bilingual consistency, ≤3 entries per PR |
| [dsh-market.com](https://dsh-market.com) 创意工坊 | Fed by the awesome-dsh-plugin catalogue |

Submission YAML schema differs per catalogue and changes; copy an existing entry from
`data/plugins/` in the awesome-dsh-plugin repository rather than writing one from scratch.

## 6. Versioning

- `CHANGELOG.md` follows Keep a Changelog; add an entry per release.
- Bump `version`, commit, tag `v<version>`, push tags, then publish. npm rejects a duplicate
  version, so tag before publishing only if you are sure.
- `dsh.compatibility.dshReleases` is declarative and not enforced by installers — keep it honest
  (only 0.2.0-rc.2 is verified).

## 7. Pre-publish self-check (one command each)

```powershell
npm test                 # host + client smoke
npm run check            # publish manifest, no OWNER warnings once filled
npm pack --dry-run --cache .\.npm-cache   # 8 files, no scripts/, no .shots/
```
