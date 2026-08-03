/**
 * The guardrail behind `shared/slide-types/removed.js`.
 *
 * Removing a slide type used to be archaeology: the freeform removal (#377)
 * touched 25 files, and every reference past the registry entry was found by
 * hand with `grep`, not by a failing test. 18 of those 25 files mentioned the
 * type only in a comment, a doc row or a hand-written list — exactly the kind of
 * rot nothing was watching.
 *
 * This turns that sweep into a gate. It runs in both directions so the
 * allowlist stays honest: no unexpected reference survives, and no allowlist
 * entry outlives the reference it excuses.
 *
 * Run with: node --test tests/removed-slide-types.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  REMOVED_SLIDE_TYPES,
  REMOVED_SLIDE_TYPE_NAMES,
  getRemovedSlideType,
} from '../shared/slide-types/removed.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Trees a slide-type name can legitimately appear in. */
const SCAN_ROOTS = [
  'client',
  'server',
  'shared',
  'tests',
  'scripts',
  'docs/reference',
  'docs/developer',
  'docs/ops',
];

/**
 * Not scanned, and why:
 * - `node_modules`, `vendor`, `.git` — not ours.
 * - `client/i18n`, `server/i18n` — generated translation payloads; a locale
 *   file legitimately keeps a key naming a long-gone type until the orphan-key
 *   audit prunes it.
 * - `custom` — fork-local slide types, gitignored; a fork may legitimately
 *   revive a name core dropped.
 * - `docs/plans` — a gitignored symlink to the private planning repo, and the
 *   place where removals are discussed by name before they happen.
 *
 * Runtime artifacts (`server/data`, `server/logs/**`, uploads) are excluded a
 * stronger way: only git-tracked files are scanned. Stored decks legitimately
 * keep the type string of a removed type — that is the whole reason removal
 * needs a render contract — so deck JSON must never fail this test.
 */
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', 'i18n', 'custom', 'plans']);
const SCAN_EXTENSIONS = new Set(['.js', '.css', '.md', '.html', '.json', '.yaml']);

const isScannable = (rel) =>
  SCAN_EXTENSIONS.has(path.extname(rel)) &&
  SCAN_ROOTS.some((root) => rel === root || rel.startsWith(`${root}/`)) &&
  !rel.split('/').some((segment) => SKIP_DIRS.has(segment));

/**
 * Every scannable *source* file, repo-relative.
 *
 * Prefers `git ls-files`, which draws the source/artifact line exactly where
 * `.gitignore` already draws it. Falls back to a directory walk when git is
 * unavailable (a tarball deploy); the guard test below fails loudly rather than
 * letting a zero-file scan pass every assertion vacuously.
 */
function collectFiles() {
  try {
    const tracked = execFileSync('git', ['ls-files', '-z'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return tracked.split('\0').filter((rel) => rel && isScannable(rel));
  } catch {
    // No git: walk the roots directly.
  }
  const out = [];
  const walk = (relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(REPO_ROOT, relDir), { withFileTypes: true });
    } catch {
      return; // an optional tree (docs/ops on a trimmed checkout) is fine
    }
    for (const entry of entries) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(rel);
        continue;
      }
      if (isScannable(rel)) out.push(rel);
    }
  };
  for (const root of SCAN_ROOTS) walk(root);
  return out;
}

const FILES = collectFiles();

/** Repo-relative paths whose text contains `name`. */
function filesMentioning(name) {
  // Word-bounded so `agenda-timeline-slide` does not also match a longer id.
  const re = new RegExp(`(?<![a-z0-9-])${name}(?![a-z0-9-])`);
  return FILES.filter((rel) => {
    let text;
    try {
      text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    } catch {
      return false;
    }
    return re.test(text);
  });
}

test('the scan actually sees the repo', () => {
  // A silent zero-file walk would make every assertion below vacuously pass.
  assert.ok(FILES.length > 500, `expected a populated scan, got ${FILES.length} files`);
  assert.ok(REMOVED_SLIDE_TYPE_NAMES.length > 0, 'expected at least one removed type on record');
});

test('a removed type is not also registered', () => {
  for (const name of REMOVED_SLIDE_TYPE_NAMES) {
    assert.equal(
      SLIDE_TYPES[name],
      undefined,
      `${name} is on the removed list but still in the registry — one of the two is wrong`
    );
  }
});

test('a removed type names a registered successor, or none at all', () => {
  for (const name of REMOVED_SLIDE_TYPE_NAMES) {
    const { successor } = REMOVED_SLIDE_TYPES[name];
    if (successor == null) continue;
    assert.ok(
      SLIDE_TYPES[successor],
      `${name} points at successor "${successor}", which is not a registered type`
    );
  }
});

test('no file outside the allowlist still names a removed slide type', () => {
  for (const name of REMOVED_SLIDE_TYPE_NAMES) {
    const allowed = new Set(Object.keys(REMOVED_SLIDE_TYPES[name].allowedReferences));
    // The record itself must be free to name what it records.
    allowed.add('shared/slide-types/removed.js');
    allowed.add('tests/removed-slide-types.test.js');

    const leftovers = filesMentioning(name).filter((rel) => !allowed.has(rel));
    assert.deepEqual(
      leftovers,
      [],
      `"${name}" was removed but is still referenced in:\n` +
        leftovers.map((f) => `  - ${f}`).join('\n') +
        `\n\nEither drop the reference, or add it to allowedReferences in ` +
        `shared/slide-types/removed.js with a reason why it must stay.`
    );
  }
});

test('every allowlisted reference still exists (the allowlist cannot rot)', () => {
  for (const name of REMOVED_SLIDE_TYPE_NAMES) {
    const { allowedReferences } = REMOVED_SLIDE_TYPES[name];
    const mentioning = new Set(filesMentioning(name));
    for (const [rel, why] of Object.entries(allowedReferences)) {
      assert.ok(
        mentioning.has(rel),
        `${name}: allowedReferences lists "${rel}" (${why}) but that file no longer ` +
          `mentions the type. Drop the entry — a stale allowlist hides the next leftover.`
      );
    }
  }
});

test('every allowlisted reference carries a reason', () => {
  for (const name of REMOVED_SLIDE_TYPE_NAMES) {
    for (const [rel, why] of Object.entries(REMOVED_SLIDE_TYPES[name].allowedReferences)) {
      assert.ok(
        typeof why === 'string' && why.trim().length > 10,
        `${name}: allowedReferences["${rel}"] needs a real reason, not "${why}"`
      );
    }
  }
});

test('a migration is recorded whenever stored decks needed converting', () => {
  for (const name of REMOVED_SLIDE_TYPE_NAMES) {
    const { migration } = REMOVED_SLIDE_TYPES[name];
    if (migration == null) continue; // no deck used the type; nothing to convert
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, migration)),
      `${name}: recorded migration "${migration}" does not exist`
    );
  }
});

test('getRemovedSlideType tells a deliberate removal apart from an unknown name', () => {
  const removed = getRemovedSlideType('freeform-slide');
  assert.ok(removed, 'a recorded removal resolves');
  assert.equal(removed.successor, null, 'freeform had no equivalent to move to');

  const withSuccessor = getRemovedSlideType('agenda-timeline-slide');
  assert.equal(withSuccessor.successor, 'timeline-slide');

  assert.equal(getRemovedSlideType('never-existed-slide'), undefined);
  assert.equal(getRemovedSlideType('title-slide'), undefined, 'a live type is not a removal');
  assert.equal(getRemovedSlideType(''), undefined);
  assert.equal(getRemovedSlideType(null), undefined);
  // Not inherited from Object.prototype.
  assert.equal(getRemovedSlideType('constructor'), undefined);
});
