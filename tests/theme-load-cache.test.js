/**
 * Client theme loading: which fetched theme is accepted, and invalidation.
 *
 * Every fetched theme uses its record UUID as `id`; anonymous views preload
 * that same config through their authorized deck payload.
 *
 * Run with: node --test tests/theme-load-cache.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(
  '<!doctype html><html><head></head><body></body></html>',
  {
    url: 'http://localhost/app/x',
  },
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
// BroadcastChannel is absent in jsdom; the module must survive that.
delete globalThis.BroadcastChannel;

const UUID = '2b8ff646-0a51-4bbf-9304-fbfc09903bbc';

const dbTheme = () => ({
  id: UUID,
  slug: 'acme',
  label: 'Acme',
  cssVars: { '--t-color-accent': '#00aa55' },
  embedFonts: [{ family: 'Acme Sans', url: '/f.woff2', weight: 400 }],
  slideBackgrounds: [{ id: 'calm', label: 'Calm', value: '#e8f0ee' }],
});

let served = dbTheme();
let fetches = 0;
let currentDefault = UUID;
// Response-like enough for api(): the layer reads status and content-type.
globalThis.fetch = async (url) => {
  fetches += 1;
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json; charset=utf-8' },
    json: async () =>
      url === '/api/themes'
        ? { themes: [{ id: currentDefault, isDefault: true }] }
        : structuredClone(served),
  };
};

const { loadThemeById, normalizeThemeId, invalidateTheme, clearThemeCache } =
  await import('../client/lib/theme/theme.js');

test('default resolves the current workspace theme instead of the built-in id', async () => {
  assert.equal(normalizeThemeId('default'), 'default');
  clearThemeCache();
  const before = fetches;
  const theme = await loadThemeById('default');
  assert.equal(theme.id, UUID);
  assert.equal(fetches, before + 2, 'setting and selected theme are fetched');

  const seedId = '11111111-1111-4111-8111-111111111111';
  currentDefault = seedId;
  served = { id: seedId, slug: 'brand', label: 'Brand', cssVars: {} };
  const changed = await loadThemeById('default');
  assert.equal(changed.id, seedId);
  currentDefault = UUID;
  served = dbTheme();
});

test('a theme reference is default or a lowercase record UUID, nothing else', () => {
  // The client mirrors the server (`resolveThemeId`): one spelling, refused
  // rather than repaired. The uppercase form is a second spelling of the same
  // record and used to be lowercased on the way in.
  assert.equal(normalizeThemeId(UUID), UUID);
  assert.throws(() => normalizeThemeId(UUID.toUpperCase()), TypeError);
  assert.throws(() => normalizeThemeId('brand'), TypeError);
  assert.throws(() => normalizeThemeId(''), TypeError);
});

test('anonymous default uses the theme config in its deck payload', async () => {
  clearThemeCache();
  const before = fetches;
  const theme = await loadThemeById('default', { config: dbTheme() });
  assert.equal(theme.id, UUID);
  assert.equal(fetches, before);
});

test('a database theme is loaded through the record API', async () => {
  clearThemeCache();
  const theme = await loadThemeById(UUID);

  // The regression: this used to be the blank fallback, whose label is the raw
  // UUID and whose accent is absent.
  assert.equal(theme.label, 'Acme');
  assert.equal(theme.cssVars['--t-color-accent'], '#00aa55');
  assert.notEqual(theme.label, UUID);
});

test('its font and background styles are injected under the requested id', async () => {
  clearThemeCache();
  await loadThemeById(UUID);

  assert.ok(
    document.getElementById(`theme-fonts-${UUID}`),
    'font styles injected',
  );
  assert.ok(
    document.getElementById(`theme-slide-bgs-${UUID}`),
    'bg styles injected',
  );
});

test('a theme that is not the requested record is refused', async () => {
  clearThemeCache();
  served = {
    id: '33333333-3333-4333-8333-333333333333',
    label: 'Wrong',
    cssVars: { '--t-color-accent': '#f00' },
  };

  await assert.rejects(loadThemeById(UUID), /was not found/);

  served = dbTheme();
});

test('the cache is used on a second load, and invalidation clears it', async () => {
  clearThemeCache();
  const first = await loadThemeById(UUID);
  assert.equal(await loadThemeById(UUID), first, 'cached instance reused');

  invalidateTheme(UUID);
  const second = await loadThemeById(UUID);
  assert.notEqual(second, first, 're-fetched after invalidation');
  assert.equal(second.label, 'Acme');
});

test('invalidation removes the injected style elements', async () => {
  clearThemeCache();
  await loadThemeById(UUID);
  assert.ok(document.getElementById(`theme-fonts-${UUID}`));

  invalidateTheme(UUID);

  // Left behind, the old @font-face and .slide-bg-* rules would keep winning:
  // both injectors bail when an element with the same id already exists.
  assert.equal(document.getElementById(`theme-fonts-${UUID}`), null);
  assert.equal(document.getElementById(`theme-slide-bgs-${UUID}`), null);
});

test('an edited theme serves its new values after invalidation', async () => {
  clearThemeCache();
  assert.equal(
    (await loadThemeById(UUID)).cssVars['--t-color-accent'],
    '#00aa55',
  );

  served = { ...dbTheme(), cssVars: { '--t-color-accent': '#ff0000' } };
  invalidateTheme(UUID);

  assert.equal(
    (await loadThemeById(UUID)).cssVars['--t-color-accent'],
    '#ff0000',
  );
  served = dbTheme();
});

test('clearThemeCache drops every theme', async () => {
  clearThemeCache();
  const a = await loadThemeById(UUID);
  clearThemeCache();
  assert.notEqual(await loadThemeById(UUID), a);
});

// ---------------------------------------------------------------------------
// The preload entrance
// ---------------------------------------------------------------------------
//
// `GET /api/themes/:id/config` is behind the login gate, so the three
// anonymous surfaces (share viewer, follow audience, notes companion) cannot
// call it at all: they receive the theme with the deck payload their token
// authorizes and hand it in here. This is one loader with a second entrance,
// not a second loader — the preloaded config still gets normalized, cached and
// style-injected exactly like a fetched one.

test('a preloaded config is used instead of the fetch the anonymous surfaces cannot make', async () => {
  clearThemeCache();
  const before = fetches;

  const theme = await loadThemeById(UUID, {
    config: { ...dbTheme(), label: 'From the payload' },
  });

  assert.equal(theme.label, 'From the payload');
  assert.equal(fetches, before, 'no request went out');
});

test('a preloaded theme is cached and injects its styles like a fetched one', async () => {
  clearThemeCache();
  const theme = await loadThemeById(UUID, { config: dbTheme() });

  assert.ok(document.getElementById(`theme-fonts-${UUID}`));
  assert.ok(document.getElementById(`theme-slide-bgs-${UUID}`));
  assert.equal(
    await loadThemeById(UUID),
    theme,
    'the cache answers the next caller, config or not',
  );
});

test('without a config the loader still fetches — that is the authenticated path', async () => {
  clearThemeCache();
  const before = fetches;
  const theme = await loadThemeById(UUID);
  assert.equal(fetches, before + 1);
  assert.equal(theme.label, 'Acme');
});
