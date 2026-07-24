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

export default [
  {
    // Vendored bundles, generated assets, data dirs, gitignored drop-ins, and
    // local working docs — none of it is hand-authored source we lint.
    ignores: [
      'node_modules/**',
      'server/data/**',
      'server/uploads/**',
      'client/vendor/**',
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
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
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
