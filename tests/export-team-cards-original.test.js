/**
 * Image blocks with `imageAspect: original` export as they look in the editor.
 *
 * The editor packs uncropped images into full-width rows with a JS pass,
 * `client/lib/slide-runtime/team-cards-justify.js`. The server renders (PNG,
 * and through it PPTX; the PDF slides document) did not carry that pass, so
 * what they showed was the CSS shared-height fallback — and four landscape
 * screenshots at that height wrap to a 2×2 grid that fills the slide and
 * covers the title. Reported from a CIIIC deck (briefing 2026-09-16).
 *
 * The rule pinned here: every document the script chain assembles carries the
 * justify runtime when a slide needs it, and the headless renders wait for it
 * before they capture.
 *
 * Run with: node --test tests/export-team-cards-original.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { initSanitizer } from '../shared/sanitize.js';
import {
  resolveChromeExecutablePath,
  closePuppeteerBrowser,
  getPuppeteerBrowser,
} from '../server/utils/puppeteer-browser.js';
import { renderSlideToPngBuffer } from '../server/render/png.js';
import { buildSlidesPdfHtml } from '../server/export/pdf-slides.js';
import { settleRenderedPage } from '../server/utils/settle-rendered-page.js';
import {
  buildScriptChain,
  detectSlideRuntimeNeeds,
} from '../server/utils/script-chain.js';
import { renderSlideHtml } from '../server/utils/render-slide.js';

await initSanitizer();
after(closePuppeteerBrowser);

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const skip = !isCi && !chromePath ? 'no Chrome/Chromium found' : false;

/** A pure-red 3:2 landscape image (the reported deck's photos are 3:2), so
 * the PNG can be read back by colour. */
const landscape = async () => {
  const buf = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
};

const slide = async () => {
  const image = await landscape();
  return {
    id: 'tc-original',
    type: 'team-cards-slide',
    content: {
      title: 'Aansluiting bij activiteiten CIIIC Programma',
      background: 'mist',
      textPosition: 'split',
      imageShape: 'rounded',
      imageAspect: 'original',
      showPhotoFrame: 'off',
      columnSplit: '',
      members: [1, 2, 3, 4].map((n) => ({
        image,
        alt: `Beeld ${n}`,
        name: `Titel ${n}`,
        byline: `Onderschrift ${n}`,
      })),
    },
  };
};

/**
 * The vertical bands (in px) that contain pure-red pixels. One row of images
 * is one band; the 2×2 fallback is two.
 */
async function redBands(png) {
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bands = [];
  let inBand = false;
  for (let y = 0; y < info.height; y += 1) {
    let red = 0;
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      if (data[i] > 240 && data[i + 1] < 15 && data[i + 2] < 15) red += 1;
    }
    const has = red > 20;
    if (has && !inBand) bands.push([y, y]);
    if (has) bands.at(-1)[1] = y;
    inBand = has;
  }
  return bands;
}

test('PNG: four landscape images on one row', { skip }, async () => {
  const png = await renderSlideToPngBuffer(repoRoot, await slide(), {
    scale: 1,
  });
  const bands = await redBands(png);
  assert.equal(
    bands.length,
    1,
    `expected one row of images, got ${bands.length}: ${JSON.stringify(bands)}`,
  );
});

test(
  'PDF slides document: four landscape images on one row',
  { skip },
  async () => {
    const html = await buildSlidesPdfHtml(repoRoot, {
      id: 'deck',
      title: 'Deck',
      slides: [await slide()],
    });
    const browser = await getPuppeteerBrowser({ featureName: 'test' });
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1600, height: 900 });
      await page.setContent(html, { waitUntil: 'load' });
      await settleRenderedPage(page);
      const tops = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll('.slide-team-cards .team-card-photo'),
        ).map((el) => Math.round(el.getBoundingClientRect().top)),
      );
      assert.equal(tops.length, 4);
      assert.equal(
        new Set(tops).size,
        1,
        `expected one row, got photo tops ${JSON.stringify(tops)}`,
      );
    } finally {
      await page.close();
    }
  },
);

test('the runtime ships only for the layout it acts on, in any document', async () => {
  const original = renderSlideHtml(await slide(), { stripEditorAttrs: true });
  assert.equal(detectSlideRuntimeNeeds(original).teamCards, true);

  const square = await slide();
  square.content.imageAspect = 'square';
  assert.equal(
    detectSlideRuntimeNeeds(renderSlideHtml(square, { stripEditorAttrs: true }))
      .teamCards,
    false,
    'a cropped grid has nothing to justify',
  );

  const split = await slide();
  split.content.columnSplit = '2';
  assert.equal(
    detectSlideRuntimeNeeds(renderSlideHtml(split, { stripEditorAttrs: true }))
      .teamCards,
    false,
    'the column split keeps its own subgrid layout',
  );

  // Layout, not behaviour: a static sheet gets it too.
  const sheet = buildScriptChain({
    needs: { prism: false, katex: false },
    slideNeeds: { teamCards: true },
  });
  assert.match(sheet, /initTeamCardsJustify\(document\.body\)/);
  assert.doesNotThrow(
    () =>
      new vm.Script(
        sheet.slice(sheet.indexOf('>') + 1, sheet.lastIndexOf('</')),
      ),
    'the inlined module has to parse as a classic script',
  );
});
