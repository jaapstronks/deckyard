#!/usr/bin/env node
// Print the codebase counts that planning notes cite, derived from the source.
//
//   node scripts/count-codebase.js                 all counters
//   node scripts/count-codebase.js box-sizing      one (or several) by name
//   node scripts/count-codebase.js --json          machine output
//
// A plan cites this command instead of copying the number into prose: a copied
// number is wrong by the next audit. The counters live in
// scripts/lib/codebase-counts.js.

import { COUNTERS } from './lib/codebase-counts.js';
import { parseArgs } from './lib/cli-args.js';

const names = Object.keys(COUNTERS);
const { flags, positional } = parseArgs(process.argv.slice(2), {
  usage: `node scripts/count-codebase.js [${names.join('|')}]… [--json]`,
  flags: ['--json'],
  maxPositional: names.length,
});

const unknown = positional.filter((n) => !COUNTERS[n]);
if (unknown.length) {
  console.error(`Unknown counter: ${unknown.join(', ')}`);
  console.error(`Known: ${names.join(', ')}`);
  process.exit(1);
}

const selected = positional.length ? positional : names;
const result = Object.fromEntries(
  selected.map((n) => [n, COUNTERS[n].count()]),
);

if (flags.has('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const [name, values] of Object.entries(result)) {
    const parts = Object.entries(values).map(([k, v]) => `${k} ${v}`);
    console.log(`${name}: ${parts.join(', ')}`);
    console.log(`  (${COUNTERS[name].describe})`);
  }
}
