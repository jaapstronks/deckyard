/**
 * Every script in `scripts/` is reachable from somewhere (B147).
 *
 * `scripts/slide-type-i18n-dump.js` sat in the repo for months with **zero**
 * references — not in `package.json`, not in a workflow, not in the docs, not
 * in a test. Nothing ran it, so nothing noticed when the registry moved under
 * it: by the time it was found it emitted 1.855 keys B140 had deleted, and its
 * output directory (`docs/i18n/`) did not exist. A script nobody invokes does
 * not stay correct; it just stops being wrong out loud.
 *
 * The rule: a script is reachable when it is named in `package.json`, a
 * workflow, or the docs — the three places a human or CI would find it. Modules
 * under `scripts/lib/` are exempt: they are imports by construction, and
 * `tests/lint-dead-exports.test.js` is what catches an unused one.
 *
 * The one-time operational scripts are the honest exception. They are run by
 * hand once per install (or once, ever) and documenting each in `package.json`
 * would be noise, so they are listed below **with a reason**. That list is the
 * point of the exception: an entry has to be defended, and a script that
 * quietly stops being run shows up as a line nobody can justify.
 *
 * Run with: node --test tests/scripts-reachable-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * One-time operational scripts, each with why it is not wired anywhere.
 * Adding a line here is a claim that a human runs this by hand.
 */
const RUN_BY_HAND = {
  'migrate-data-to-postgres.js': 'one-time SQLite → Postgres move, per install',
  'migrate-lijstje-slide.js': 'one-time slide-type rename, exercised by tests',
  'migrate-slides.js': 'one-time slide-shape migration, per install',
  'migrate-title-bg.js': 'one-time title-background migration, per install',
  'restore-orphaned-presentations.js': 'incident recovery, run when needed',
};

/** Files whose text counts as "somebody can find this script". */
function referenceSources() {
  const files = ['package.json', 'README.md', 'AGENTS.md'];
  const walk = (dir, filter) => {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel, filter);
      else if (filter(entry.name)) files.push(rel);
    }
  };
  walk('.github/workflows', (n) => n.endsWith('.yml') || n.endsWith('.yaml'));
  walk('docs', (n) => n.endsWith('.md') || n.endsWith('.yaml'));
  return files.filter((f) => fs.existsSync(path.join(REPO_ROOT, f)));
}

test('every script is named in package.json, a workflow, or the docs', () => {
  const sources = referenceSources()
    .map((f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'))
    .join('\n');

  const unreachable = fs
    .readdirSync(path.join(REPO_ROOT, 'scripts'), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => e.name)
    .filter((name) => !(name in RUN_BY_HAND))
    .filter((name) => !sources.includes(`scripts/${name}`));

  assert.deepEqual(
    unreachable,
    [],
    'no npm script, workflow or doc names these — wire them up, delete them, ' +
      'or add them to RUN_BY_HAND with a reason',
  );
});

test('the run-by-hand list has no ghosts', () => {
  for (const [name, reason] of Object.entries(RUN_BY_HAND)) {
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, 'scripts', name)),
      `RUN_BY_HAND lists scripts/${name}, which does not exist`,
    );
    assert.ok(reason.length > 10, `scripts/${name} needs a real reason`);
  }
});
