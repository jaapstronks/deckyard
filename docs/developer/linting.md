# Linting

Deckyard uses [ESLint](https://eslint.org/) (flat config, ESLint 9+) as a
CI-gating baseline plus an advisory structural-discovery pass. There is no
bundler and no type checker, so the linter is the main automated guard against
whole classes of bugs (undefined references, unused variables, unreachable
code, duplicate keys).

## Commands

| Command                    | What it does                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run lint`             | The **gate**. Must stay green; CI runs it before the tests.                                                      |
| `npm run lint:fix`         | Auto-fix what ESLint can fix safely.                                                                             |
| `npm run lint:deadcode`    | **Advisory** dead-exports + import-cycle discovery (runs `lint:deadexports` then the cycle config). Never gates. |
| `npm run lint:deadexports` | **Advisory** unused-export discovery on its own (the Node scanner). Never gates.                                 |
| `npm run lint:deadcss`     | **Advisory** unreferenced CSS-selector discovery. Never gates.                                                   |
| `npm run format`           | Prettier, writes. Formatting is not a lint concern — see [Formatting](#formatting-prettier).                     |
| `npm run format:check`     | Prettier, checks. A **gate**; CI runs it next to `npm run lint`.                                                 |

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

### `import-x/no-unresolved` + `import-x/extensions` — the rules that are not about style

Every import must point at something that exists, and every relative import must
say so the way Node's ESM loader demands: with its extension.

This repo has no bundler, so a moved module is **not a build error**. ESM fails
at runtime, on the import that never loads — which means a behaviour-preserving
reorganisation passes `npm test` while the app no longer boots. Splitting
`client/lib/` into sub-folders did exactly that to a fork: `client/app.js` still
imported `./lib/branding.js`, the suite was green, and the breakage was found by
a hand-written scan afterwards.

They ride this gate rather than being their own test because
`eslint-plugin-import-x` was already a devDependency (the advisory pass uses
it), so the rules cost no extra CI minutes and add no new mechanism.

**Why both rules and not just `no-unresolved`.** The resolver ESLint uses is
Node's _CommonJS_ one: it tries extensions and directory `index.js` files. So
`import './foo'` (for `foo.js`) and `import './bar'` (for `bar/index.js`) both
resolve to the linter and both throw `ERR_MODULE_NOT_FOUND` in the app. That is
a green gate certifying a broken import, so `import-x/extensions` is set to
`ignorePackages`: relative specifiers must carry the extension, bare package
specifiers (`node:fs`, `es-module-lexer`) keep their normal form.

Covered trees: `client/`, `server/`, `shared/`, `scripts/`, `capture/`,
`tests/`, `test-suite/`, and the root `*.config.js` files.

`npm run lint` therefore needs a **complete install**. Bare specifiers are
checked against what is on disk in `node_modules`, so a skipped optional
dependency or a partial `npm install` turns the gate red on imports that are
perfectly correct. Run `npm ci` before believing a resolution failure.

What is _not_ covered — the honest boundaries:

- **`custom/` cannot be covered here** — it is in `ignores`, being a fork's
  gitignored drop-in tree. `tests/custom-imports-resolvable.test.js` covers it
  instead, and that is the half a fork actually needs.
- **JSDoc type imports** — `@param {import('../x.js').Thing}` is a comment to
  ESLint. `import-x` can check these (`checkTypeImports`), but only for real
  `import type` syntax, which this repo does not have. A moved module still rots
  every JSDoc reference to it silently; that was part of the #425 lesson and it
  is still open.
- **Computed dynamic imports** — `await import(someVariable)`, and the same with
  a template literal built from a name, have no static specifier to resolve.
  The slide-type registry, the route dispatcher and the migration runner all
  load this way, so the trees that most want the check get the least of it.
- **Paths inside strings** — a module path in a config value, a template, a
  `fs.readFile` argument or a doc is not an import. Docs are covered separately
  by `tests/docs-paths-resolvable.test.js`; the rest is not covered at all.

Two suppressions exist, both with their reason inline:

- **`server/utils/openai/translate.js`** — `ciiic-translation-rules` is fork-only
  and deliberately undeclared in `package.json` (see `AGENTS.md` § Optional
  dependencies), loaded through a gated `await import()` whose `catch` is the
  contract. It is the one import in the tree that is _supposed_ not to resolve
  upstream.
- **`tests/fixtures/fork-slide-types/payoff-slide.js`** — a fork fixture whose
  specifier is written for its _runtime_ home (`custom/slide-types/`, one level
  shallower than where it is tracked). The `test-fork` CI job copies it into
  place, and `tests/custom-imports-resolvable.test.js` resolves it for real
  there.

### `no-restricted-syntax` on single-argument `t()` — the i18n fallback rule

Scoped to `client/**`, this rule rejects `t('some.key')` written without its
English fallback. `t(key, fallback)` is the only accepted form.

That second argument is what Tier-2 locales degrade to when a key is missing
(`client/lib/ui-i18n.js`); without it a missing key renders the raw key string
instead of English, which is the one way the tiering safety net breaks. See
[`docs/reference/i18n-locale-tiers.md`](../reference/i18n-locale-tiers.md).

### `no-restricted-imports` on `zod` — one validation vocabulary

`zod` may be imported **only** from `server/utils/ai/schemas/`. Anywhere else
the gate fails with a message pointing at
[`server/utils/request-validators.js`](../../server/utils/request-validators.js).

The dependency earns its place parsing what a model hands back — genuinely
untyped input, genuinely worth a schema library. On _request bodies_ it would be
a second validation vocabulary next to `request-validators.js`, with
[`docs/openapi.yaml`](../openapi.yaml) as a third place the same contract is
written down. Deckyard has no build step to collect zod's real payoff (type
inference) either, so what would be left is runtime validation the twelve
existing helpers already do.

Widening the allowance is a design decision, not a lint fix: argue it in a PR
rather than adding a path to the config.

`tests/zod-scope-guard.test.js` asserts the same thing, so a plain local
`npm test` catches it without the lint pass having run — and fails the other way
too, if `server/utils/ai/schemas/` ever stops using zod and the carve-out
outlives its reason.

### `no-restricted-syntax` on control class names — one class per control

Scoped to `client/**`, this rule rejects `class: 'input'`, `'select'`,
`'form-select'`, `'input-sm'` and `'form-select-xs'` on an `h()` attrs object.
`form-input` is the canonical class for a text input, a `<select>` and a
`<textarea>`; size and role modifiers ride along next to it
(`form-input form-input-sm font-mono`).

The rejected spellings were never a competing style — they were **undefined**.
`.form-input` in [`client/styles/app/components.css`](../../client/styles/app/components.css)
is the only place a control is drawn; `.input`/`.select`/`.form-select` had no
rule anywhere except three layout-scoped ones (`flex: 1`, `width: 100%`). A view
that reached for one shipped a browser-default control — 2px inset border,
square corners, 21px tall — next to styled neighbours. That is why this is a
gate and not a style preference (A7.16 cluster 10).

It is a syntax rule rather than a greptest because the selector can bind to the
`class:` property specifically and match **whole tokens** only: `input-group`
and `select-all` are untouched, and the error lands on the construction site
instead of in a file:line list. Its honest boundary: `classList.add('select')`
and `className =` assignment are not covered — there are none in the tree, and
`.add('select')` is ambiguous with `Set#add`, so a rule there would buy false
positives and no burndown.

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

Never _add_ to the suppressions file to make a red build green — fix the code.
The file only shrinks.

## The advisory pass (`npm run lint:deadcode`)

Two halves, run back to back:

- **Dead exports** — [`scripts/lint-dead-exports.js`](../../scripts/lint-dead-exports.js),
  a plain Node scan (`npm run lint:deadexports`). It builds a static import graph
  over `git ls-files` and reports every export in `client/ server/ shared/
scripts/` that no tracked module imports.
- **Import cycles** — [`eslint.deadcode.config.js`](../../eslint.deadcode.config.js)'s
  `import-x/no-cycle`.

**Why the export half is a Node script, not an ESLint rule.** It used to be
`import-x/no-unused-modules`, but ESLint 10 removed the `FileEnumerator` API that
rule depends on, so under this repo's ESLint 10 it became a **silent no-op** —
zero unused exports reported, with only an easy-to-miss "rule disabled" notice
(B47). A gate that silently reports nothing is drift, so the mechanism moved
in-house, matching `lint:deadcss` and `audit-codebase.js`, and is now immune to
ESLint major bumps. `import-x/no-cycle` still works on ESLint 10 and is precise,
so it stayed in the ESLint config.

**This is a triage tool, not a gate.** The export scan over-reports because the
app loads a lot of code by directory scan and string-keyed registry (route
dispatchers, DB migrations, slide-type registries, MCP tools) — those exports
have no static importer but are reached at runtime. Treat every hit as a
_candidate_ and confirm it by hand against the reachability method in the
dead-code audit brief before deleting anything. The import-cycle hits, by
contrast, are precise.

The scanner is deliberately generous about what counts as _used_ (the safe
direction is "alive"): a named/default/namespace import, a re-export, and a
dynamic `import('…')` or JSDoc `{import('…')}` type ref all keep an export
alive, and importers anywhere in the tracked tree count — including tests and
`capture/`, so a test-only export is not flagged. That is why its candidate
count is a fresh baseline and not comparable to the old `no-unused-modules`
numbers.

**Hand-verification does not stop at this repo's edge.** Some exports have their
only consumer in a _sibling_ repo: `deckyard-website`'s docs generator imports
several `shared/slide-types/` modules directly, so a sweep that greps only this
repo sees a module-local const where a live contract sits. That is not
hypothetical — sweep #536 demoted `SLIDE_STRUCTURES` and the website generator
crashed on it, twice in one day (#558/#559 restored it plus
`SLIDE_RUNTIMES`/`LIVE_INTERACTIONS`).
[`tests/cross-repo-consumer-exports.test.js`](../../tests/cross-repo-consumer-exports.test.js)
pins every module that generator reads, as a deliberately hand-written statement
about that consumer; removing an entry there means coordinating with
`deckyard-website` first (a `_meta` briefing), never editing the list to make a
sweep pass. If a second external consumer ever appears, give it its own pinned
list the same way.

## The advisory pass (`npm run lint:deadcss`)

Script: [`scripts/lint-dead-css.js`](../../scripts/lint-dead-css.js). Where
`lint:deadcode` counts unused JS _exports_, this counts CSS class selectors that
no source file references — the blind spot that let `.editor-form-header-left`
survive a header-row removal (#393) unnoticed.

**Also a triage tool, not a gate — and deliberately more conservative.** Class
names here are _composed_ (`slide-bg-${id}`, `is-${state}`, `tf-align-${x}`,
`renderHtml` template builds), so a naive scanner flags every composed class as
dead and is worse than nothing. The scanner therefore errs towards **alive**: it
harvests every class-shaped token from `client/**` + `shared/**` as "used" and
treats any static chunk preceding a `${` as a live prefix. It reports a
selector only when it appears _nowhere_ — not as a literal, not as a composition
prefix. Under-reporting is the intended failure mode; over-reporting is the one
that makes the tool untrustworthy.

**Tokens are cut on any non-`[\w-]` run, not on whitespace.** The two commonest
ways a class is named here are `class="a b"` inside a larger string and
`querySelector('.a .b')`; splitting on whitespace yields `class="a` and `.a`,
neither of which is a class token, so both classes read as dead. Class
attributes are additionally harvested straight from the raw text, because the
string scanner desyncs on quote characters inside a regex literal on the same
line. Those two together account for 28 of the 164 the first cut reported.

Two properties worth knowing:

- **It measures `git ls-files`, not the working tree.** A class used only by an
  untracked scratch file still counts as dead — otherwise "green for the author"
  is not "green in CI" (the #413 lesson).
- **It stays advisory (exit 0) until the report is clean.** Today it lists ~83
  candidates; promote it to a gate only once those are triaged away. Each hit is
  a _candidate_ — verify by hand (a fully dynamic `class` built from a variable
  the scanner can't see is a false positive) before deleting.

## Formatting (Prettier)

Formatting is deliberately _not_ ESLint's job: the gate config carries no style
rules. The repo is formatted with [Prettier](https://prettier.io) on its
defaults plus `singleQuote: true` (`.prettierrc`); `.prettierignore` mirrors the
ESLint ignore list and adds the tool-written files (`CHANGELOG.md`,
`package-lock.json`, the generated baselines under `tests/fixtures/export-metrics/`)
and the gitignored planning symlink (see `CLAUDE.md`).

- `npm run format` writes, `npm run format:check` gates in CI. There are no
  editor hooks and no lint-staged: CI is the gate.
- Generators that emit committed source (`scripts/generate-slide-*.js`) pass
  their output through `scripts/lib/format-generated.js`, so their byte-for-byte
  tests and the formatter agree on one spelling.
- The one-time repo-wide reformat is a single commit listed in
  `.git-blame-ignore-revs`. Run
  `git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone so
  `git blame` looks through it (GitHub's blame view honours the file by itself).
- `// prettier-ignore` is allowed where Prettier's output genuinely hurts
  readability (a hand-aligned table of constants), always with a reason on the
  line above. Every ignore is an exception, not a second style.

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
