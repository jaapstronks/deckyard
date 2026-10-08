/**
 * The interface language of pages a visitor reaches without a session (D322,
 * B615): the share viewer, follow-along and `/go`.
 *
 * A saved preference or `?locale=` wins; otherwise the deck's language, then
 * the first browser language the manifest knows, then the one shared default
 * `en`. The derived language is never saved: one visited share link must not
 * set the app shell's language for later.
 *
 * The resolver is exercised per page with the input that page hands it
 * (share viewer: the deck's `resolveDeckLang()`, follow: the deck language on
 * its URL, `/go`: no deck), and a source pin holds each page to that call.
 *
 * Run with: node --test tests/viewer-ui-locale.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyViewerUiLocale,
  getUiLocale,
  matchUiLocale,
  pickViewerUiLocale,
  resolveInitialUiLocale,
  resolveViewerUiLocale,
} from '../client/lib/ui-i18n.js';
import { DEFAULT_UI_LOCALE } from '../shared/constants/ui-locale.js';
import { resolveDeckLang } from '../shared/i18n-utils.js';
import { defaultUserSettings } from '../server/storage/settings.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const KNOWN = [
  'en',
  'nl',
  'de',
  'fr',
  'es',
  'pt',
  'it',
  'pl',
  'fi',
  'da',
  'sv',
  'no',
];

/** Map-backed Web Storage on globalThis under `name`. */
function installStorage(name) {
  const store = new Map();
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  });
  return store;
}

let local;
let prevFetch;

beforeEach(() => {
  local = installStorage('localStorage');
  installStorage('sessionStorage');
  prevFetch = globalThis.fetch;
  // The manifest, and an empty dictionary for every component file.
  globalThis.fetch = async (url) => ({
    ok: true,
    async json() {
      return String(url).endsWith('/manifest.json')
        ? { locales: KNOWN.map((id) => ({ id, label: id })) }
        : {};
    },
  });
});

afterEach(() => {
  globalThis.fetch = prevFetch;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});

describe('one default', () => {
  it('is en, shared by the client and the server settings', () => {
    assert.equal(DEFAULT_UI_LOCALE, 'en');
    assert.equal(defaultUserSettings().uiLocale, DEFAULT_UI_LOCALE);
  });

  it('is what the app shell falls back to without a choice', async () => {
    assert.equal(await resolveInitialUiLocale(''), 'en');
  });

  it('nl is nowhere a default in the UI-locale code', () => {
    const src = read('client/lib/ui-i18n.js');
    assert.doesNotMatch(src, /DEFAULT_LOCALE\s*=/);
    assert.doesNotMatch(src, /\|\|\s*'nl'/);
    assert.match(src, /shared\/constants\/ui-locale\.js/);
  });
});

describe('pickViewerUiLocale (the order)', () => {
  it('a chosen locale beats deck and browser', () => {
    assert.equal(
      pickViewerUiLocale({
        chosen: 'de',
        deckLang: 'en-GB',
        browserLangs: ['nl-NL'],
        known: KNOWN,
      }),
      'de',
    );
  });

  it('the deck language beats the browser', () => {
    assert.equal(
      pickViewerUiLocale({
        deckLang: 'en-GB',
        browserLangs: ['nl-NL'],
        known: KNOWN,
      }),
      'en',
    );
  });

  it('a deck language the manifest does not know falls to the browser', () => {
    assert.equal(
      pickViewerUiLocale({
        deckLang: 'ja',
        browserLangs: ['xx', 'fr-BE'],
        known: KNOWN,
      }),
      'fr',
    );
  });

  it('nothing known lands on the default', () => {
    assert.equal(
      pickViewerUiLocale({
        deckLang: 'ja',
        browserLangs: ['ko'],
        known: KNOWN,
      }),
      DEFAULT_UI_LOCALE,
    );
  });

  it('matchUiLocale takes the exact id, then the primary subtag', () => {
    assert.equal(matchUiLocale('NL', KNOWN), 'nl');
    assert.equal(matchUiLocale('pt-BR', KNOWN), 'pt');
    assert.equal(matchUiLocale('zz-ZZ', KNOWN), null);
    assert.equal(matchUiLocale('../etc', KNOWN), null);
  });
});

describe('share viewer', () => {
  const englishDeck = { i18n: { active: 'en-GB', dominant: 'en-GB' } };
  const dutchDeck = { i18n: { active: 'nl', dominant: 'nl' } };

  it('speaks the deck language, whatever the browser says', async () => {
    const deckLang = resolveDeckLang(englishDeck);
    assert.equal(
      await resolveViewerUiLocale({
        deckLang,
        search: '',
        browserLangs: ['nl-NL'],
      }),
      'en',
    );
    assert.equal(
      await resolveViewerUiLocale({
        deckLang: resolveDeckLang(dutchDeck),
        search: '',
        browserLangs: ['en-US'],
      }),
      'nl',
    );
  });

  it('before the deck is known (password, errors): the browser', async () => {
    assert.equal(
      await resolveViewerUiLocale({ search: '', browserLangs: ['de-AT'] }),
      'de',
    );
  });

  it('without deck or known browser language: the default', async () => {
    assert.equal(
      await resolveViewerUiLocale({ search: '', browserLangs: [] }),
      DEFAULT_UI_LOCALE,
    );
  });

  it('a saved preference wins over the deck', async () => {
    local.set('ps-ui-locale', 'nl');
    assert.equal(
      await resolveViewerUiLocale({
        deckLang: resolveDeckLang(englishDeck),
        search: '',
        browserLangs: ['en-US'],
      }),
      'nl',
    );
  });

  it('a ?locale= wins over the deck', async () => {
    assert.equal(
      await resolveViewerUiLocale({
        deckLang: 'nl',
        search: '?locale=fr',
        browserLangs: [],
      }),
      'fr',
    );
  });

  it('the page resolves before its chrome and again with the deck', () => {
    const src = read('client/views/share-viewer/index.js');
    assert.match(src, /await applyViewerUiLocale\(\);/);
    assert.match(
      src,
      /applyViewerUiLocale\(\{ deckLang: resolveDeckLang\(deck\) \}\)/,
    );
  });
});

describe('follow-along', () => {
  it('speaks the deck language on its URL', async () => {
    assert.equal(
      await resolveViewerUiLocale({
        deckLang: 'en-GB',
        search: '?lang=en-GB',
        browserLangs: ['nl'],
      }),
      'en',
    );
  });

  it('a deck language the manifest lacks: the browser', async () => {
    assert.equal(
      await resolveViewerUiLocale({
        deckLang: 'ja',
        search: '',
        browserLangs: ['sv-SE'],
      }),
      'sv',
    );
  });

  it('nothing known: the default', async () => {
    assert.equal(
      await resolveViewerUiLocale({
        deckLang: 'ja',
        search: '',
        browserLangs: ['ko'],
      }),
      DEFAULT_UI_LOCALE,
    );
  });

  it('a saved preference wins over the deck', async () => {
    local.set('ps-ui-locale', 'de');
    assert.equal(
      await resolveViewerUiLocale({
        deckLang: 'nl',
        search: '',
        browserLangs: [],
      }),
      'de',
    );
  });

  it('the page resolves with its deck language, also on a live switch', () => {
    const src = read('client/views/follow/index.js');
    const calls = src.match(/applyViewerUiLocale\(\{ deckLang: lang \}\)/g);
    assert.equal(calls?.length, 2);
  });
});

describe('/go', () => {
  it('speaks the browser language', async () => {
    assert.equal(
      await resolveViewerUiLocale({ search: '', browserLangs: ['nl-BE'] }),
      'nl',
    );
  });

  it('an unknown browser language: the default', async () => {
    assert.equal(
      await resolveViewerUiLocale({ search: '', browserLangs: ['ja-JP'] }),
      DEFAULT_UI_LOCALE,
    );
  });

  it('a saved preference wins over the browser', async () => {
    local.set('ps-ui-locale', 'fi');
    assert.equal(
      await resolveViewerUiLocale({ search: '', browserLangs: ['nl'] }),
      'fi',
    );
  });

  it('the page resolves without a deck and translates its copy', () => {
    const src = read('client/go.js');
    assert.match(src, /applyViewerUiLocale\(\)/);
    assert.match(src, /t\('go\.title'/);
  });
});

describe('the derived language is not saved', () => {
  it('applyViewerUiLocale switches the UI but leaves localStorage alone', async () => {
    const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { languages: ['da-DK'] },
    });
    try {
      const applied = await applyViewerUiLocale({ deckLang: 'pl' });
      assert.equal(applied, 'pl');
      assert.equal(getUiLocale(), 'pl');
      assert.equal(local.has('ps-ui-locale'), false);
    } finally {
      if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav);
      else delete globalThis.navigator;
    }
  });
});
