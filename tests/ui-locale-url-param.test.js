/**
 * Tests for the UI-locale URL-param seam.
 *
 * `readUiLocaleParam()` lets an external origin (deckyard.eu) deep-link into the
 * app or the sandbox in a chosen language via `?lang=en` / `?locale=en`. It is a
 * pure query-string parser (no localStorage/fetch), so it's exercised here with
 * explicit search strings.
 *
 * `resolveInitialUiLocale()` validates that param against the locale manifest and
 * records a valid one as the per-session override (getSessionLocaleOverride) so
 * the URL param outranks the stored/server preference for the session — the fix
 * for the sandbox ignoring `?lang=nl`. It's exercised here with a mocked `fetch`
 * (manifest) and the graceful localStorage-less `storage` shim.
 *
 * Run with: node --test tests/ui-locale-url-param.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readUiLocaleParam,
  normalizeUiLocale,
  resolveInitialUiLocale,
  getSessionLocaleOverride,
} from '../client/lib/ui-i18n.js';

/** Run `fn` with `fetch` stubbed to serve a locale manifest of `ids`. */
async function withManifest(ids, fn) {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { locales: ids.map((id) => ({ id, label: id })) };
    },
  });
  try {
    return await fn();
  } finally {
    globalThis.fetch = prevFetch;
  }
}

test('reads a well-formed ?lang= value', () => {
  assert.equal(readUiLocaleParam('?lang=en'), 'en');
  assert.equal(readUiLocaleParam('lang=nl'), 'nl');
});

test('falls back to ?locale= when ?lang= is absent', () => {
  assert.equal(readUiLocaleParam('?locale=de'), 'de');
});

test('lang takes precedence over locale', () => {
  assert.equal(readUiLocaleParam('?locale=de&lang=en'), 'en');
});

test('accepts region-tagged locales', () => {
  assert.equal(readUiLocaleParam('?lang=en-GB'), 'en-GB');
  assert.equal(readUiLocaleParam('?lang=pt-BR'), 'pt-BR');
});

test('returns null for a missing param', () => {
  assert.equal(readUiLocaleParam(''), null);
  assert.equal(readUiLocaleParam('?foo=bar'), null);
});

test('rejects malformed / unsafe values (no path traversal, no junk)', () => {
  // Same conservative subset normalizeUiLocale enforces.
  assert.equal(readUiLocaleParam('?lang=../../etc/passwd'), null);
  assert.equal(readUiLocaleParam('?lang=' + encodeURIComponent('en/../../x')), null);
  assert.equal(readUiLocaleParam('?lang=123'), null);
  assert.equal(readUiLocaleParam('?lang='), null);
});

test('tolerates a malformed query string without throwing', () => {
  assert.equal(readUiLocaleParam('%'), null);
  assert.equal(readUiLocaleParam('?lang=%E0%A4%A'), null);
});

test('parser and normalizer agree on the accepted shape', () => {
  // A value the parser returns must be one the normalizer already accepts.
  const v = readUiLocaleParam('?lang=zh-Hant');
  assert.equal(v, 'zh-Hant');
  assert.equal(normalizeUiLocale(v), v);
});

test('resolveInitialUiLocale applies a manifest-known ?lang and records the session override', async () => {
  await withManifest(['en', 'nl'], async () => {
    const locale = await resolveInitialUiLocale('?lang=nl');
    assert.equal(locale, 'nl');
    // The session override is what lets ?lang outrank a saved 'en' preference.
    assert.equal(getSessionLocaleOverride(), 'nl');
  });
});

test('resolveInitialUiLocale silently ignores an unknown locale (no override)', async () => {
  await withManifest(['en', 'nl'], async () => {
    const locale = await resolveInitialUiLocale('?lang=zz');
    // Unknown tag can't blank the dictionary: falls back, no session override.
    assert.notEqual(locale, 'zz');
    assert.equal(getSessionLocaleOverride(), null);
  });
});

test('resolveInitialUiLocale clears the session override when no param is present', async () => {
  await withManifest(['en', 'nl'], async () => {
    // Seed an override, then confirm a param-less resolve clears it.
    await resolveInitialUiLocale('?lang=nl');
    assert.equal(getSessionLocaleOverride(), 'nl');
    await resolveInitialUiLocale('?foo=bar');
    assert.equal(getSessionLocaleOverride(), null);
  });
});
