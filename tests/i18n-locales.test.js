/**
 * `client/i18n/manifest.json` is the one source of truth for the i18n tree:
 * which locales ship, which tier each sits in, which locale is the reference,
 * and which module files make up a locale directory. Before B132 the tooling
 * carried four hand-kept spellings of parts of that — two in `i18n-sync.js`,
 * one in `i18n-validate.js`, a fourth (module list) split across both — and
 * they had drifted. This test pins the manifest against every consumer that
 * still has to agree with it: the coverage gate, the sync/validate scope, the
 * runtime dictionary loader, the files actually on disk, and the policy doc.
 *
 * Run with: node --test tests/i18n-locales.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FILL_LOCALES,
  LOCALES,
  LOCALE_IDS,
  MODULES,
  MODULE_DEFS,
  REFERENCE_LOCALE,
  TIER_1,
  TIER_2,
  UI_MODULES,
  tierOf,
} from '../scripts/i18n-locales.js';
import { I18N_COMPONENTS } from '../client/lib/ui-i18n.js';

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

test('the reference locale is shipped, and is Tier 1', () => {
  assert.ok(
    LOCALE_IDS.includes(REFERENCE_LOCALE),
    `"reference": "${REFERENCE_LOCALE}" is not one of the shipped locales`,
  );
  // The reference is where every t() fallback and every fill originates. A
  // Tier-2 reference would mean the source text itself is best-effort.
  assert.equal(tierOf(REFERENCE_LOCALE), 1);
});

test('the fill set is every locale except the reference', () => {
  // Deliberately total: there is no per-locale opt-out, because the 8-of-12
  // list this replaced was drift, not policy — it/pl/fi are hand-translated
  // like the rest and were in fact the most complete Tier-2 locales. A future
  // exclusion needs a manifest field with a stated reason, not a script list.
  assert.deepEqual(
    [...FILL_LOCALES].sort(),
    LOCALE_IDS.filter((id) => id !== REFERENCE_LOCALE).sort(),
  );
  assert.ok(!FILL_LOCALES.includes(REFERENCE_LOCALE));
});

test('every module declares a known loader, and the ui set is the rest', () => {
  for (const m of MODULE_DEFS) {
    assert.ok(
      m.loader === 'ui' || m.loader === 'deck',
      `module "${m.id}" has loader ${JSON.stringify(m.loader)}`,
    );
  }
  assert.deepEqual(
    [...UI_MODULES].sort(),
    MODULE_DEFS.filter((m) => m.loader === 'ui')
      .map((m) => m.id)
      .sort(),
  );
  // The one deck-loader module today. Adding a second is fine; adding one by
  // accident (a `ui` module that no loader actually fetches) is not.
  assert.deepEqual(
    MODULE_DEFS.filter((m) => m.loader === 'deck').map((m) => m.id),
    ['follow'],
  );
});

test('the ui modules are exactly what ui-i18n.js loads', () => {
  // client/lib/ui-i18n.js keeps I18N_COMPONENTS as a literal on purpose (a
  // failed manifest fetch must not take the dictionary down with the picker),
  // so the two are pinned against each other here instead.
  assert.deepEqual([...UI_MODULES].sort(), [...I18N_COMPONENTS].sort());
});

test('the deck-loader module is not in the global dictionary', () => {
  const deckModules = MODULE_DEFS.filter((m) => m.loader === 'deck').map(
    (m) => m.id,
  );
  for (const id of deckModules) {
    assert.ok(
      !I18N_COMPONENTS.includes(id),
      `"${id}" is a deck-loader module but ui-i18n.js merges it into the ` +
        `global dictionary — pick one loader`,
    );
  }
});

test('every locale directory holds exactly the manifest modules', () => {
  const expected = [...MODULES].map((m) => `${m}.json`).sort();
  for (const locale of LOCALE_IDS) {
    const actual = fs
      .readdirSync(path.join(i18nDir, locale))
      .filter((f) => f.endsWith('.json'))
      .sort();
    assert.deepEqual(
      actual,
      expected,
      `client/i18n/${locale}/ does not match the manifest's module list`,
    );
  }
});

test('no stray top-level file survives in client/i18n/', () => {
  // shared.json was a generated tooling artifact nothing at runtime read; its
  // only effect was to excuse keys from i18n-validate's missing-key report
  // (B132 measured that at exactly zero keys) and it is gone. A new loose file
  // here is either a stale artifact or a list that belongs in the manifest.
  const loose = fs
    .readdirSync(i18nDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
  assert.deepEqual(loose, ['manifest.json']);
});

test('every locale file lists its keys in sorted order', () => {
  // `i18n-fill.js` and `i18n-sync.js` both write sorted, so an unsorted file
  // gets reordered wholesale the first time a tool touches it and the real
  // change disappears into a few hundred lines of churn. en/ and nl/ are the
  // hand-edited pair, so they are the two that drifted; the machine-written
  // locales were already sorted.
  const offenders = [];
  for (const locale of LOCALE_IDS) {
    for (const moduleName of MODULES) {
      const file = path.join(i18nDir, locale, `${moduleName}.json`);
      if (!fs.existsSync(file)) continue;
      const keys = Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')));
      const sorted = [...keys].sort();
      if (keys.join('\n') !== sorted.join('\n'))
        offenders.push(`client/i18n/${locale}/${moduleName}.json`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} locale file(s) are not key-sorted:\n${offenders.join('\n')}`,
  );
});
