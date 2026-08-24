/**
 * Where `i18n-fill.js` files a key it has not seen before (B147).
 *
 * A key's home is `en/`: the reference locale decides both the wording and the
 * module file, and `--apply` writes a translation into the same file its
 * English source sits in (B137). For a key `en/` has never seen there has to be
 * a second answer, and that answer used to be `PREFIX_TO_FILE`, a 44-line
 * hand-kept table.
 *
 * It drifted, the way a hand-kept table does. `organization` was never added,
 * so a new `organization.*` key routed to `common.json` while `en/` files its
 * 81 existing organization keys in `settings.json` — the same misfiling B137
 * fixed for existing keys, reappearing one level up for new ones. Three rows
 * (`cookies`, `export`, `shareViewer`) named prefixes with no `en/` key at all.
 *
 * The table is gone: the fallback is derived from where `en/`'s keys under that
 * prefix already live. This pins the two properties that makes it worth having
 * — it agrees with `en/`, and it cannot fall behind it.
 *
 * Run with: node --test tests/i18n-fill-key-routing.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { enFileIndex, fileFor } from '../scripts/i18n-fill.js';

const index = await enFileIndex();

test('an existing key keeps the module en/ files it in', () => {
  for (const [key, comp] of index.byKey) {
    assert.equal(fileFor(key, index), comp);
  }
});

test('a new key lands where its prefix already lives', () => {
  // The 81-key prefix the retired table had never heard of.
  assert.equal(index.byPrefix.get('organization'), 'settings');
  assert.equal(fileFor('organization.brandNewKey', index), 'settings');

  // Prefixes the table did carry, answered identically without it.
  assert.equal(fileFor('login.brandNewKey', index), 'auth');
  assert.equal(fileFor('slideType.brandNewKey', index), 'slide-types');
  assert.equal(fileFor('presenter.brandNewKey', index), 'presenter');
});

test('a prefix split across modules resolves to the majority', () => {
  // `analytics` is 75 keys in common.json against 6 in editor.json. The
  // majority is the answer, and it is stable: ties break on module name.
  const counts = new Map();
  for (const [key, comp] of index.byKey) {
    const prefix = key.split('.')[0];
    if (prefix !== 'analytics') continue;
    counts.set(comp, (counts.get(comp) || 0) + 1);
  }
  assert.ok(
    counts.size > 1,
    'analytics is no longer split — pick another case',
  );
  const [majority] = [...counts].sort((a, b) => b[1] - a[1])[0];
  assert.equal(fileFor('analytics.brandNewKey', index), majority);
});

test('an unheard-of prefix falls back to common', () => {
  assert.equal(index.byPrefix.get('quuxSurface'), undefined);
  assert.equal(fileFor('quuxSurface.newKey', index), 'common');
});
