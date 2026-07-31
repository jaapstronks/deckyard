/**
 * Gradient slide backgrounds are a bitmap in the PDF export, not a live
 * gradient.
 *
 * The defect: a themed slide background built from `radial-gradient`s with
 * alpha stops leaves Chrome as a page-sized tiling pattern behind a luminosity
 * SMask, both halves a ShadingType 1 shading driven by a FunctionType 4
 * PostScript program that the reader runs *per pixel*. Measured here on a
 * three-page deck on the `deckyard` theme's `calm` background: 3.3 s per page
 * under Ghostscript at 110 dpi, against 0.06 s for the same deck without one.
 * After rasterizing: 0.14 s, with the rendered page differing by at most 4/255.
 *
 * Two things are pinned below, because both can silently rot:
 *
 *   1. the export HTML must not still carry a `radial-gradient(` in a slide
 *      background — that is the whole point, and a regression would be
 *      invisible except as a slow PDF;
 *   2. the dedupe must key on the *resolved* value. One bitmap for a deck is
 *      the happy case, but a theme whose background reads per-slide custom
 *      properties must get one bitmap per distinct position — sharing one would
 *      put every blob in the wrong place on all but one slide.
 *
 * Run with: node --test tests/export-gradient-raster.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveChromeExecutablePath,
  closePuppeteerBrowser,
} from '../server/utils/puppeteer-browser.js';
import { buildSlidesPdfHtml } from '../server/export/pdf-slides.js';
import { loadTheme } from '../server/utils/themes.js';
import {
  findGradientBgVars,
  rasterizeGradientBackgrounds,
  resolveCssVars,
  slideBgVariant,
  slideRootVars,
} from '../server/export/gradient-raster.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());

/** Same gate as the export smoke test: skip locally without a browser, never in CI. */
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

/**
 * Every `--t-slide-bg-*` declaration in the document, value included.
 *
 * The value alternation is not decoration: a PNG data URL contains a `;`
 * (`data:image/png;base64,…`), so a naive `[^;}]+` truncates the very value
 * this file is here to assert on.
 */
function slideBgDeclarations(html) {
  return [
    ...String(html).matchAll(/--t-slide-bg-[a-z0-9-]+\s*:\s*((?:url\("[^"]*"\)|[^;}])+)/g),
  ].map((m) => m[1].trim());
}

function calmDeck(n) {
  return {
    title: 'Gradient background',
    theme: 'deckyard',
    slides: Array.from({ length: n }, (_, i) => ({
      id: `slide-${i}`,
      type: 'content-slide',
      content: { title: `Onderwerp ${i}`, body: 'Tekst op de achtergrond.', background: 'calm' },
    })),
  };
}

test('a gradient slide background leaves the PDF export as a bitmap', { skip }, async () => {
  const theme = await loadTheme(repoRoot, 'deckyard');
  const html = await buildSlidesPdfHtml(repoRoot, calmDeck(3), { theme });

  const decls = slideBgDeclarations(html);
  assert.ok(decls.length > 0, 'the theme must declare slide backgrounds at all');
  assert.deepEqual(
    decls.filter((v) => /radial-gradient\(/i.test(v)),
    [],
    'no slide background may still reach the PDF as a live gradient',
  );
  assert.match(
    html,
    /\.pdf-stage\.grad-bg-\d+ \.slide\.slide-bg-calm \{\s*background-image: url\("data:image\/(png|jpeg);base64,/,
    'the bitmap must arrive as a background-image override',
  );
});

test('the bitmap never lands in the --t-slide-bg-* token itself', { skip }, async () => {
  // `--t-slide-bg-<id>` feeds `--slide-bg`, which client/styles also reads as a
  // `background-color` (00-base.css) and as a `color`
  // (30-content-and-tables.css). A `url()` in there is invalid at
  // computed-value time, and an image-text slide then prints white on white.
  const theme = await loadTheme(repoRoot, 'deckyard');
  const html = await buildSlidesPdfHtml(repoRoot, calmDeck(3), { theme });

  for (const value of slideBgDeclarations(html)) {
    assert.ok(
      !/url\(/i.test(value),
      `--t-slide-bg-* must stay a colour, got: ${value.slice(0, 60)}`,
    );
  }
  assert.ok(
    slideBgDeclarations(html).includes('#140a26'),
    "the token must fall back to the stack's own base colour",
  );
});

test('one background shared by many slides is rasterized once', { skip }, async () => {
  const theme = await loadTheme(repoRoot, 'deckyard');
  const html = await buildSlidesPdfHtml(repoRoot, calmDeck(6), { theme });

  const dataUrls = new Set(
    [...html.matchAll(/url\("(data:image\/(?:png|jpeg);base64,[^"]+)"\)/g)].map((m) => m[1]),
  );
  assert.equal(dataUrls.size, 1, 'six slides on one background must share one bitmap');
  assert.equal(
    [...html.matchAll(/\bgrad-bg-\d+\b/g)].filter((m) => m[0] !== 'grad-bg-0').length,
    0,
    'and they must all point at the same rule',
  );
});

test(
  'two slides whose background resolves differently do not share a bitmap',
  { skip },
  async () => {
    // A theme background that reads the per-slide gradient vars — the shape
    // `gradientVarsForSlide()` produces. If the dedupe keyed on the *declared*
    // value instead of the resolved one, both slides would get one bitmap and
    // one of them would have its blob in the wrong place.
    const themeVarsCss = `.ps-theme {
  --t-slide-bg-calm: radial-gradient(circle at var(--g1x) var(--g1y), rgba(219,255,0,0.9) 0%, rgba(219,255,0,0) 70%), #06090b;
}`;
    const slide = (g1x, g1y) =>
      `<div class="slide slide-content slide-bg-calm" style="--g1x:${g1x};--g1y:${g1y}"><div class="slide-inner"></div></div>`;

    const out = await rasterizeGradientBackgrounds({
      themeVarsCss,
      slidesHtml: [slide('18%', '22%'), slide('82%', '74%'), slide('18%', '22%')],
    });

    assert.equal(out.rasterCount, 2, 'two distinct positions, two bitmaps');
    assert.equal(
      out.stageClasses[0],
      out.stageClasses[2],
      'identical vars must still collapse to one bitmap',
    );
    assert.notEqual(
      out.stageClasses[0],
      out.stageClasses[1],
      'different vars must not share a bitmap',
    );

    const dataUrls = [
      ...out.extraCss.matchAll(/url\("(data:image\/(?:png|jpeg);base64,[^"]+)"\)/g),
    ].map((m) => m[1]);
    assert.equal(dataUrls.length, 2);
    assert.notEqual(dataUrls[0], dataUrls[1], 'and the two bitmaps must differ');
  },
);

test('a background that cannot be resolved keeps its live gradient', { skip }, async () => {
  // No `--g1x` anywhere and no fallback in the `var()`: rasterizing would guess
  // at the position, so the slow-but-correct gradient stays.
  const themeVarsCss = `.ps-theme {
  --t-slide-bg-calm: radial-gradient(circle at var(--g1x) 20%, rgba(219,255,0,0.9) 0%, rgba(219,255,0,0) 70%), #06090b;
}`;
  const out = await rasterizeGradientBackgrounds({
    themeVarsCss,
    slidesHtml: ['<div class="slide slide-content slide-bg-calm"></div>'],
  });

  assert.equal(out.rasterCount, 0);
  assert.equal(out.extraCss, '');
  assert.match(out.themeVarsCss, /radial-gradient\(/);
  assert.deepEqual(out.stageClasses, ['']);
});

test('only slide-background vars are candidates', () => {
  const css = `.ps-theme {
  --t-slide-bg-calm: radial-gradient(circle at 50% 50%, rgba(1,2,3,0.5) 0%, rgba(1,2,3,0) 70%), #06090b;
  --t-slide-bg-calm-text: #ffffff;
  --t-slide-bg-lime: #e2fe52;
  --t-slide-gradient-bg: radial-gradient(circle at var(--g1x) var(--g1y), rgba(1,2,3,1) 0%, rgba(1,2,3,0) 70%);
}`;
  const found = findGradientBgVars(css);
  assert.deepEqual([...found.keys()], ['--t-slide-bg-calm']);
  // The animated overlay layer is already disabled in every export path
  // (`--t-gradient-enabled: 0`), so rasterizing it would add a gradient the
  // export does not currently have.
  assert.equal(found.has('--t-slide-gradient-bg'), false);
});

test('var resolution refuses to guess', () => {
  assert.equal(resolveCssVars('circle at var(--g1x) 10%', { '--g1x': '62%' }), 'circle at 62% 10%');
  assert.equal(resolveCssVars('circle at var(--g1x, 50%) 10%', {}), 'circle at 50% 10%');
  assert.equal(resolveCssVars('circle at var(--g1x) 10%', {}), null);
  assert.equal(resolveCssVars('circle at 50% 10%', {}), 'circle at 50% 10%');
});

test('the slide root is read for its variant and its own custom properties', () => {
  const html =
    '<div class="slide slide-content slide-bg-calm" style="--g1x:62%;--quote-scale:1">' +
    '<span style="--icg-icon-url:url(x.svg)"></span></div>';
  assert.equal(slideBgVariant(html), 'calm');
  assert.deepEqual(slideRootVars(html), { '--g1x': '62%', '--quote-scale': '1' });
  assert.equal(slideBgVariant('<div class="slide slide-content"></div>'), null);
});

after(async () => {
  await closePuppeteerBrowser();
});
