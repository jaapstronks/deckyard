/**
 * The fork seam's images reach an export only when the export can draw them.
 *
 * Since B554 every local `url()` in `custom/styles/*.css` is inlined as a data
 * URL, because an export document has no origin to resolve a root-relative
 * path against. Done for the whole seam, that put every image any fork type
 * references into every export, used or not: ~835 KB of artwork per export in
 * the CIIIC fork, per page on the PNG path (B557). The line is now the slide
 * type's root class: a rule that can only match a type the export does not
 * render keeps its `url()` as written; everything else is inlined as before.
 *
 * The seam lives in a core-only fixture root, so a fork running this suite
 * with its own `custom/` measures this file, not the fork.
 *
 * Run with: node --test tests/export-seam-images-on-use.test.js
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

import sharp from 'sharp';

import { loadExportCssBundle } from '../server/export/css-bundle.js';
import { embedSeamCssUrls } from '../server/export/seam-css.js';
import { buildSlidesPdfHtml } from '../server/export/pdf-slides.js';
import { closePuppeteerBrowser } from '../server/utils/puppeteer-browser.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import { createCoreFixtureRoot } from './helpers/core-fixture-root.js';

const { root, remove } = createCoreFixtureRoot('deckyard-seam-on-use-');
after(async () => {
  // The PDF builder measures its layout in Chrome to size the images.
  await closePuppeteerBrowser();
  await remove();
});

mkdirSync(path.join(root, 'custom', 'styles'), { recursive: true });
mkdirSync(path.join(root, 'custom', 'assets'), { recursive: true });
writeFileSync(
  path.join(root, 'custom', 'assets', 'ground.png'),
  await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#0c8822' },
  })
    .png()
    .toBuffer(),
);
// The fork's one type-scoped background, on a core type the title deck does
// not use. The seam is read once per root, so every test shares this file.
writeFileSync(
  path.join(root, 'custom', 'styles', '10-callout.css'),
  `.slide-callout .slide-inner { background: url('/custom/assets/ground.png'); }`,
  'utf8',
);

const GROUND = "url('/custom/assets/ground.png')";
const TITLE = { id: 's1', type: 'title-slide', content: { title: 'Seam' } };
const CALLOUT = { id: 's2', type: 'callout-slide', content: {} };

/** Run the seam pass over `css` for a deck of `slides`. */
const seam = (css, slides) =>
  embedSeamCssUrls(root, css, { slides, slideTypes: SLIDE_TYPES });

test('a PDF export of a deck without the type does not embed its image', async () => {
  const html = await buildSlidesPdfHtml(root, {
    title: 'No callout',
    theme: 'default',
    slides: [TITLE],
  });
  assert.doesNotMatch(
    html,
    /data:image\/png;base64,/,
    'the callout artwork must not ride along in a deck without a callout',
  );
  assert.ok(html.includes(GROUND), 'the unused rule keeps its url() verbatim');
});

test('a PDF export of a deck with the type embeds its image', async () => {
  const html = await buildSlidesPdfHtml(root, {
    title: 'Callout',
    theme: 'default',
    slides: [TITLE, CALLOUT],
  });
  assert.match(html, /url\('data:image\/png;base64,/);
  assert.ok(!html.includes(GROUND), 'the used rule is inlined');
});

test('what is not scoped to an unused type is inlined as before', async () => {
  const css = [
    `@font-face { font-family: F; src: url('/custom/assets/ground.png'); }`,
    `.slide::after { background: ${GROUND}; }`,
    // One selector in the list may still match: the rule stays live.
    `.slide-callout .x, .deck .y { background: ${GROUND}; }`,
    // A class inside a functional pseudo-class is not a requirement.
    `.slide:not(.slide-callout) .x { background: ${GROUND}; }`,
  ].join('\n');
  const out = await seam(css, [TITLE]);
  assert.ok(!out.includes(GROUND), out);
  assert.equal(out.match(/data:image\/png;base64,/g).length, 4);
});

test('a type-scoped rule is withheld inside a group at-rule too', async () => {
  const css = `@media print { .slide-callout::before { background: ${GROUND}; } }
.slide-title { color: red; }`;
  assert.equal(await seam(css, [TITLE]), css);
  assert.doesNotMatch(await seam(css, [TITLE]), /data:/);
  assert.match(await seam(css, [CALLOUT]), /data:image\/png;base64,/);
});

test('a slide type resolves through any accepted spelling', async () => {
  const css = `.slide-callout .x { background: ${GROUND}; }`;
  const out = await seam(css, [{ ...CALLOUT, type: 'core/callout-slide' }]);
  assert.match(out, /data:image\/png;base64,/);
});

test('the bundle refuses a call without the slides it renders', async () => {
  await assert.rejects(
    () => loadExportCssBundle(root, null, null),
    /opts\.slides must be an array/,
  );
});
