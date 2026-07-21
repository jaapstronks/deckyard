/**
 * i18n drift guard.
 *
 * Deckyard ships Dutch as the *default* UI locale and English as the reference,
 * so both must be complete: a key missing from nl/ silently renders the English
 * fallback baked into the t() call, which looks like working software while
 * being untranslated. This test fails the build when that drift reappears.
 *
 * Three checks:
 *  1. every static t() key used in client/ exists in both nl/ and en/
 *  2. {var} placeholders match between en/ and nl/ for shared keys
 *  3. follow.* keys are not reachable through the global t() (see below)
 *
 * Run with: node --test tests/i18n-coverage.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractUsedKeys, loadLocale, isDynamicKey } from '../scripts/i18n-keys.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(repoRoot, 'client');
const i18nDir = path.join(clientDir, 'i18n');

/** Locales that must be complete. Other locales fall back and are not gated. */
const REQUIRED_LOCALES = ['nl', 'en'];

const used = await extractUsedKeys(clientDir);
const staticKeys = [...used.keys()].filter((k) => !isDynamicKey(k));

/** @param {string} s @returns {string[]} sorted {var} names in a string */
function placeholders(s) {
  return [...String(s).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
}

describe('i18n coverage', () => {
  for (const locale of REQUIRED_LOCALES) {
    it(`${locale}/ defines every t() key used in client/`, async () => {
      const dict = await loadLocale(i18nDir, locale);
      const missing = staticKeys.filter((k) => typeof dict[k] !== 'string');
      assert.deepStrictEqual(
        missing.sort(),
        [],
        `${missing.length} key(s) used in code but missing from client/i18n/${locale}/.\n` +
          `Add them (see scripts/i18n-keys.js). First few:\n` +
          missing
            .slice(0, 20)
            .map((k) => `  ${k}  <- ${used.get(k).file.replace(repoRoot + '/', '')}`)
            .join('\n')
      );
    });

    it(`${locale}/ has no empty values`, async () => {
      const dict = await loadLocale(i18nDir, locale);
      const empty = Object.keys(dict).filter((k) => !String(dict[k]).trim());
      assert.deepStrictEqual(empty.sort(), [], `Empty translation values in ${locale}/`);
    });
  }

  it('nl and en agree on {var} placeholders', async () => {
    const en = await loadLocale(i18nDir, 'en');
    const nl = await loadLocale(i18nDir, 'nl');
    const mismatched = [];
    for (const key of Object.keys(en)) {
      if (typeof nl[key] !== 'string') continue;
      const a = placeholders(en[key]);
      const b = placeholders(nl[key]);
      if (a.join(',') !== b.join(',')) {
        mismatched.push(`${key}: en{${a.join(',')}} vs nl{${b.join(',')}}`);
      }
    }
    assert.deepStrictEqual(mismatched.sort(), [], 'Placeholder mismatch between en and nl');
  });

  it('follow.* keys are not used through the global t()', async () => {
    // client/i18n/<locale>/follow.json is loaded by the scoped loader in
    // client/views/follow/i18n.js, keyed on the *deck* language, and is
    // deliberately absent from I18N_COMPONENTS in client/lib/ui-i18n.js.
    // A follow.* key passed to the global t() therefore never resolves and is
    // permanently stuck on its English fallback. Route it through the follow
    // `copy` object instead.
    const offenders = staticKeys.filter((k) => k.startsWith('follow.'));
    assert.deepStrictEqual(
      offenders.sort(),
      [],
      'follow.* keys must come from createFollowCopy(), not the global t():\n' +
        offenders.map((k) => `  ${k}  <- ${used.get(k).file.replace(repoRoot + '/', '')}`).join('\n')
    );
  });

  it('nl/ and en/ follow.json define every key createFollowCopy() uses', async () => {
    // The follow chrome resolves its own dictionary per *deck* language, which
    // deckLangToLocale() narrows to exactly 'nl' or 'en'. A key added to
    // createFollowCopy() without a matching follow.json entry silently keeps
    // its inline English fallback in both languages.
    const src = await fs.readFile(path.join(clientDir, 'views/follow/i18n.js'), 'utf8');
    const keys = [...src.matchAll(/\btr\(\s*'(follow\.[\w.]+)'/g)].map((m) => m[1]);
    assert.ok(keys.length > 0, 'no follow keys found — did createFollowCopy move?');
    for (const locale of ['nl', 'en']) {
      const dict = JSON.parse(
        await fs.readFile(path.join(i18nDir, locale, 'follow.json'), 'utf8')
      );
      const missing = keys.filter((k) => typeof dict[k] !== 'string');
      assert.deepStrictEqual(missing.sort(), [], `missing from client/i18n/${locale}/follow.json`);
    }
  });

  it('every locale directory parses as JSON', async () => {
    const locales = (await fs.readdir(i18nDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    assert.ok(locales.length > 0, 'no locale directories found');
    for (const locale of locales) {
      await assert.doesNotReject(
        () => loadLocale(i18nDir, locale),
        `client/i18n/${locale}/ contains invalid JSON`
      );
    }
  });
});
