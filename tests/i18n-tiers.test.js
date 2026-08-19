/**
 * The locale-tier definition has one source of truth — the `tier` field in
 * `client/i18n/manifest.json` — and three consumers that must agree with it:
 * the coverage gate (Tier 1 blocks), the UI picker (groups by tier), and the
 * policy doc (docs/reference/i18n-locale-tiers.md). This test pins the source so
 * a locale can't be added, or a tier changed, without the change being
 * deliberate and consistent.
 *
 * Run with: node --test tests/i18n-tiers.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCALES, TIER_1, TIER_2, tierOf } from '../scripts/i18n-tiers.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const i18nDir = path.join(repoRoot, 'client', 'i18n');

test('every shipped locale declares a tier of 1 or 2', () => {
  for (const l of LOCALES) {
    assert.ok(
      l.tier === 1 || l.tier === 2,
      `locale "${l.id}" has tier ${JSON.stringify(l.tier)} — must be 1 or 2 ` +
        `(client/i18n/manifest.json)`,
    );
  }
});

test('Tier 1 is exactly the two gated locales', () => {
  // Promoting a locale into Tier 1 is a real commitment (the coverage gate
  // starts failing on any gap). It should be a conscious edit here, not a
  // surprise — so the policy in docs/reference/i18n-locale-tiers.md is pinned.
  assert.deepEqual([...TIER_1].sort(), ['en', 'nl']);
});

test('the two tiers partition every shipped locale, no overlap', () => {
  assert.equal(TIER_1.length + TIER_2.length, LOCALES.length);
  const overlap = TIER_1.filter((id) => TIER_2.includes(id));
  assert.deepEqual(overlap, [], 'a locale cannot be in both tiers');
});

test('every shipped locale has a translation directory', () => {
  for (const l of LOCALES) {
    const dir = path.join(i18nDir, l.id);
    assert.ok(
      fs.existsSync(dir) && fs.statSync(dir).isDirectory(),
      `locale "${l.id}" is in the manifest but client/i18n/${l.id}/ is missing`,
    );
  }
});

test('tierOf resolves shipped ids and rejects unknown ones', () => {
  assert.equal(tierOf('en'), 1);
  assert.equal(tierOf('de'), 2);
  assert.equal(tierOf('xx'), null);
});
