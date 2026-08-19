// Advisory-only ESLint config for structural discovery: import cycles. Run via
// `npm run lint:deadcode`. NOT part of the CI gate.
//
// Scope note: this config used to also carry `import-x/no-unused-modules` for
// dead-export discovery, but ESLint 10 removed the `FileEnumerator` API that
// rule needs, turning it into a silent no-op (B47). That half moved to a plain
// Node scan — `scripts/lint-dead-exports.js` — which `npm run lint:deadcode`
// runs first. `import-x/no-cycle` still works on ESLint 10 and is precise, so it
// stays here. Its output is a triage list, not a pass/fail signal.

import base from './eslint.config.js';
import importX from 'eslint-plugin-import-x';

export default [
  ...base,

  {
    files: [
      'client/**/*.js',
      'server/**/*.js',
      'shared/**/*.js',
      'scripts/**/*.js',
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
      // Import cycles. The storage facade has 3 deliberate cycle-breakers
      // (see dynamic-imports-simplification.md) that will show up here.
      'import-x/no-cycle': ['warn', { maxDepth: 6 }],
    },
  },
];
