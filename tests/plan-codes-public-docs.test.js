/**
 * Public prose stands on its own: no private planning code as the thing a
 * sentence leans on, and no citation of the private planning tree.
 *
 * `docs/plans/` is a symlink to a private sibling repo, absent on a fresh
 * clone. A reference doc that says "decided in `docs/plans/briefs/x.md`" or a
 * test header that leans on a bare backlog number asks an outside reader to
 * trust something they cannot open. Decision D63 settled the form: a planning code
 * may stand only as origin in parentheses behind a sentence that explains
 * itself (`…, because no shared ladder was chosen (A7.9)`).
 *
 * `tests/docs-paths-resolvable.test.js` cannot see these: it skips the
 * planning tree on purpose, since the symlink is missing in CI. So this file
 * holds three lines:
 *
 * 1. **Citations of `docs/plans/`** in public docs live only in the two files
 *    that describe the planning workspace itself, with their exact count, so
 *    an entry that stops matching fails as loudly as a new citation.
 * 2. **Planning codes outside parentheses** in public docs, and **B-numbers
 *    outside parentheses** in test headers, are a burndown: the count is
 *    exact, a new bare code fails, and a cleanup lowers the number here. A
 *    code in parentheses is the D63 form and is not counted.
 * 3. The parenthesis rule itself, on fixtures.
 *
 * The counting lives in `scripts/lib/codebase-counts.js` (`npm run -s count --
 * plan-codes`), so the planning notes and this gate read the same numbers.
 *
 * Run with: node --test tests/plan-codes-public-docs.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COUNTERS,
  bareCodes,
  outsideParens,
  publicDocs,
} from '../scripts/lib/codebase-counts.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The public docs that may name the planning tree, and how often. Each one
 * describes the workspace for upstream maintainers rather than citing a plan
 * as the ground for a claim.
 */
const PLAN_TREE_HOMES = [
  {
    file: 'docs/README.md',
    hits: 8,
    reason: 'the docs index: says what docs/plans/ is and that it is private',
  },
  {
    file: 'docs/developer/maintaining.md',
    hits: 14,
    reason:
      "upstream's maintainer workflow: where the worklist and briefs live",
  },
];

/**
 * Codes outside parentheses, as counted today. Rewriting one into a sentence
 * that stands on its own (with the code in parentheses behind it, or gone)
 * lowers the number here in the same PR.
 */
const BURNDOWN = { bareDocCodes: 130, bareTestCodes: 59 };

/** @param {string} file */
function planTreeCitations(file) {
  return (
    readFileSync(resolve(ROOT, file), 'utf8').match(/docs\/plans\//g) || []
  ).length;
}

test('only the workspace docs cite docs/plans/, each as often as listed', () => {
  const homes = new Map(PLAN_TREE_HOMES.map((h) => [h.file, h.hits]));
  const docs = publicDocs();
  assert.ok(docs.length > 50, `public docs: ${docs.length}`);
  const found = docs
    .map((file) => ({ file, hits: planTreeCitations(file) }))
    .filter(({ file, hits }) => hits > 0 || homes.has(file));
  assert.deepEqual(
    found,
    PLAN_TREE_HOMES.map(({ file, hits }) => ({ file, hits })),
    'a public doc cites the private planning tree: say the reason in the doc ' +
      'instead (a planning code in parentheses may name its origin)',
  );
});

test('bare planning codes in public prose only go down', () => {
  const { bareDocCodes, bareTestCodes } = COUNTERS['plan-codes'].count();
  assert.deepEqual(
    { bareDocCodes, bareTestCodes },
    BURNDOWN,
    'a planning code outside parentheses: write the sentence so it stands on ' +
      'its own and put the code behind it in parentheses (D63). Removed one? ' +
      'lower BURNDOWN here',
  );
});

test('a code counts only outside parentheses', () => {
  assert.equal(bareCodes('That is a known open question (TODO B143).'), 0);
  assert.equal(bareCodes('That is a known open question, see B143.'), 1);
  assert.equal(bareCodes('Moved in B90 (2026-08-18, see D11).'), 1);
  assert.equal(bareCodes('Folded (B53 sweep (a), 2026-08-17) here.'), 0);
  assert.equal(bareCodes('Settled by D51(a).'), 1);
  assert.equal(
    bareCodes('1) a list item\n\nB143 in the next paragraph.'),
    1,
    'an unclosed parenthesis ends at the paragraph',
  );
  assert.equal(outsideParens('a (b) c'), 'a  c');
});
