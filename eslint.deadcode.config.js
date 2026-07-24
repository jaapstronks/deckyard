// Advisory-only ESLint config for structural discovery: dead exports and
// import cycles. Run with `npm run lint:deadcode`. NOT part of the CI gate.
//
// Why separate and non-gating: `no-unused-modules` reports any export that is
// never statically imported. This repo loads a lot of code dynamically — route
// dispatchers, DB migrations, slide-type registries, MCP tools — so it WILL
// over-report those as "unused". The output is a triage list to hand-verify
// against the reachability method in docs/plans/briefs/dead-code-audit.md, not
// a pass/fail signal. Treat every hit as "candidate", confirm before deleting.
//
// This is the discovery tool behind the dead-exports sweep in TODO.md
// ("Nog te draaien — gerichte audits").

import base from './eslint.config.js';
import importX from 'eslint-plugin-import-x';

export default [
  ...base,

  {
    files: ['client/**/*.js', 'server/**/*.js', 'shared/**/*.js', 'scripts/**/*.js'],
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
      // Exports that nothing statically imports. Over-reports on dynamically
      // loaded modules — verify each hit by hand.
      'import-x/no-unused-modules': ['warn', { unusedExports: true }],
      // Import cycles. The storage facade has 3 deliberate cycle-breakers
      // (see dynamic-imports-simplification.md) that will show up here.
      'import-x/no-cycle': ['warn', { maxDepth: 6 }],
    },
  },
];
