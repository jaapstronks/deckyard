/**
 * Counts the planning notes kept quoting, derived from the source every time.
 *
 * The private worklist used to carry numbers like "22 capture recipes" and "31
 * box-sizing declarations" as prose. Every one of them drifted between two
 * audits, while every number that a test carried stayed right. So a count that a plan wants to cite lives here, as a
 * derivation, and the plan cites the command instead of the number:
 *
 *   node scripts/count-codebase.js [name…] [--json]
 *
 * Each counter reads tracked files only (`git ls-files`, the line
 * tests/helpers/slide-type-name-branching.js draws), so an untracked scratch
 * file never moves a number. Adding a counter = one entry in COUNTERS; the
 * guard in tests/codebase-counts.test.js checks that each one sees something.
 *
 * @module scripts/lib/codebase-counts
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Tracked files matching a pathspec, relative to the repo root.
 * @param {...string} pathspecs
 * @returns {string[]}
 */
function tracked(...pathspecs) {
  return execFileSync('git', ['ls-files', '--', ...pathspecs], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

/** @param {string} file */
function read(file) {
  return readFileSync(resolve(ROOT, file), 'utf8');
}

/**
 * The docs an outside reader gets: everything under `docs/` except the private
 * planning tree (a symlink to a sibling repo, absent on a fresh clone), plus
 * the two root entry points. `CHANGELOG.md` is generated from PR titles and
 * `CLAUDE.md` is agent instructions; neither is prose someone navigates.
 * @returns {string[]}
 */
export function publicDocs() {
  return [
    ...tracked('docs/*.md').filter((f) => !f.startsWith('docs/plans/')),
    ...tracked('README.md', 'AGENTS.md'),
  ];
}

/**
 * A planning code: `A7.1`, `A7.R`, `A2`, `B79`, `D34`, `T9`, `C8`. The same
 * alphabet the plan-code brief measured with.
 */
export const PLAN_CODE = /\b(?:A\d+(?:\.(?:\d+|R))?|[BDT]\d{1,4}|C\d{1,2})\b/;

/** A backlog number, the code tests cite in their header. */
const B_CODE = /\bB\d{1,4}\b/;

/**
 * The header of a test file: the leading JSDoc block, or the leading run of
 * `//` lines when there is none.
 * @param {string} src
 * @returns {string}
 */
export function testHeader(src) {
  const body = src.replace(/^#!.*\n/, '').trimStart();
  if (body.startsWith('/*')) {
    const end = body.indexOf('*/');
    return end === -1 ? body : body.slice(0, end + 2);
  }
  const lines = [];
  for (const line of body.split('\n')) {
    if (!line.startsWith('//')) break;
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * @typedef {object} Counter
 * @property {string} describe  what is counted, in one line
 * @property {() => Record<string, number>} count  named values; the first is
 *   the headline
 */

/** @type {Record<string, Counter>} */
export const COUNTERS = {
  'capture-recipes': {
    describe: 'recipe modules under capture/recipes/ (helpers start with _)',
    count: () => ({
      recipes: tracked('capture/recipes/*.js').filter(
        (f) => !/\/(_[^/]*|index)\.js$/.test(f),
      ).length,
    }),
  },

  'plan-codes': {
    describe:
      'public docs carrying a planning code; test files citing a B-number; ' +
      'links from public docs into docs/plans/',
    count: () => {
      const docs = publicDocs();
      const tests = tracked('tests/*.test.js');
      const headers = tests.map((f) => testHeader(read(f)));
      return {
        docs: docs.filter((f) => PLAN_CODE.test(read(f))).length,
        publicDocs: docs.length,
        testHeaders: headers.filter((h) => B_CODE.test(h)).length,
        testFilesAnywhere: tests.filter((f) => B_CODE.test(read(f))).length,
        testFiles: tests.length,
        planLinks: docs.reduce(
          (n, f) => n + (read(f).match(/docs\/plans\//g) || []).length,
          0,
        ),
      };
    },
  },

  'box-sizing': {
    describe: '`box-sizing` declarations in client/styles/',
    count: () => {
      const values = { 'border-box': 0, 'content-box': 0 };
      let files = 0;
      for (const f of tracked('client/styles/*.css')) {
        const found = read(f).match(/box-sizing\s*:\s*[\w-]+/g) || [];
        if (found.length) files++;
        for (const decl of found) {
          const value = decl.split(':')[1].trim();
          values[value] = (values[value] || 0) + 1;
        }
      }
      const declarations = Object.values(values).reduce((a, b) => a + b, 0);
      return { declarations, files, ...values };
    },
  },
};
