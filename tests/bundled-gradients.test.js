/**
 * Bundled gradients — the image source that ships inside Deckyard.
 *
 * Two things have to stay true or the feature quietly rots:
 *
 * 1. **The committed SVGs are what the generator produces.** They are checked
 *    in so `/assets/gradients/*` is inlined by the export paths for free; the
 *    price of that is drift when a theme colour changes and nobody re-runs
 *    `npm run gen:gradients`. This file is that gate.
 * 2. **A source is offered only when an admin turned it on.** `bundled` is
 *    always `configured` (no key to miss), so `enabled` is the only thing
 *    standing between a fresh install and a new button in the picker.
 *
 * Run with: node --test tests/bundled-gradients.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  GRADIENT_COMPOSITIONS,
  GRADIENT_DIR_REL,
  GRADIENT_HEIGHT,
  GRADIENT_URL_PREFIX,
  GRADIENT_WIDTH,
  buildGradientItems,
  clearBundledGradientCache,
  listBundledGradients,
  loadBundledGradientThemes,
  paletteFromTheme,
  renderGradientSvg,
  toneOf,
} from '../server/media/bundled-gradients.js';
import { getAppSettings, writeAppSettings } from '../server/storage/settings.js';
import { embedImgSrcDataUrls } from '../server/utils/html-utils.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gradientDir = path.join(repoRoot, GRADIENT_DIR_REL);

const THEME = {
  id: 'demo',
  label: 'Demo',
  brandColors: ['#112233', '#445566', '#778899', '#aabbcc'],
  cssVars: {
    '--t-slide-bg-lime': '#ffffff',
    '--t-slide-bg-mist': '#eeeeee',
    '--t-slide-bg-dark': '#101010',
    '--t-color-accent': '#ff0066',
  },
};

// ---------------------------------------------------------------- palette

test('a palette is read from the colours a theme already declares', () => {
  const p = paletteFromTheme(THEME);
  assert.equal(p.id, 'demo');
  assert.equal(p.label, 'Demo');
  assert.equal(p.dark, '#101010');
  assert.equal(p.accent, '#ff0066');
  assert.deepEqual(p.brand, ['#112233', '#445566', '#778899', '#aabbcc']);
});

test('fewer than four brand colours cycle rather than leaving holes', () => {
  const p = paletteFromTheme({ ...THEME, brandColors: ['#112233', '#445566'] });
  assert.deepEqual(p.brand, ['#112233', '#445566', '#112233', '#445566']);
});

test('a theme missing a colour we need yields no palette instead of a guess', () => {
  assert.equal(paletteFromTheme({ ...THEME, brandColors: ['#112233'] }), null);
  assert.equal(paletteFromTheme({ ...THEME, cssVars: {} }), null);
  assert.equal(paletteFromTheme({ ...THEME, id: 'Not A Slug' }), null);
  assert.equal(paletteFromTheme(null), null);
});

test('a non-hex colour is rejected, never passed through into the SVG', () => {
  const p = paletteFromTheme({
    ...THEME,
    brandColors: ['#112233', 'red', 'var(--x)', '#445566'],
  });
  // 'red' and 'var(--x)' drop out; the two survivors cycle.
  assert.deepEqual(p.brand, ['#112233', '#445566', '#112233', '#445566']);
});

// ---------------------------------------------------------------- items

test('the library is every theme crossed with every composition, sorted', () => {
  const items = buildGradientItems([THEME]);
  assert.equal(items.length, GRADIENT_COMPOSITIONS.length);
  assert.deepEqual(
    items.map((i) => i.id),
    GRADIENT_COMPOSITIONS.map((c) => `demo-${c.id}`).sort()
  );
  const first = items[0];
  assert.equal(first.url, `${GRADIENT_URL_PREFIX}${first.id}.svg`);
  assert.equal(first.width, GRADIENT_WIDTH);
  assert.equal(first.height, GRADIENT_HEIGHT);
  assert.ok(first.alt.length > 0);
  assert.ok(first.tags.includes('gradient'));
});

test('a theme without a usable palette contributes nothing', () => {
  assert.deepEqual(buildGradientItems([{ id: 'broken' }]), []);
});

test('tone is measured from the base, not declared by the composition', () => {
  assert.equal(toneOf('#101010'), 'dark');
  assert.equal(toneOf('#ffffff'), 'light');
  // Midnight's paper token: the "light" recipe over it is still a dark image,
  // and mislabelling it would hand the user white text on near-black.
  assert.equal(toneOf('#18181b'), 'dark');
});

test('the built-in set offers both tones, so it is not white-text-only', async () => {
  const items = buildGradientItems(await loadBundledGradientThemes(repoRoot));
  const tones = new Set(items.map((i) => i.tone));
  assert.ok(tones.has('dark'));
  assert.ok(tones.has('light'));
  const midnightMist = items.find((i) => i.id === 'midnight-mist');
  assert.equal(midnightMist.tone, 'dark');
});

// ---------------------------------------------------------------- svg

test('rendering is deterministic and emits only validated colours', () => {
  const [item] = buildGradientItems([THEME]);
  const svg = renderGradientSvg(item.spec);
  assert.equal(svg, renderGradientSvg(item.spec));
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes(`viewBox="0 0 ${GRADIENT_WIDTH} ${GRADIENT_HEIGHT}"`));
  // No scripting, no external reference: an SVG in an <img> is inert, and this
  // keeps it inert even if it is ever inlined into a document.
  assert.ok(!/<script|href|xlink:href|url\(https?:/i.test(svg));
  for (const color of svg.matchAll(/stop-color="([^"]+)"/g)) {
    assert.match(color[1], /^#[0-9a-f]{6}$/);
  }
});

// ------------------------------------------------------- committed assets

test('every committed SVG is exactly what the generator produces', async () => {
  const themes = await loadBundledGradientThemes(repoRoot);
  const items = buildGradientItems(themes);
  assert.ok(items.length > 0, 'no themes yielded gradients');

  for (const item of items) {
    const file = path.join(gradientDir, `${item.id}.svg`);
    const onDisk = await fs.readFile(file, 'utf8').catch(() => null);
    assert.ok(onDisk !== null, `missing ${item.id}.svg — run: npm run gen:gradients`);
    assert.equal(
      onDisk,
      renderGradientSvg(item.spec),
      `${item.id}.svg is stale — run: npm run gen:gradients`
    );
  }
});

test('no orphan gradient assets are left behind', async () => {
  const themes = await loadBundledGradientThemes(repoRoot);
  const expected = new Set(buildGradientItems(themes).map((i) => `${i.id}.svg`));
  const onDisk = (await fs.readdir(gradientDir)).filter((n) => n.endsWith('.svg'));
  const orphans = onDisk.filter((n) => !expected.has(n));
  assert.deepEqual(orphans, [], `run: npm run gen:gradients`);
});

// ---------------------------------------------------------------- manifest

test('the manifest carries no render spec — the picker only needs addresses', async () => {
  clearBundledGradientCache();
  const items = await listBundledGradients(repoRoot);
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(item.spec, undefined);
    assert.ok(item.url.startsWith(GRADIENT_URL_PREFIX));
    assert.match(item.id, /^[a-z0-9][a-z0-9-]*$/);
  }
  clearBundledGradientCache();
});

// ------------------------------------------------------------------ export

test('a picked gradient is inlined by the export path, so PDFs need no network', async () => {
  const items = await listBundledGradients(repoRoot);
  clearBundledGradientCache();
  const html = `<img src="${items[0].url}" alt="">`;
  const out = await embedImgSrcDataUrls(repoRoot, html);
  // This is the entire reason the SVGs are committed under /assets/ instead of
  // generated behind an /api/ route: that prefix is what the exporter inlines.
  assert.match(out, /src="data:image\/svg\+xml;base64,/);
  assert.ok(!out.includes(items[0].url));
});

// ---------------------------------------------------------------- settings

test('stockMedia.bundled is off by default and round-trips', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-gradients-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'data'), { recursive: true });

  const before = await getAppSettings(dir);
  assert.equal(before.stockMedia.bundled.enabled, false);

  const after = await writeAppSettings(dir, {
    stockMedia: { bundled: { enabled: true } },
  });
  assert.equal(after.stockMedia.bundled.enabled, true);
  assert.equal((await getAppSettings(dir)).stockMedia.bundled.enabled, true);
});

test('a write that mentions one source leaves the others alone', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-gradients-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'data'), { recursive: true });

  await writeAppSettings(dir, {
    stockMedia: { bundled: { enabled: true }, unsplash: { enabled: true } },
  });
  // A client that only knows about Giphy must not switch the other two off.
  const after = await writeAppSettings(dir, { stockMedia: { giphy: { enabled: true } } });
  assert.equal(after.stockMedia.bundled.enabled, true);
  assert.equal(after.stockMedia.unsplash.enabled, true);
  assert.equal(after.stockMedia.giphy.enabled, true);
});
