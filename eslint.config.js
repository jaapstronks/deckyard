// Flat ESLint config (ESLint 9+). The repo has no bundler; this is the first
// linter it has ever had. Two intents live here:
//
//   1. A GATING baseline (this file, run via `npm run lint`): high-signal rules
//      that catch real bugs — unused vars, undefined refs, duplicate keys,
//      unreachable code. Kept green so CI can block regressions.
//   2. A DISCOVERY pass for dead exports + import cycles lives in
//      `eslint.deadcode.config.js` (run via `npm run lint:deadcode`). It
//      over-reports on dynamically-loaded entry points (routes, migrations,
//      registries), so it is advisory only and never gates CI.
//
// See docs/developer/linting.md for the rationale and the triage workflow.

import js from '@eslint/js';
import globals from 'globals';
import importX from 'eslint-plugin-import-x';

export default [
  {
    // Vendored bundles, generated assets, data dirs, gitignored drop-ins, and
    // local working docs — none of it is hand-authored source we lint.
    ignores: [
      'node_modules/**',
      'server/data/**',
      'server/uploads/**',
      'client/vendor/**',
      'vendor/**',
      'assets/**',
      'themes/**',
      'custom/**',
      'docs/**',
      'skills/**',
      '.claude/**',
      'coverage/**',
      '**/*.min.js',
    ],
  },

  {
    // The codebase already carries `eslint-disable-next-line no-console` /
    // `no-bitwise` directives from before this config existed. Those rules are
    // not enabled here, so the directives are technically unused — but removing
    // them is out of scope for standing up the linter and would leave the tree
    // full of trailing-whitespace churn. Leave them dormant and forward-compatible.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },

  js.configs.recommended,

  // Browser-side source.
  {
    files: ['client/**/*.js'],
    ignores: ['client/vendor/**'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Every `t()` call must carry its English fallback: `t(key, fallback)`.
      // The fallback is what Tier-2 locales degrade to when a key is missing
      // (client/lib/ui-i18n.js) — the whole reason tiering is safe. Written as
      // `t(key)` alone, a missing key renders the raw key string instead of
      // English, which is the one way that safety net breaks. See
      // docs/reference/i18n-locale-tiers.md.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='t'][arguments.length<2]",
          message:
            't() needs an English fallback: t(key, fallback). Without it a ' +
            'missing key renders the raw key, defeating Tier-2 fallback ' +
            '(docs/reference/i18n-locale-tiers.md).',
        },
      ],
    },
  },

  // Node-side source and tooling.
  {
    files: [
      'server/**/*.js',
      'scripts/**/*.js',
      'test-suite/**/*.js',
      '*.config.js',
    ],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },

  // Docs screenshot runner: Node scripts that also carry browser-context
  // callbacks (page.evaluate / waitForFunction run inside Chromium), so both
  // global sets are legitimately in play.
  {
    files: ['capture/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // Tests run under node:test but exercise client code through jsdom, which
  // injects browser globals at runtime — so they need both global sets.
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // Shared modules run in both environments; give them both global sets so
  // no-undef does not false-positive on env-specific references.
  {
    files: ['shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  // Every relative import must resolve to a file that exists.
  //
  // There is no bundler here, so a moved module is not a build error — ESM only
  // fails at *runtime*, on the import that never loads. A behaviour-preserving
  // reorganisation therefore passes `npm test` while the app no longer boots.
  // That is not hypothetical: splitting `client/lib/` into sub-folders left a
  // fork's `client/app.js` importing `./lib/branding.js`, green suite and all,
  // and it was found by a hand-written scan after the fact (fork-upgrade
  // finding B1; the same lesson as #425 on our own side).
  //
  // It rides the existing lint gate rather than being its own test:
  // `eslint-plugin-import-x` is already a devDependency (the dead-code pass uses
  // it), so this costs no extra CI minutes and adds no new mechanism.
  //
  // `custom/` is in `ignores` above — a fork's drop-in tree, absent upstream —
  // so it cannot be covered here. `tests/custom-imports-resolvable.test.js`
  // covers it instead, and is the half a fork actually needs.
  {
    files: [
      'client/**/*.js',
      'server/**/*.js',
      'shared/**/*.js',
      'scripts/**/*.js',
      'capture/**/*.js',
      'test-suite/**/*.js',
      'tests/**/*.js',
      '*.config.js',
    ],
    plugins: {
      'import-x': importX,
    },
    settings: {
      'import-x/resolver': {
        node: {
          extensions: ['.js', '.mjs'],
        },
      },
    },
    rules: {
      // Relative imports must point at a file that exists; bare specifiers are
      // checked against what is actually installed, which is why `npm run lint`
      // needs a complete `npm ci` (a missing dependency turns the gate red).
      'import-x/no-unresolved': 'error',
      // `no-unresolved` alone is not enough, because the node resolver is more
      // forgiving than the ESM loader: it does extension and index resolution,
      // so `import './foo'` (for `foo.js`) and `import './bar'` (for
      // `bar/index.js`) both resolve here and both throw ERR_MODULE_NOT_FOUND at
      // runtime. Requiring the extension closes that gap — the resolver's
      // leniency can no longer certify an import Node will refuse. Packages keep
      // their bare, extensionless form (`node:fs`, `es-module-lexer`).
      'import-x/extensions': ['error', 'ignorePackages'],
    },
  },

  // `zod` is for LLM *output* schemas, nothing else.
  //
  // It sits in `dependencies` on the strength of a single import
  // (`server/utils/ai/schemas/`), where it parses what a model hands back —
  // genuinely untyped, genuinely worth a schema library. Reaching for it on
  // request bodies is the standing temptation, and it would make
  // `server/utils/request-validators.js` the *second* validation vocabulary
  // instead of the first, with `docs/openapi.yaml` as a third place the same
  // contract is written down. A7.19 B2 decided against that (see
  // docs/reference/versioning.md § the beta stance: one canonical form per
  // concept); this is that decision with teeth instead of a note in a brief.
  //
  // The narrow allowance below is the whole permitted surface. Widening it is a
  // design decision, not a lint fix — if a second place genuinely needs schema
  // parsing, argue that in a PR rather than adding a path here.
  {
    files: ['**/*.js'],
    ignores: ['server/utils/ai/schemas/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'zod',
              message:
                'zod is for LLM output schemas only (server/utils/ai/schemas/). ' +
                'Validate request bodies with server/utils/request-validators.js — ' +
                'a second validation vocabulary is a second place the contract drifts ' +
                '(A7.19 B2).',
            },
          ],
        },
      ],
    },
  },

  // Baseline rule tuning. Starts from eslint:recommended; the deltas below keep
  // the gate green on a large never-linted codebase without silencing real bugs.
  {
    rules: {
      'no-unused-vars': [
        'error',
        {
          // Don't flag unused function arguments. In this codebase they are
          // dominated by interface-conformance params (every storage-adapter
          // method carries `ctx` so implementations stay swappable; slide-type
          // `renderHtml(content, slide, ctx)` and route handlers share a fixed
          // shape) — structurally required, semantically unused, not dead code.
          // Deleting them breaks the contracts; `_`-prefixing 200+ sites is pure
          // churn that also splits param names across sibling implementations.
          // Unused *variables* and *imports* are still errors — that's where the
          // real dead-code signal lives (see the burndown in docs/developer/linting.md).
          args: 'none',
          varsIgnorePattern: '^_',
          // Catch-block bindings are often intentionally unused (log-and-move-on).
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      // Intentional in this codebase (dev logging, server diagnostics).
      'no-empty': ['error', { allowEmptyCatch: true }],
      // The control-char matches in this repo are deliberate \x00 sanitizers
      // (input/filename cleaning), not mistakes — the rule is pure noise here.
      'no-control-regex': 'off',
    },
  },
];
