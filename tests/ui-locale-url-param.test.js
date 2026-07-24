/**
 * Tests for the UI-locale URL-param seam.
 *
 * `readUiLocaleParam()` lets an external origin (deckyard.eu) deep-link into the
 * app or the sandbox in a chosen language via `?lang=en` / `?locale=en`. It is a
 * pure query-string parser (no localStorage/fetch), so it's exercised here with
 * explicit search strings. The manifest-validated `resolveInitialUiLocale()`
 * wrapper is not unit-tested (it touches fetch + localStorage); its contract is
 * covered by the parser + normalizer below.
 *
 * Run with: node --test tests/ui-locale-url-param.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readUiLocaleParam, normalizeUiLocale } from '../client/lib/ui-i18n.js';

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
