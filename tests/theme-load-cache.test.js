/**
 * Client theme loading: which fetched theme is accepted, and invalidation.
 *
 * A database theme is requested by UUID but reports its *slug* as `id`, so the
 * "is this the theme I asked for?" guard used to reject every custom theme and
 * substitute a blank one — the theme rendered unstyled in the browser while
 * server-side exports looked correct, because they never go through this path.
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

/** A DB theme as `buildThemeConfig` emits it: `id` is the slug, not the UUID. */
const dbTheme = () => ({
  id: 'acme',
  label: 'Acme',
  _isCustomTheme: true,
  _customThemeId: UUID,
  cssVars: { '--t-color-accent': '#00aa55' },
  embedFonts: [{ family: 'Acme Sans', url: '/f.woff2', weight: 400 }],
  slideBackgrounds: [{ id: 'calm', label: 'Calm', value: '#e8f0ee' }],
});

let served = dbTheme();
let fetches = 0;
// Response-like enough for api(): the layer reads status and content-type.
globalThis.fetch = async () => {
  fetches += 1;
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json; charset=utf-8' },
    json: async () => structuredClone(served),
  };
};

const { loadThemeById, invalidateTheme, clearThemeCache } =
  await import('../client/lib/theme/theme.js');

test('a database theme is accepted even though its id is the slug', async () => {
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

test('a theme that is genuinely not the one asked for still falls back', async () => {
  clearThemeCache();
  served = {
    id: 'someone-else',
    label: 'Wrong',
    cssVars: { '--t-color-accent': '#f00' },
  };

  const theme = await loadThemeById(UUID);
  assert.equal(theme.label, UUID, 'blank fallback');
  assert.equal(theme.cssVars['--t-color-accent'], undefined);

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
// `GET /api/themes/custom/:id/config` is behind the login gate, so the three
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
