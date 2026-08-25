/**
 * A local `url()` in a theme var must reach the export as a data URL.
 *
 * Export documents go to headless Chrome through `setContent()`, so the
 * document has no base URL and a root-relative path resolves to nothing. The
 * page markup has been run through the embed pass for a while
 * (`embedImgSrcDataUrls` → `embedLocalCssUrls` in `pdf-slides.js`), but the
 * theme-vars block is assembled separately in `loadExportCssBundle()` and never
 * came past it. Every theme var holding a local asset therefore rendered empty
 * in PDF and PNG — `--t-logo-url` (masked, because the logo also exists as an
 * `<img>`) and any `slideBackgrounds` variant whose value is artwork.
 *
 * The failure mode is the quiet one: right in the editor, blank in the export.
 * Reported by the CIIIC fork on 2026-08-25 after building a theme variant whose
 * background is an image rather than a gradient.
 *
 * One pass in the bundle covers every visual export — pdf-slides, png-slides,
 * html, print and render/png all share it — which is why this test asserts on
 * the bundle rather than on one path.
 *
 * Run with: node --test tests/export-theme-var-assets.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadExportCssBundle } from '../server/export/css-bundle.js';
import { normalizeTheme } from '../shared/theme-normalize.js';
import { themeVarsCssText } from '../server/utils/themes.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** A real repo asset, so the embed pass has something to actually read. */
const LOCAL_ASSET = '/assets/images/deckyard-mark.svg';

function themeWithAssetVar(value) {
  return normalizeTheme({
    id: 'artwork',
    label: 'Artwork',
    cssVars: {
      '--t-color-accent': '#38bdf8',
      '--t-color-accent-on-dark': '#7dd3fc',
      '--t-slide-bg-art': value,
    },
  });
}

test('a bare url() in a theme var is inlined as a data URL', async () => {
  const theme = themeWithAssetVar(`url('${LOCAL_ASSET}') center / cover`);
  const bundle = await loadExportCssBundle(repoRoot, theme, null);

  assert.doesNotMatch(
    bundle.themeVarsCss,
    new RegExp(LOCAL_ASSET),
    'a root-relative path resolves to nothing under setContent() — it must ' +
      'not survive into the export bundle',
  );
  assert.match(
    bundle.themeVarsCss,
    /--t-slide-bg-art:[^;}]*url\(['"]?data:image\/svg\+xml/,
    'the asset must arrive as a data URL on the var that declared it',
  );
});

test('artwork stacked under a gradient survives too', async () => {
  // The combination a theme reaches for when a background image needs a
  // legibility scrim. It is also the value the gradient rasterizer must leave
  // alone (see export-gradient-raster.test.js); here the only question is
  // whether the image gets inlined at all.
  const theme = themeWithAssetVar(
    `linear-gradient(90deg, rgba(0,0,0,0.6), transparent), url('${LOCAL_ASSET}') center / cover, #13393a`,
  );
  const bundle = await loadExportCssBundle(repoRoot, theme, null);

  assert.match(bundle.themeVarsCss, /data:image\/svg\+xml/);
  assert.match(
    bundle.themeVarsCss,
    /linear-gradient\(/,
    'the scrim must still be there — inlining the image must not rewrite the ' +
      'rest of the value',
  );
});

test('a remote url() in a theme var never reaches Chrome', async () => {
  // The half of this pass that is a security boundary, not a rendering one. A
  // variant value is free-form text any authenticated user can set in the
  // theme editor (`variants-section.js`; `cleanCssValue` strips only `[{};]`
  // and `</`), and the bundle is handed straight to `setContent()`. Left live,
  // the URL becomes a server-side fetch of an attacker-chosen address —
  // `docs/reference/security-posture.md` § SSRF guard says that cannot happen.
  const theme = themeWithAssetVar(
    'url(http://169.254.169.254/latest/meta-data/), #000',
  );
  const bundle = await loadExportCssBundle(repoRoot, theme, null);
  assert.doesNotMatch(
    bundle.themeVarsCss,
    /169\.254\.169\.254/,
    'the address must be gone: inlined through the guard, or blanked',
  );
  assert.match(
    bundle.themeVarsCss,
    /--t-slide-bg-art:[^;}]*url\(''\)/,
    "a blocked fetch becomes url('') so Chrome fetches nothing",
  );
});

test('a remote url() is stripped even when a gradient sits over it', async () => {
  // The combination the rasterizer now skips. Before the skip existed, the
  // raster pass rewrote such a declaration to its trailing colour and removed
  // the URL as a side effect; nothing may depend on that accident.
  const theme = themeWithAssetVar(
    'linear-gradient(90deg, rgba(0,0,0,0.6), transparent), url(http://169.254.169.254/x.png), #000',
  );
  const bundle = await loadExportCssBundle(repoRoot, theme, null);
  assert.doesNotMatch(bundle.themeVarsCss, /169\.254\.169\.254/);
});

test('a local asset is embedded once and shared with the slide pass', async () => {
  // The cache the bundle now takes: an asset used both in a theme var and on a
  // slide must be read and recompressed once, not twice.
  const cache = new Map();
  const theme = themeWithAssetVar(`url('${LOCAL_ASSET}')`);
  await loadExportCssBundle(repoRoot, theme, null, { cache });
  assert.equal(cache.size, 1, 'the theme asset lands in the shared cache');

  const before = cache.size;
  await loadExportCssBundle(repoRoot, theme, null, { cache });
  assert.equal(cache.size, before, 'a second export path reuses the entry');
});

test('the transform reaches a theme asset', async () => {
  // Without this the theme background — full-bleed, so the largest image on
  // the slide — would be the one image embedded at full resolution while
  // every other image on the PDF path is downsampled.
  let called = 0;
  const transform = (buf, meta) => {
    called += 1;
    return { buffer: buf, contentType: meta?.contentType || 'image/svg+xml' };
  };
  const theme = themeWithAssetVar(`url('${LOCAL_ASSET}')`);
  await loadExportCssBundle(repoRoot, theme, null, { transform });
  assert.equal(called, 1, 'the image-bytes transform must see the theme asset');
});

test('a var with no url() is left byte-identical', async () => {
  const plain = themeVarsCssText(themeWithAssetVar('#13393a'));
  const bundle = await loadExportCssBundle(
    repoRoot,
    themeWithAssetVar('#13393a'),
    null,
  );
  assert.equal(
    bundle.themeVarsCss,
    plain,
    'the pass must be a no-op on CSS holding no url() at all',
  );
});

test('a local asset that cannot be read keeps its original url()', async () => {
  // Unresolvable beats silently rewritten: the export then shows the same
  // missing asset the deck already had, instead of an empty background. Note
  // the asymmetry with the remote case above, which blanks — a local miss
  // cannot cause a fetch, so there is nothing to defend against.
  const missing = '/assets/images/definitely-not-here-9f3a.svg';
  const theme = themeWithAssetVar(`url('${missing}')`);
  const bundle = await loadExportCssBundle(repoRoot, theme, null);
  assert.match(bundle.themeVarsCss, new RegExp(missing));
});
