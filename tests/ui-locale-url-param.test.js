/**
 * Tests for the UI-locale URL-param seam.
 *
 * `readUiLocaleParam()` lets an external origin (deckyard.eu) deep-link into the
 * app or the sandbox in a chosen *interface* language via `?locale=en`. It is a
 * pure query-string parser (no localStorage/fetch), so it's exercised here with
 * explicit search strings.
 *
 * The key is `locale`, not `lang`: `?lang=` names the **deck** language and is
 * read by `client/lib/format/i18n.js`. The two shared one key until D61, which
 * is how a shared editor link carrying `?lang=nl` also switched the recipient's
 * whole interface to Dutch. The split is pinned below in both directions.
 *
 * `resolveInitialUiLocale()` validates that param against the locale manifest and
 * records a valid one as the per-session override (getSessionLocaleOverride) so
 * the URL param outranks the stored/server preference for the session — the fix
 * for the sandbox ignoring `?locale=nl`. It's exercised here with a mocked `fetch`
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
  clearSessionLocaleOverride,
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

test('reads a well-formed ?locale= value', () => {
  assert.equal(readUiLocaleParam('?locale=en'), 'en');
  assert.equal(readUiLocaleParam('locale=nl'), 'nl');
});

test('?lang= is not read: it names the deck language, not the interface', () => {
  // The whole point of the D61 split: a shared `?lang=nl` editor link sets the
  // deck language and leaves the recipient's interface alone.
  assert.equal(readUiLocaleParam('?lang=nl'), null);
  assert.equal(readUiLocaleParam('?lang=nl&locale=en'), 'en');
});

test('accepts region-tagged locales', () => {
  assert.equal(readUiLocaleParam('?locale=en-GB'), 'en-GB');
  assert.equal(readUiLocaleParam('?locale=pt-BR'), 'pt-BR');
});

test('returns null for a missing param', () => {
  assert.equal(readUiLocaleParam(''), null);
  assert.equal(readUiLocaleParam('?foo=bar'), null);
});

test('rejects malformed / unsafe values (no path traversal, no junk)', () => {
  // Same conservative subset normalizeUiLocale enforces.
  assert.equal(readUiLocaleParam('?locale=../../etc/passwd'), null);
  assert.equal(
    readUiLocaleParam('?locale=' + encodeURIComponent('en/../../x')),
    null,
  );
  assert.equal(readUiLocaleParam('?locale=123'), null);
  assert.equal(readUiLocaleParam('?locale='), null);
});

test('tolerates a malformed query string without throwing', () => {
  assert.equal(readUiLocaleParam('%'), null);
  assert.equal(readUiLocaleParam('?locale=%E0%A4%A'), null);
});

test('parser and normalizer agree on the accepted shape', () => {
  // A value the parser returns must be one the normalizer already accepts.
  const v = readUiLocaleParam('?locale=zh-Hant');
  assert.equal(v, 'zh-Hant');
  assert.equal(normalizeUiLocale(v), v);
});

test('resolveInitialUiLocale applies a manifest-known ?locale and records the session override', async () => {
  await withManifest(['en', 'nl'], async () => {
    const locale = await resolveInitialUiLocale('?locale=nl');
    assert.equal(locale, 'nl');
    // The session override is what lets ?locale outrank a saved 'en' preference.
    assert.equal(getSessionLocaleOverride(), 'nl');
  });
});

test('resolveInitialUiLocale silently ignores an unknown locale (no override)', async () => {
  await withManifest(['en', 'nl'], async () => {
    const locale = await resolveInitialUiLocale('?locale=zz');
    // Unknown tag can't blank the dictionary: falls back, no session override.
    assert.notEqual(locale, 'zz');
    assert.equal(getSessionLocaleOverride(), null);
  });
});

test('clearSessionLocaleOverride drops the override (explicit save supersedes ?locale)', async () => {
  await withManifest(['en', 'nl'], async () => {
    await resolveInitialUiLocale('?locale=nl');
    assert.equal(getSessionLocaleOverride(), 'nl');
    // The settings save flow calls this so the saved preference regains
    // authority (and the re-rendered picker shows the saved choice).
    clearSessionLocaleOverride();
    assert.equal(getSessionLocaleOverride(), null);
  });
});

test('resolveInitialUiLocale clears the session override when no param is present', async () => {
  await withManifest(['en', 'nl'], async () => {
    // Seed an override, then confirm a param-less resolve clears it.
    await resolveInitialUiLocale('?locale=nl');
    assert.equal(getSessionLocaleOverride(), 'nl');
    await resolveInitialUiLocale('?foo=bar');
    assert.equal(getSessionLocaleOverride(), null);
  });
});
