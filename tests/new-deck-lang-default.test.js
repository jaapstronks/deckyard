/**
 * Tests for the initial deck-language default in the "New presentation" flow.
 *
 * The bug: opening the app at `?lang=en` gave an English UI but a Language
 * toggle stuck on NL, because the selector fell back to the first supported
 * language and never consulted the UI locale. The fix is a precedence rule,
 * encoded in `resolveInitialDeckLang()` and pinned here:
 *
 *   stored preference > UI locale > first supported language
 *
 * Only the *initial* value of the toggle is at stake — it stays a default the
 * user can override by clicking, and this says nothing about which language
 * slide content follows.
 *
 * Run with: node --test tests/new-deck-lang-default.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  langFromUiLocale,
  resolveInitialDeckLang,
  setSupportedLangs,
  defaultLang,
} from '../client/lib/format/i18n.js';

// setSupportedLangs is module-level state; restore the NL/EN default after any
// test that narrows it so ordering can't leak.
const DEFAULT_SUPPORTED = ['nl', 'en-GB'];

test.beforeEach(() => setSupportedLangs(DEFAULT_SUPPORTED));

test('UI locale decides when no preference is stored', () => {
  assert.equal(resolveInitialDeckLang({ storedLang: null, uiLocale: 'en' }), 'en-GB');
  assert.equal(resolveInitialDeckLang({ storedLang: null, uiLocale: 'nl' }), 'nl');
});

test('a stored preference outranks the UI locale', () => {
  // Someone who once picked NL keeps NL, even reading the app in English.
  assert.equal(resolveInitialDeckLang({ storedLang: 'nl', uiLocale: 'en' }), 'nl');
  assert.equal(resolveInitialDeckLang({ storedLang: 'en-GB', uiLocale: 'nl' }), 'en-GB');
});

test('an unsupported stored value is ignored, not honoured', () => {
  // Stale localStorage must not beat the locale — it is not a valid choice.
  assert.equal(resolveInitialDeckLang({ storedLang: 'de', uiLocale: 'en' }), 'en-GB');
  assert.equal(resolveInitialDeckLang({ storedLang: '', uiLocale: 'en' }), 'en-GB');
  assert.equal(resolveInitialDeckLang({ storedLang: undefined, uiLocale: 'en' }), 'en-GB');
});

test('falls back to the first supported language when neither source helps', () => {
  assert.equal(resolveInitialDeckLang({ storedLang: null, uiLocale: 'de' }), defaultLang());
  assert.equal(resolveInitialDeckLang({ storedLang: null, uiLocale: null }), defaultLang());
  assert.equal(resolveInitialDeckLang(), defaultLang());
});

test('the fallback follows the workspace, not a hardcoded nl', () => {
  setSupportedLangs(['en-GB']);
  assert.equal(resolveInitialDeckLang({ storedLang: null, uiLocale: 'de' }), 'en-GB');
  // A stored 'nl' is no longer supported here, so it cannot win either.
  assert.equal(resolveInitialDeckLang({ storedLang: 'nl', uiLocale: 'de' }), 'en-GB');
});

test('locale mapping matches the full tag, then the primary subtag', () => {
  assert.equal(langFromUiLocale('en-GB'), 'en-GB');
  assert.equal(langFromUiLocale('en'), 'en-GB');
  assert.equal(langFromUiLocale('en-US'), 'en-GB'); // regional variant, same language
  assert.equal(langFromUiLocale('nl-BE'), 'nl');
  assert.equal(langFromUiLocale('EN'), 'en-GB'); // tags are case-insensitive
});

test('locale mapping returns null for a language the workspace lacks', () => {
  assert.equal(langFromUiLocale('de'), null);
  assert.equal(langFromUiLocale('pt-BR'), null);
  assert.equal(langFromUiLocale(''), null);
  assert.equal(langFromUiLocale(null), null);
});
