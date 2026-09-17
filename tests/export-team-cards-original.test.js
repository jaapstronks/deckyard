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
import { readFileSync } from 'node:fs';
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

/** A pure-red landscape image, so the PNG can be read back by colour. The
 * reported deck's photos are 3:2; 16:9 is the other ratio a screenshot deck is
 * full of, and it packs to a different row height. */
const landscape = async ([w, h]) => {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
};

const RATIOS = { '3:2': [1200, 800], '16:9': [1600, 900] };

const slide = async (ratio = RATIOS['3:2']) => {
  const image = await landscape(ratio);
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
 * is one band. Short captions can fit a full row plus a partial row; those
 * images stay larger than they would if all four were forced onto one row.
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

for (const [name, ratio] of Object.entries(RATIOS)) {
  const expectedRows = name === '16:9' ? 2 : 1;
  test(
    `PNG: four ${name} images use the largest fitting packing`,
    { skip },
    async () => {
      const png = await renderSlideToPngBuffer(repoRoot, await slide(ratio), {
        scale: 1,
      });
      const bands = await redBands(png);
      assert.equal(
        bands.length,
        expectedRows,
        `expected ${expectedRows} image rows, got ${bands.length}: ${JSON.stringify(bands)}`,
      );
      assert.ok(bands.at(-1)[1] < 900, 'all image bands end inside the slide');
    },
  );

  test(
    `PDF slides document: four ${name} images fit at the largest ceiling`,
    { skip },
    async () => {
      const html = await buildSlidesPdfHtml(repoRoot, {
        id: 'deck',
        title: 'Deck',
        slides: [await slide(ratio)],
      });
      const browser = await getPuppeteerBrowser({ featureName: 'test' });
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1600, height: 900 });
        await page.setContent(html, { waitUntil: 'load' });
        await settleRenderedPage(page);
        const m = await page.evaluate(() => {
          const photos = Array.from(
            document.querySelectorAll('.slide-team-cards .team-card-photo'),
          );
          const grid = document.querySelector(
            '.slide-team-cards .team-cards-grid',
          );
          const inner = grid.parentElement;
          const header = inner.querySelector(':scope > .header');
          const cards = Array.from(
            grid.querySelectorAll(':scope > .team-card'),
          );
          return {
            cardTop: Math.min(
              ...cards.map((el) => el.getBoundingClientRect().top),
            ),
            cardBottom: Math.max(
              ...cards.map((el) => el.getBoundingClientRect().bottom),
            ),
            innerBottom: inner.getBoundingClientRect().bottom,
            headerBottom: header.getBoundingClientRect().bottom,
            alignContent: grid.style.alignContent,
            tops: photos.map((el) =>
              Math.round(el.getBoundingClientRect().top),
            ),
            heights: photos.map((el) =>
              Math.round(el.getBoundingClientRect().height),
            ),
            ceiling: parseFloat(getComputedStyle(photos[0]).maxHeight),
            gridWidth: grid.clientWidth,
            gap: parseFloat(getComputedStyle(grid).columnGap) || 0,
          };
        });
        assert.equal(m.tops.length, 4);
        assert.equal(
          new Set(m.tops).size,
          expectedRows,
          `expected ${expectedRows} rows, got photo tops ${JSON.stringify(m.tops)}`,
        );
        assert.ok(m.cardTop >= m.headerBottom, 'cards clear the heading');
        assert.ok(
          m.cardBottom <= m.innerBottom + 1,
          `cards end at ${m.cardBottom}, content ends at ${m.innerBottom}`,
        );
        assert.equal(m.alignContent, '', 'the fitting packing stays centred');
        // The export pins the same two bounds the editor packs against: the
        // row is justified to the full width, and stays under the ceiling the
        // stylesheet declares.
        const firstRowSize = expectedRows === 2 ? 3 : 4;
        const expected =
          (m.gridWidth - 1 - m.gap * (firstRowSize - 1)) /
          (firstRowSize * (ratio[0] / ratio[1]));
        for (const h of m.heights.slice(0, firstRowSize)) {
          assert.ok(
            Math.abs(h - expected) <= 1,
            `photo height ${h} should be the justified ${expected.toFixed(2)}`,
          );
        }
        for (const h of m.heights) {
          assert.ok(h > 0, 'every image stays visible');
          assert.ok(
            h <= Math.round(m.ceiling),
            `photo height ${h} exceeds the declared ceiling ${m.ceiling}`,
          );
        }
        if (expectedRows === 2) {
          assert.deepEqual(m.tops.slice(0, 3), Array(3).fill(m.tops[0]));
          assert.ok(
            m.tops[3] > m.tops[0],
            'the final image has its own partial row',
          );
          assert.ok(
            m.heights[3] >= expected - 1,
            'the partial row keeps a larger image than a single row of four',
          );
          assert.ok(
            m.heights[3] < m.ceiling,
            'the partial row shrinks within its unchanged row partition',
          );
        }
      } finally {
        await page.close();
      }
    },
  );
}

test('every render surface runs the pass, thumbnails included', async () => {
  const src = readFileSync(
    path.join(repoRoot, 'client/lib/slide-runtime/slide-render.js'),
    'utf8',
  );
  const call = src.match(/^.*initTeamCardsJustify\(el\).*$/m)?.[0];
  assert.ok(call, 'slide-render should mount the justify pass');
  assert.doesNotMatch(
    call,
    /\bmode\b/,
    `the pass is layout, not behaviour: a thumbnail that skips it shows a different packing than the slide it stands for (got: ${call.trim()})`,
  );
});

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
