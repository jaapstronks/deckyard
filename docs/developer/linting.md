# Linting

Deckyard uses [ESLint](https://eslint.org/) (flat config, ESLint 9+) as a
CI-gating baseline plus an advisory structural-discovery pass. There is no
bundler and no type checker, so the linter is the main automated guard against
whole classes of bugs (undefined references, unused variables, unreachable
code, duplicate keys).

## Commands

| Command | What it does |
|---|---|
| `npm run lint` | The **gate**. Must stay green; CI runs it before the tests. |
| `npm run lint:fix` | Auto-fix what ESLint can fix safely. |
| `npm run lint:deadcode` | **Advisory** dead-exports + import-cycle discovery. Never gates. |
| `npm run lint:deadcss` | **Advisory** unreferenced CSS-selector discovery. Never gates. |

## The gate (`npm run lint`)

Config: [`eslint.config.js`](../../eslint.config.js). It starts from
`eslint:recommended` and tunes a few rules so the baseline is green on a large
codebase that was never linted before. Environments are split by path:

- `client/**` → browser globals
- `server/**`, `scripts/**`, `test-suite/**` → node globals
- `tests/**` → both (they exercise client code through jsdom)
- `shared/**` → both (runs in either environment)

Vendored bundles (`client/vendor/`), generated assets, data dirs, and
gitignored drop-ins (`custom/`) are ignored.

### The suppressions baseline (burndown)

The first run surfaced **397 `no-unused-vars`** and **10 `no-useless-escape`**
pre-existing violations. Rather than fix ~400 things in the setup change (huge,
unreviewable) or downgrade the rules to warnings (no regression protection),
those existing violations are recorded in
[`eslint-suppressions.json`](../../eslint-suppressions.json).

What this buys:

- The rules stay at **`error`**, so **new** violations fail CI. Regression is
  blocked from day one.
- The existing violations are an explicit, shrinking **burndown list**. Most of
  the `no-unused-vars` entries are genuinely dead code (unused imports, dead
  locals) — exactly the backlog the "dead-exports sweep" in the planning TODO
  drives to zero.

Working the burndown:

```sh
# See what's still suppressed and where.
cat eslint-suppressions.json

# After removing dead code, prune entries that are no longer needed.
npx eslint . --prune-suppressions
```

Never *add* to the suppressions file to make a red build green — fix the code.
The file only shrinks.

## The advisory pass (`npm run lint:deadcode`)

Config: [`eslint.deadcode.config.js`](../../eslint.deadcode.config.js). It adds
two structural rules from `eslint-plugin-import-x`:

- `import-x/no-unused-modules` — exports that nothing statically imports.
- `import-x/no-cycle` — import cycles.

**This is a triage tool, not a gate.** `no-unused-modules` over-reports because
the app loads a lot of code dynamically (route dispatchers, DB migrations,
slide-type registries, MCP tools) — those exports look "unused" to a static
scan but are reached at runtime. Treat every hit as a *candidate* and confirm it
by hand against the reachability method in the dead-code audit brief before
deleting anything. The import-cycle hits, by contrast, are precise.

> The `no-unused-modules` rule has a quirk: even under flat config it needs a
> legacy `.eslintrc.json` (ignore patterns only) to know which files to skip.
> That shim is read *only* by this advisory pass — ESLint 9 uses the flat
> `eslint.config.js` by default, so `.eslintrc.json` does not affect
> `npm run lint`.

## The advisory pass (`npm run lint:deadcss`)

Script: [`scripts/lint-dead-css.js`](../../scripts/lint-dead-css.js). Where
`lint:deadcode` counts unused JS *exports*, this counts CSS class selectors that
no source file references — the blind spot that let `.editor-form-header-left`
survive a header-row removal (#393) unnoticed.

**Also a triage tool, not a gate — and deliberately more conservative.** Class
names here are *composed* (`slide-bg-${id}`, `is-${state}`, `tf-align-${x}`,
`renderHtml` template builds), so a naive scanner flags every composed class as
dead and is worse than nothing. The scanner therefore errs towards **alive**: it
harvests every string/template token from `client/**` + `shared/**` as "used"
and treats any static chunk preceding a `${` as a live prefix. It reports a
selector only when it appears *nowhere* — not as a literal, not as a composition
prefix. Under-reporting is the intended failure mode; over-reporting is the one
that makes the tool untrustworthy.

Two properties worth knowing:

- **It measures `git ls-files`, not the working tree.** A class used only by an
  untracked scratch file still counts as dead — otherwise "green for the author"
  is not "green in CI" (the #413 lesson).
- **It stays advisory (exit 0) until the report is clean.** Today it lists ~160
  candidates; promote it to a gate only once those are triaged away. Each hit is
  a *candidate* — verify by hand (a fully dynamic `class` built from a variable
  the scanner can't see is a false positive) before deleting.

## Cadence — what runs when

- **`npm run lint` (gate): every push/PR, automatically.** CI runs it before the
  tests; you don't run it by hand except to check your own change.
- **`npm run lint:deadcode` (advisory): periodically, by hand.** It can't be
  automated because it over-reports (see above), so it needs a human to run and
  triage every few weeks — and specifically at these moments:
  - when starting a cleanup/refactor session (it's the discovery tool for it),
  - after a large feature or a big deletion lands (that's when exports get
    orphaned and cycles appear),
  - as part of the periodic reorganization audit (the deep-reconcile pass).

  `npm run lint:deadcss` fits the same cadence and the same moments — run it
  alongside `lint:deadcode` when hunting orphans after a UI removal or refactor.

  Each run, also prune the burndown so it stays honest:

  ```sh
  npm run lint:deadcode          # triage the candidates + cycles
  npx eslint . --prune-suppressions   # drop suppressions that are now fixed
  ```

  The suppressions file should only ever shrink. If a run shows it could be
  pruned, prune it — a stale suppression hides real dead code behind an
  "already known" marker.

## Adding or tightening rules

- Prefer turning a rule on as `error` only if the current tree is clean or
  cheap to fix. Otherwise generate a suppressions baseline for it
  (`npx eslint . --suppress-rule <rule>`) and burn it down.
- The codebase carries dormant `eslint-disable-next-line no-console` /
  `no-bitwise` directives from before this config existed. `no-console` /
  `no-bitwise` are intentionally **not** enabled (server logging is legitimate),
  and `reportUnusedDisableDirectives` is off so those directives are left in
  place, forward-compatible if either rule is ever switched on.
