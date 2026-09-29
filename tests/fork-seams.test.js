/**
 * `npm run fork:seams` replaces the shell recipe both forks kept in their own
 * FORK.md (B426): the files upstream touched in a merge round, intersected with
 * the files the fork diverges on outside what it owns, each classified against
 * `custom/fork.json`. Exercised end to end on a throwaway git repo shaped like
 * a fork: an upstream line with two tags, a fork line that merges the first,
 * patches core and owns some files, then merges the second.
 *
 * Run with: node --test tests/fork-seams.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { classifySeams, forkSeams } from '../scripts/fork-seams.js';

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/fork-seams.js');

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-seams-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.test',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.test',
      },
    });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const commit = (msg) => {
    git('add', '-A');
    git('commit', '-q', '--no-gpg-sign', '-m', msg);
  };

  git('init', '-q', '-b', 'upstream');
  for (const f of [
    'server/a.js',
    'server/b.js',
    'tests/seeds.test.js',
    '.gitignore',
    'CLAUDE.md',
    'untouched.js',
  ])
    write(f, `${f} v1\n`);
  commit('upstream v1');
  git('tag', 'v1');

  git('switch', '-q', '-c', 'main');
  write('CLAUDE.md', 'fork agent entry\n');
  write('.gitignore', 'fork gitignore\n');
  write('server/a.js', 'server/a.js v1 + fork patch\n');
  write('tests/seeds.test.js', 'tests/seeds.test.js v1 + fork patch\n');
  write('untouched.js', 'untouched.js + quiet fork patch\n');
  write('docs/internal/FORK.md', 'fork doc\n');
  write(
    'custom/fork.json',
    JSON.stringify({
      owned: ['docs/internal/'],
      deviations: {
        'tests/seeds.test.js': 'keeps the seed test on core seeds only',
      },
    }),
  );
  commit('fork work');

  git('switch', '-q', 'upstream');
  for (const f of [
    'server/a.js',
    'server/b.js',
    'tests/seeds.test.js',
    '.gitignore',
    'CLAUDE.md',
  ])
    write(f, `${f} v2\n`);
  write(
    'docs/internal/FORK.md',
    'upstream never ships this, but prove owned wins\n',
  );
  commit('upstream v2');
  git('tag', 'v2');
  git('switch', '-q', 'main');
  return { dir, git, write, commit };
}

test('classifies an intersection against the manifest', () => {
  const hits = classifySeams(
    [
      '.gitignore',
      'server/a.js',
      'custom/x.js',
      'CLAUDE.md',
      'tests/s.js',
      'only-up.js',
    ],
    [
      '.gitignore',
      'server/a.js',
      'custom/x.js',
      'CLAUDE.md',
      'tests/s.js',
      'only-fork.js',
    ],
    { owned: [], deviations: { 'tests/s.js': 'a declared reason here' } },
  );
  assert.deepEqual(
    hits.map((h) => [h.file, h.kind]),
    [
      ['.gitignore', 'documented'],
      ['server/a.js', 'undeclared'],
      ['tests/s.js', 'deviation'],
    ],
  );
});

test('before the merge: the round runs from the last sync to the new tag', () => {
  const { dir } = makeRepo();
  const r = forkSeams(dir, 'v2');
  assert.deepEqual(
    r.hits.map((h) => [h.file, h.kind]),
    [
      ['.gitignore', 'documented'],
      ['server/a.js', 'undeclared'],
      ['tests/seeds.test.js', 'deviation'],
    ],
  );
  assert.ok(r.undeclared.includes('untouched.js'), 'quiet drift is listed');
});

test('after the merge: the same crossing, found by stepping back along the fork line', () => {
  const { dir, git } = makeRepo();
  // Resolve like a fork would: keep the fork side of every conflict.
  try {
    git('merge', '-q', '--no-gpg-sign', '-m', 'merge v2', 'v2');
  } catch {
    git('checkout', '--ours', '--', '.');
    git('add', '-A');
    git('commit', '-q', '--no-gpg-sign', '-m', 'merge v2');
  }
  const r = forkSeams(dir, 'v2');
  assert.deepEqual(
    r.hits.map((h) => h.file),
    ['.gitignore', 'server/a.js', 'tests/seeds.test.js'],
  );
});

test('an upstream checkout is refused, not measured as a one-commit round', () => {
  const { dir, git } = makeRepo();
  git('switch', '-q', 'upstream');
  assert.throws(() => forkSeams(dir, 'v2'), /this checkout is upstream/);
  assert.doesNotThrow(() => forkSeams(dir, 'v2', { from: 'v1' }));
});

test('the CLI exits 1 on an undeclared hit and 0 once it is declared', () => {
  const { dir, write, commit } = makeRepo();
  const run = () => {
    try {
      execFileSync('node', [SCRIPT, 'v2'], { cwd: dir, encoding: 'utf8' });
      return 0;
    } catch (err) {
      assert.match(err.stdout, /server\/a\.js {2}\(UNDECLARED/);
      assert.doesNotMatch(err.stdout, /server\/b\.js/, 'upstream-only change');
      return err.status;
    }
  };
  assert.equal(run(), 1);
  write(
    'custom/fork.json',
    JSON.stringify({
      owned: ['docs/internal/'],
      deviations: {
        'tests/seeds.test.js': 'keeps the seed test on core seeds only',
        'server/a.js': 'fork patch, briefed upstream as a seam',
      },
    }),
  );
  commit('declare');
  assert.equal(run(), 0);
});

test('the CLI refuses a missing ref', () => {
  assert.throws(
    () => execFileSync('node', [SCRIPT], { encoding: 'utf8', stdio: 'pipe' }),
    (err) => err.status === 1 && /Usage: npm run fork:seams/.test(err.stderr),
  );
});
