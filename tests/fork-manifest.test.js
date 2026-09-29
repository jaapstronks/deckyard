/**
 * `custom/fork.json` is the one place a fork says what it owns beyond
 * `custom/` and which core files it patches on purpose (B426). The doc gate
 * and `npm run fork:seams` both read it, so a manifest that half-parses would
 * silently widen what either tool ignores. Every malformed shape is refused.
 *
 * Run with: node --test tests/fork-manifest.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  isForkOwned,
  parseForkManifest,
  readForkManifest,
} from '../scripts/lib/fork-manifest.js';

test('a checkout without a manifest owns only custom/ and CLAUDE.md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-manifest-'));
  const m = readForkManifest(dir);
  assert.deepEqual(m, { owned: [], deviations: {} });
  assert.ok(isForkOwned(m, 'custom/styles/10-login.css'));
  assert.ok(isForkOwned(m, 'CLAUDE.md'));
  assert.ok(!isForkOwned(m, 'AGENTS.md'));
  assert.ok(!isForkOwned(m, 'docs/internal/FORK.md'));
});

test('owned trees and files extend the convention', () => {
  const m = parseForkManifest({
    owned: ['docs/internal/', 'tests/brand-to-theme.test.js'],
    deviations: {
      'tests/theme-seeds.test.js':
        'keeps the seed test on core seeds until upstream reads a fixture root',
    },
  });
  assert.ok(isForkOwned(m, 'docs/internal/deploy.md'));
  assert.ok(isForkOwned(m, 'tests/brand-to-theme.test.js'));
  assert.ok(!isForkOwned(m, 'tests/brand-to-theme.test.js.bak'));
  assert.ok(
    !isForkOwned(m, 'tests/theme-seeds.test.js'),
    'a deviation is core',
  );
});

test('the repo-root manifest parses (upstream ships none; a fork ships its own)', () => {
  const root = path.resolve(import.meta.dirname, '..');
  assert.doesNotThrow(() => readForkManifest(root));
});

for (const [name, raw, pattern] of [
  ['an array', [], /must be a JSON object/],
  ['an unknown field', { ownedPaths: [] }, /unknown field "ownedPaths"/],
  ['owned as a string', { owned: 'docs/internal/' }, /must be an array/],
  ['an absolute path', { owned: ['/etc/'] }, /repo-relative/],
  ['a ./ path', { owned: ['./docs/x/'] }, /repo-relative/],
  ['a .. path', { owned: ['docs/../x'] }, /repo-relative/],
  ['a path under custom/', { owned: ['custom/themes/'] }, /fork-owned already/],
  ['CLAUDE.md listed', { owned: ['CLAUDE.md'] }, /fork-owned already/],
  ['custom without its slash', { owned: ['custom'] }, /fork-owned already/],
  [
    'a path inside an owned tree',
    { owned: ['docs/x/', 'docs/x/a.md'] },
    /inside owned "docs\/x\/"/,
  ],
  ['a duplicate', { owned: ['docs/x/', 'docs/x/'] }, /twice/],
  ['deviations as an array', { deviations: [] }, /must map/],
  [
    'a deviation without a reason',
    { deviations: { 'a.js': 'x' } },
    /real reason/,
  ],
  [
    'a tree as a deviation',
    { deviations: { 'server/': 'patched server tree' } },
    /names a tree/,
  ],
  [
    'a path both owned and deviating',
    {
      owned: ['docs/x/'],
      deviations: { 'docs/x/a.md': 'a real enough reason' },
    },
    /both owned and a deviation/,
  ],
]) {
  test(`refuses ${name}`, () => {
    assert.throws(() => parseForkManifest(raw), pattern);
  });
}

test('invalid JSON is refused with the file named', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-manifest-'));
  fs.mkdirSync(path.join(dir, 'custom'));
  fs.writeFileSync(path.join(dir, 'custom/fork.json'), '{ owned: [] }');
  assert.throws(
    () => readForkManifest(dir),
    /custom\/fork\.json is not valid JSON/,
  );
});

test('an owned directory without its trailing slash is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-manifest-'));
  fs.mkdirSync(path.join(dir, 'custom'));
  fs.mkdirSync(path.join(dir, 'docs/internal'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'custom/fork.json'),
    JSON.stringify({ owned: ['docs/internal'] }),
  );
  assert.throws(
    () => readForkManifest(dir),
    /owned "docs\/internal" is a directory; write it as "docs\/internal\/"/,
  );
});
