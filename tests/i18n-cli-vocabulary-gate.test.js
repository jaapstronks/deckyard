/**
 * The i18n scripts speak one flag vocabulary, and reject anything outside it
 * (B147).
 *
 * Four scripts had grown four vocabularies. Two words meant "plan without
 * writing" (`--dry-run`, `--report`), two meant "give me JSON" (`--json`, and
 * nothing at all in `i18n-fill.js`, whose report was JSON by accident of
 * implementation), and only `i18n-sync.js` rejected an argument it did not
 * recognise. So `node scripts/i18n-audit.js --orphan` — singular, a plausible
 * typo — printed the short report and exited **0**, which reads exactly like
 * the long report being empty. A checking tool that cannot tell you it did not
 * understand you is the one failure mode that matters.
 *
 * The vocabulary: reading is the default, `--apply` writes, `--json` is machine
 * output. This gate is what stops a fifth word from appearing — every script
 * must exit non-zero on a flag it does not name.
 *
 * Run with: node --test tests/i18n-cli-vocabulary-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** Every runnable i18n script — `scripts/lib/` holds modules, not CLIs. */
const SCRIPTS = fs
  .readdirSync(path.join(REPO_ROOT, 'scripts'))
  .filter((name) => name.startsWith('i18n-') && name.endsWith('.js'))
  .sort();

/** The words a script may use. Adding one here is a deliberate decision. */
const VOCABULARY = ['--apply', '--json', '--orphans'];

/**
 * @param {string} script
 * @param {string[]} args
 * @returns {{status: number, stderr: string}}
 */
function run(script, args) {
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts', script), ...args],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return { status: result.status, stderr: result.stderr };
}

test('there is at least one i18n CLI to gate', () => {
  assert.ok(SCRIPTS.length >= 3, `found ${SCRIPTS.length} i18n scripts`);
});

for (const script of SCRIPTS) {
  test(`${script} exits non-zero on a flag it does not know`, () => {
    const { status, stderr } = run(script, ['--not-a-real-flag']);
    assert.equal(
      status,
      1,
      `scripts/${script} accepted --not-a-real-flag (exit ${status})`,
    );
    assert.match(stderr, /Unknown option/);
    assert.match(stderr, /Usage:/);
  });

  test(`${script} uses no flag outside the shared vocabulary`, () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'scripts', script),
      'utf8',
    );
    // Only the flags a script *accepts* matter, and those are the ones it lists
    // in its parseArgs spec — a `--flag` inside a usage string or a comment is
    // documentation, not a second vocabulary.
    const spec = source.slice(source.indexOf('parseArgs('));
    const listed = [...spec.matchAll(/'(--[a-z-]+)'/g)].map((m) => m[1]);
    const strangers = [...new Set(listed)].filter(
      (flag) => !VOCABULARY.includes(flag),
    );
    assert.deepEqual(
      strangers,
      [],
      `scripts/${script} accepts ${strangers.join(', ')} — either use the ` +
        'shared word or add it to VOCABULARY here with a reason',
    );
  });
}

test('no script still answers to a retired word', () => {
  // `--dry-run` and `--report` were the private spellings of "read without
  // writing". Both are the default now; an accidental re-introduction would
  // pass the gate above (a known flag) but re-split the vocabulary.
  for (const script of SCRIPTS) {
    for (const retired of ['--dry-run', '--report']) {
      const { status } = run(script, [retired]);
      assert.equal(
        status,
        1,
        `scripts/${script} answers to ${retired} again — reading is the default`,
      );
    }
  }
});
