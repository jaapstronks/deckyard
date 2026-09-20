/**
 * `SUPPORTED_LOCALES` says what the files in `server/i18n/locales/` say (B379).
 *
 * The list used to be hand-maintained in two places — `server/i18n/index.js`
 * and `shared/constants/email-templates.js` — and both named nine languages
 * while the directory held `en.json` and `nl.json`. Seven "supported" locales
 * therefore resolved every key to its English fallback, and the admin panel
 * offered seven template tabs whose defaults could not differ from English.
 *
 * The list is now derived from the directory, so these tests pin the half a
 * derivation cannot pin by itself: that a locale on the list actually carries
 * strings, and that nothing re-declares the list beside it.
 *
 * Run with: node --test tests/i18n-supported-locales.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SUPPORTED_LOCALES, normalizeLocale, t } from '../server/i18n/index.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES_DIR = join(REPO_ROOT, 'server', 'i18n', 'locales');

/** The locale files on disk, by their bare code. */
function localeFiles() {
  return readdirSync(LOCALES_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
}

/** The parsed dictionary for one locale. */
function dictionary(locale) {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8'));
}

test('every locale file is supported, and every supported locale has a file', () => {
  assert.deepEqual(
    [...SUPPORTED_LOCALES].sort(),
    localeFiles().sort(),
    'the declared list and the directory have drifted apart',
  );
});

test('English leads the list, so the admin panel opens on the default', () => {
  assert.equal(SUPPORTED_LOCALES[0], 'en');
});

test('a supported locale carries the whole English key set', () => {
  const english = Object.keys(dictionary('en')).sort();
  assert.ok(
    english.length > 0,
    'en.json is the key authority and is not empty',
  );

  for (const locale of SUPPORTED_LOCALES) {
    if (locale === 'en') continue;
    const keys = Object.keys(dictionary(locale)).sort();
    const missing = english.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !english.includes(k));
    assert.deepEqual(
      missing,
      [],
      `${locale}.json is missing keys that en.json has — "supported" promises strings`,
    );
    assert.deepEqual(
      extra,
      [],
      `${locale}.json has keys en.json does not — en.json is the key authority`,
    );
  }
});

test('a locale without a file is not supported and reads as English', () => {
  // The seven that used to be on the list. Each must now normalize away
  // rather than resolve to a dictionary that does not exist.
  for (const absent of ['de', 'fr', 'es', 'pt', 'da', 'sv', 'no']) {
    if (localeFiles().includes(absent)) continue;
    assert.equal(
      normalizeLocale(absent),
      null,
      `${absent} has no translation file and must not count as supported`,
    );
    assert.equal(
      t('email.passwordReset.subject', 'FALLBACK', null, absent),
      t('email.passwordReset.subject', 'FALLBACK', null, 'en'),
      `${absent} must read as English, not as a key name`,
    );
  }
});

test('a regional tag narrows to its base locale', () => {
  assert.equal(normalizeLocale('en-GB'), 'en');
  assert.equal(normalizeLocale('nl-BE'), 'nl');
  assert.equal(normalizeLocale('NL'), 'nl');
  assert.equal(normalizeLocale(''), null);
  assert.equal(normalizeLocale(null), null);
});

test('no second declaration of the list lives beside the derived one', async () => {
  const shared = await import('../shared/constants/email-templates.js');
  assert.equal(
    shared.SUPPORTED_LOCALES,
    undefined,
    'the browser-side constants must not re-declare a list they cannot verify',
  );

  const storage = await import('../server/storage/email-templates.js');
  assert.equal(
    storage.SUPPORTED_LOCALES,
    SUPPORTED_LOCALES,
    'the storage layer re-exports the derived list, it does not hold its own',
  );
});
