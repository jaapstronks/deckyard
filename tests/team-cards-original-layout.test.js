/**
 * Image blocks (`imageAspect: original`, non-split): the two bounds that decide
 * the packing, and the row alignment that follows from them (B328 + B301, D167).
 *
 * The rules pinned here:
 *
 *  1. The row ceiling is the **declared CSS ceiling** — the resolved
 *     `max-height` of the photo box. No photo is ever taller than it. The old
 *     runtime read an unregistered custom property, got `NaN`, and fell back to
 *     a constant 300, so 300 was the real ceiling and the stylesheet's number
 *     was decoration.
 *  2. All rows together fit the **available content height** under the heading.
 *     The pass picks the largest ceiling that fits by re-packing the cards, so
 *     four 3:2 images land on one row because the space says so — not because a
 *     magic number happened to allow it.
 *  3. In `textPosition: split` every title in a row starts on one line, and so
 *     does every image under it. A longer byline hangs below its own card.
 *  4. When no positive image height lets the whole thing fit, the packing runs
 *     off the **bottom** edge and the heading stays clear.
 *
 * Measured in the PDF-slides document because that is a real browser rendering
 * the same slide the editor shows, with the justify runtime inlined by the
 * script chain. The fixture builds its own images, so nothing depends on the
 * external URLs from the CIIIC deck that reported this.
 *
 * Run with: node --test tests/team-cards-original-layout.test.js
 */

import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { initSanitizer } from '../shared/sanitize.js';
import {
  resolveChromeExecutablePath,
  closePuppeteerBrowser,
  getPuppeteerBrowser,
} from '../server/utils/puppeteer-browser.js';
import { buildSlidesPdfHtml } from '../server/export/pdf-slides.js';
import { settleRenderedPage } from '../server/utils/settle-rendered-page.js';

await initSanitizer();
after(closePuppeteerBrowser);

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const skip = !isCi && !chromePath ? 'no Chrome/Chromium found' : false;

/** A solid image of a given size, so every fixture ratio is local and exact. */
const image = async ([w, h], colour) => {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: colour },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
};

const COLOURS = ['#ff0000', '#00aa00', '#0000ff', '#ff00ff', '#00cccc'];

const TWO_LINE_BYLINE = 'Onderschrift met net genoeg woorden voor twee regels';
const FOUR_LINE_BYLINE =
  'Onderschrift met flink wat meer woorden, genoeg om over vier regels te lopen naast een kaart die niet de breedste van de rij is';
const VERY_LONG_BYLINE = 'Onderschrift met heel veel woorden '.repeat(14);

/**
 * The fixture the brief asks for: images of differing ratios, titles of one and
 * two lines, bylines of two and four lines.
 * @param {[number, number][]} ratios
 * @param {{byline?: (i: number) => string, title?: (i: number) => string}} [opts]
 */
const slide = async (ratios, opts = {}) => ({
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
    members: await Promise.all(
      ratios.map(async (ratio, i) => ({
        image: await image(ratio, COLOURS[i % COLOURS.length]),
        alt: `Beeld ${i + 1}`,
        name: opts.title
          ? opts.title(i)
          : i % 2
            ? `Een titel die over twee regels loopt ${i + 1}`
            : `Titel ${i + 1}`,
        byline: opts.byline
          ? opts.byline(i)
          : i % 2
            ? FOUR_LINE_BYLINE
            : TWO_LINE_BYLINE,
      })),
    ),
  },
});

/**
 * Render one slide at 1600×900 and read back what the layout did.
 * @returns {Promise<object>} Rounded layout values, in logical slide pixels.
 */
async function measure(
  content,
  viewport = { width: 1600, height: 900 },
  photoCeiling = null,
) {
  let html = await buildSlidesPdfHtml(repoRoot, {
    id: 'deck',
    title: 'Deck',
    slides: [content],
  });
  if (photoCeiling !== null) {
    html = html.replace(
      '</head>',
      `<style>.slide-team-cards .team-card-photo { max-height: ${photoCeiling}px !important; }</style></head>`,
    );
  }
  const browser = await getPuppeteerBrowser({ featureName: 'test' });
  const page = await browser.newPage();
  try {
    await page.setViewport(viewport);
    await page.setContent(html, { waitUntil: 'load' });
    await settleRenderedPage(page);
    return await page.evaluate(() => {
      const slideEl = document.querySelector('.slide-team-cards');
      const inner = slideEl.querySelector(':scope > .slide-inner');
      const grid = inner.querySelector(':scope > .team-cards-grid');
      const header = inner.querySelector(':scope > .header');
      const cards = Array.from(grid.querySelectorAll(':scope > .team-card'));
      const top = (el) => Math.round(el.getBoundingClientRect().top);
      const bottom = (el) => Math.round(el.getBoundingClientRect().bottom);
      const photo = (c) => c.querySelector('.team-card-photo');
      const gridStyles = getComputedStyle(grid);
      // The available height, computed the way the runtime computes it: the
      // inner box minus the heading and the flex gap. Not the grid's own box.
      const innerGap = parseFloat(getComputedStyle(inner).rowGap) || 0;
      let taken = 0;
      let siblings = 0;
      for (const child of inner.children) {
        if (child === grid) continue;
        taken += child.offsetHeight;
        siblings += 1;
      }
      return {
        availableHeight: inner.clientHeight - taken - innerGap * siblings,
        gridWidth: grid.clientWidth,
        gridTop: top(grid),
        columnGap: parseFloat(gridStyles.columnGap) || 0,
        rowGap: parseFloat(gridStyles.rowGap) || 0,
        alignContent: grid.style.alignContent || '',
        headerBottom: header ? bottom(header) : null,
        innerBottom: bottom(inner),
        ceiling: parseFloat(getComputedStyle(photo(cards[0])).maxHeight),
        photoTops: cards.map((c) => top(photo(c))),
        photoHeights: cards.map((c) =>
          Math.round(photo(c).getBoundingClientRect().height),
        ),
        photoWidths: cards.map((c) =>
          Math.round(photo(c).getBoundingClientRect().width),
        ),
        titleTops: cards.map((c) => top(c.querySelector('.team-card-name'))),
        cardTops: cards.map(top),
        cardBottoms: cards.map(bottom),
      };
    });
  } finally {
    await page.close();
  }
}

/** Card indexes grouped by the row they ended up on (their photo's top edge). */
const rowsOf = (m) => {
  const byTop = new Map();
  m.photoTops.forEach((t, i) => {
    if (!byTop.has(t)) byTop.set(t, []);
    byTop.get(t).push(i);
  });
  return Array.from(byTop.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, idx]) => idx);
};

/** The height a row of these ratios gets when justified to the full width. */
const justified = (m, ratios) =>
  (m.gridWidth - 1 - m.columnGap * (ratios.length - 1)) /
  ratios.reduce((sum, [w, h]) => sum + w / h, 0);

const RATIO_3_2 = [1200, 800];
const RATIO_16_9 = [1600, 900];
const PORTRAIT = [900, 1400];
const SQUARE = [1000, 1000];

describe('image blocks, original aspect: the packing obeys both bounds', () => {
  test('a single portrait shrinks to fit even when its row never changes', async (t) => {
    if (skip) return t.skip(skip);
    const s = await slide([PORTRAIT], {
      title: () => 'Research and development',
      byline: () => 'Caption words '.repeat(6),
    });
    s.content.title =
      'An introduction to our international team and their work on research and development';
    s.content.subheading =
      'Our team works across disciplines to develop new ideas and practical solutions. Meet the people who turn these ideas into results.';
    const m = await measure(s);
    assert.deepEqual(rowsOf(m), [[0]]);
    assert.ok(m.photoHeights[0] > 0, 'fitting keeps the portrait visible');
    assert.ok(
      m.photoHeights[0] < m.ceiling,
      'the full-height portrait cannot fit under this heading',
    );
    assert.ok(
      m.cardBottoms[0] <= m.innerBottom + 1,
      `card ends at ${m.cardBottoms[0]}, content ends at ${m.innerBottom}`,
    );
    assert.ok(m.cardTops[0] >= m.headerBottom, 'the heading stays clear');
    assert.equal(m.alignContent, '', 'a fitting portrait stays centred');

    // Shrinking is not monotone: this narrower portrait forces extra caption
    // lines. A search that discards all larger heights after a small failure
    // misses the fitting interval above it.
    const fitting = await measure(s, undefined, 275);
    const narrower = await measure(s, undefined, 250);
    assert.ok(fitting.cardBottoms[0] <= fitting.innerBottom + 1);
    assert.ok(
      narrower.cardBottoms[0] > narrower.innerBottom + 1,
      'the smaller image has enough extra text lines to overflow again',
    );
  });

  test('four 3:2 images share one row at the justified height', async (t) => {
    if (skip) return t.skip(skip);
    const m = await measure(
      await slide([RATIO_3_2, RATIO_3_2, RATIO_3_2, RATIO_3_2]),
    );
    const rows = rowsOf(m);
    assert.deepEqual(
      rows,
      [[0, 1, 2, 3]],
      `expected one row of four, got ${JSON.stringify(rows)}`,
    );
    // The height the space forces, not the declared ceiling: at the ceiling the
    // greedy packer would close a row after three images and the second row
    // would push the whole thing past the slide.
    const expected = justified(m, [RATIO_3_2, RATIO_3_2, RATIO_3_2, RATIO_3_2]);
    assert.ok(
      expected < m.ceiling,
      `the case only bites while the justified height (${expected.toFixed(1)}) is under the declared ceiling (${m.ceiling})`,
    );
    for (const h of m.photoHeights) {
      assert.ok(
        Math.abs(h - expected) <= 1,
        `photo height ${h} should be the justified ${expected.toFixed(2)}`,
      );
    }
  });

  test('four 16:9 images share one row at the justified height', async (t) => {
    if (skip) return t.skip(skip);
    const ratios = [RATIO_16_9, RATIO_16_9, RATIO_16_9, RATIO_16_9];
    const m = await measure(await slide(ratios));
    assert.deepEqual(rowsOf(m), [[0, 1, 2, 3]]);
    const expected = justified(m, ratios);
    for (const h of m.photoHeights) {
      assert.ok(
        Math.abs(h - expected) <= 1,
        `photo height ${h} should be the justified ${expected.toFixed(2)}`,
      );
    }
  });

  test('mixed ratios keep their shape and share one image height', async (t) => {
    if (skip) return t.skip(skip);
    const ratios = [RATIO_3_2, PORTRAIT, RATIO_16_9, SQUARE];
    const m = await measure(await slide(ratios));
    assert.deepEqual(rowsOf(m), [[0, 1, 2, 3]]);
    assert.equal(
      new Set(m.photoHeights).size,
      1,
      `one row is one image height, got ${JSON.stringify(m.photoHeights)}`,
    );
    ratios.forEach(([w, h], i) => {
      const expected = m.photoHeights[i] * (w / h);
      assert.ok(
        Math.abs(m.photoWidths[i] - expected) <= 2,
        `image ${i} should keep its ${w}:${h} ratio (got ${m.photoWidths[i]}×${m.photoHeights[i]})`,
      );
    });
  });

  test('no photo is ever taller than the declared CSS ceiling', async (t) => {
    if (skip) return t.skip(skip);
    // Two wide images would justify far above the ceiling; the ceiling holds.
    const m = await measure(await slide([RATIO_3_2, RATIO_3_2]));
    assert.ok(
      justified(m, [RATIO_3_2, RATIO_3_2]) > m.ceiling,
      'the case only bites while the justified height is over the ceiling',
    );
    for (const h of m.photoHeights) {
      assert.ok(
        h <= Math.round(m.ceiling),
        `photo height ${h} exceeds the declared ceiling ${m.ceiling}`,
      );
    }
    // The ceiling is the stylesheet's own number, not the old constant 300.
    assert.ok(
      m.ceiling > 300,
      `the declared ceiling should be read from CSS (got ${m.ceiling}); 300 was the hidden fallback`,
    );
  });

  test('six images fall into two rows and still clear the heading', async (t) => {
    if (skip) return t.skip(skip);
    const m = await measure(await slide(Array(6).fill(RATIO_3_2)));
    const rows = rowsOf(m);
    assert.equal(rows.length, 2, `expected two rows, got ${rows.length}`);
    assert.ok(
      Math.min(...m.cardTops) >= m.headerBottom,
      `cards start at ${Math.min(...m.cardTops)}, heading ends at ${m.headerBottom}`,
    );
    assert.ok(
      Math.max(...m.cardBottoms) <= m.gridTop + m.availableHeight + 1,
      `last card ends at ${Math.max(...m.cardBottoms)}, content ends at ${m.gridTop + m.availableHeight}`,
    );
  });

  test('the packed rows fit the real content height, not a stretched grid', async (t) => {
    if (skip) return t.skip(skip);
    for (const ratios of [
      [RATIO_3_2, RATIO_3_2, RATIO_3_2, RATIO_3_2],
      [RATIO_16_9, RATIO_16_9, RATIO_16_9, RATIO_16_9],
      [RATIO_3_2, PORTRAIT, RATIO_16_9, SQUARE],
    ]) {
      const m = await measure(await slide(ratios));
      assert.equal(m.alignContent, '', 'a packing that fits stays centred');
      assert.ok(
        Math.min(...m.cardTops) >= m.headerBottom,
        `cards overlap the heading: top ${Math.min(...m.cardTops)} vs heading bottom ${m.headerBottom}`,
      );
      assert.ok(
        Math.max(...m.cardBottoms) <= m.gridTop + m.availableHeight + 1,
        `cards run past the content area: bottom ${Math.max(...m.cardBottoms)} vs ${m.gridTop + m.availableHeight}`,
      );
    }
  });
});

describe('image blocks, original aspect: split titles line up per row', () => {
  test('titles and images in a row start at one height', async (t) => {
    if (skip) return t.skip(skip);
    const m = await measure(
      await slide([RATIO_3_2, PORTRAIT, RATIO_16_9, SQUARE]),
    );
    // Stated first, because `rowsOf` reads the rows off the image tops: without
    // this the loop below would call four misaligned cards four rows of one and
    // pass on nothing.
    assert.deepEqual(
      rowsOf(m),
      [[0, 1, 2, 3]],
      'the four cards are one row, so the checks below have something to level',
    );
    for (const row of rowsOf(m)) {
      const titles = row.map((i) => m.titleTops[i]);
      assert.equal(
        new Set(titles).size,
        1,
        `titles in a row start at one height, got ${JSON.stringify(titles)}`,
      );
      const photos = row.map((i) => m.photoTops[i]);
      assert.equal(
        new Set(photos).size,
        1,
        `images in a row start at one height, got ${JSON.stringify(photos)}`,
      );
    }
  });

  test('a longer byline grows its own card, not its neighbours', async (t) => {
    if (skip) return t.skip(skip);
    const m = await measure(
      await slide([RATIO_3_2, RATIO_3_2, RATIO_3_2, RATIO_3_2], {
        byline: (i) => (i === 1 ? FOUR_LINE_BYLINE : TWO_LINE_BYLINE),
      }),
    );
    assert.equal(new Set(m.titleTops).size, 1, 'titles stay level');
    assert.equal(new Set(m.photoTops).size, 1, 'images stay level');
    assert.ok(
      m.cardBottoms[1] > m.cardBottoms[0],
      'the long byline hangs below its own card',
    );
  });

  test('titles level up across two rows independently', async (t) => {
    if (skip) return t.skip(skip);
    const m = await measure(await slide(Array(6).fill(RATIO_3_2)));
    const rows = rowsOf(m);
    assert.equal(rows.length, 2);
    const [first, second] = rows.map(
      (row) => new Set(row.map((i) => m.titleTops[i])),
    );
    assert.equal(first.size, 1, 'row 1 titles level');
    assert.equal(second.size, 1, 'row 2 titles level');
    assert.notEqual(
      [...first][0],
      [...second][0],
      'the two rows are at different heights',
    );
  });
});

describe('image blocks, original aspect: the unavoidable overflow', () => {
  test('a heading that consumes the content budget still aligns cards below it', async (t) => {
    if (skip) return t.skip(skip);
    const html = await buildSlidesPdfHtml(repoRoot, {
      id: 'deck',
      title: 'Deck',
      slides: [await slide([PORTRAIT])],
    });
    const browser = await getPuppeteerBrowser({ featureName: 'test' });
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1600, height: 900 });
      await page.setContent(html, { waitUntil: 'load' });
      await settleRenderedPage(page);
      const result = await page.evaluate(async () => {
        const inner = document.querySelector(
          '.slide-team-cards > .slide-inner',
        );
        const header = inner.querySelector(':scope > .header');
        const grid = inner.querySelector(':scope > .team-cards-grid');
        header.style.height = `${inner.clientHeight}px`;
        header.style.flexShrink = '0';
        for (let i = 0; i < 4; i += 1)
          await new Promise((resolve) => requestAnimationFrame(resolve));
        const card = grid.querySelector('.team-card');
        return {
          budget:
            inner.clientHeight -
            header.getBoundingClientRect().height -
            (parseFloat(getComputedStyle(inner).rowGap) || 0),
          headerBottom: header.getBoundingClientRect().bottom,
          cardTop: card.getBoundingClientRect().top,
          photoHeight: card
            .querySelector('.team-card-photo')
            .getBoundingClientRect().height,
          alignContent: grid.style.alignContent,
        };
      });
      assert.ok(
        result.budget <= 0,
        'the heading leaves no available content height',
      );
      assert.equal(
        result.alignContent,
        'flex-start',
        'zero budget is overflow, not an unmeasurable slide',
      );
      assert.ok(
        result.cardTop >= result.headerBottom,
        'overflow never covers the heading',
      );
      assert.ok(result.photoHeight > 0, 'the overflowing photo stays visible');
    } finally {
      await page.close();
    }
  });

  test('content taller than the slide runs off the bottom, never over the heading', async (t) => {
    if (skip) return t.skip(skip);
    const m = await measure(
      await slide(Array(6).fill(PORTRAIT), {
        byline: () => VERY_LONG_BYLINE,
      }),
    );
    assert.equal(
      m.alignContent,
      'flex-start',
      'an overflowing packing aligns to the top of the content area',
    );
    assert.ok(
      Math.min(...m.cardTops) >= m.headerBottom,
      `cards start at ${Math.min(...m.cardTops)}, heading ends at ${m.headerBottom}`,
    );
    assert.ok(
      Math.max(...m.cardBottoms) > m.gridTop + m.availableHeight,
      'this fixture is only a test while it really does overflow',
    );
    for (const h of m.photoHeights) {
      assert.ok(h > 0, 'the images keep a positive height');
      assert.ok(h <= Math.round(m.ceiling), 'and stay under the ceiling');
    }
  });
});

describe('image blocks, original aspect: the other layouts stay put', () => {
  /** @param {object} patch Content overrides that leave the justify pass idle. */
  const variant = async (patch) => {
    const s = await slide([RATIO_3_2, PORTRAIT, RATIO_16_9, SQUARE]);
    Object.assign(s.content, patch);
    return s;
  };

  test('text-below still packs and levels its images', async (t) => {
    if (skip) return t.skip(skip);
    const m = await measure(await variant({ textPosition: 'below' }));
    assert.equal(new Set(m.photoTops).size, 1, 'images level');
    assert.ok(
      Math.min(...m.cardTops) >= m.headerBottom,
      'no overlap with the heading',
    );
  });

  for (const [shape, label] of [
    ['square', 'square'],
    ['circle', 'circle'],
  ]) {
    test(`the cropped ${label} grid keeps its own sizing`, async (t) => {
      if (skip) return t.skip(skip);
      const m = await measure(
        await variant({ imageAspect: 'square', imageShape: shape }),
      );
      assert.equal(
        new Set(m.photoHeights).size,
        1,
        'cropped photos share the grid size',
      );
      assert.deepEqual(
        m.photoHeights,
        m.photoWidths,
        'a cropped photo is square by CSS, untouched by the justify pass',
      );
    });
  }

  test('the column split keeps its subgrid layout', async (t) => {
    if (skip) return t.skip(skip);
    const s = await variant({ columnSplit: '2' });
    const html = await buildSlidesPdfHtml(repoRoot, {
      id: 'deck',
      title: 'Deck',
      slides: [s],
    });
    const browser = await getPuppeteerBrowser({ featureName: 'test' });
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1600, height: 900 });
      await page.setContent(html, { waitUntil: 'load' });
      await settleRenderedPage(page);
      const inline = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.slide-team-cards .team-card'))
          .map((c) => c.getAttribute('style') || '')
          .join('|'),
      );
      assert.equal(
        inline,
        '|||',
        'the justify pass leaves the split layout alone',
      );
    } finally {
      await page.close();
    }
  });
});

describe('image blocks, original aspect: the runtime cleans up after itself', () => {
  test('caption-only font completion replans, and deferred font completion after detach stays idle', async (t) => {
    if (skip) return t.skip(skip);
    const html = await buildSlidesPdfHtml(repoRoot, {
      id: 'deck',
      title: 'Deck',
      slides: [
        await slide([PORTRAIT], { byline: () => 'Caption words '.repeat(6) }),
      ],
    });
    const moduleSource = readFileSync(
      path.join(repoRoot, 'client/lib/slide-runtime/team-cards-justify.js'),
      'utf8',
    ).replace('export function initTeamCardsJustify', 'function init');
    const browser = await getPuppeteerBrowser({ featureName: 'test' });
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1600, height: 900 });
      await page.setContent(html, { waitUntil: 'load' });
      await settleRenderedPage(page);
      const result = await page.evaluate(async (src) => {
        // Clone away from the document's already-mounted runtime, so only the
        // initializer under test can respond to this synthetic font lifecycle.
        const original = document.querySelector('.slide-team-cards');
        const slideEl = original.cloneNode(true);
        original.replaceWith(slideEl);
        let resolveReady;
        const fonts = new EventTarget();
        fonts.ready = new Promise((resolve) => {
          resolveReady = resolve;
        });
        Object.defineProperty(document, 'fonts', {
          configurable: true,
          value: fonts,
        });
        // eslint-disable-next-line no-new-func
        const init = new Function(`${src}; return init;`)();
        const frames = async () => {
          for (let i = 0; i < 3; i += 1)
            await new Promise((resolve) => requestAnimationFrame(resolve));
        };
        const detach = init(slideEl);
        await frames();
        const heading = slideEl.querySelector('.header');
        const byline = slideEl.querySelector('.team-card-byline');
        const photo = slideEl.querySelector('.team-card-photo');
        const before = {
          heading: heading.getBoundingClientRect().height,
          caption: byline.getBoundingClientRect().height,
          photo: photo.getBoundingClientRect().height,
        };
        // A late caption font can change metrics without changing any observed
        // heading/slide box. Simulate that metric change without network timing.
        byline.style.fontSize = '64px';
        await frames();
        const beforeEvent = photo.getBoundingClientRect().height;
        fonts.dispatchEvent(new Event('loadingdone'));
        await frames();
        const after = {
          heading: heading.getBoundingClientRect().height,
          caption: byline.getBoundingClientRect().height,
          photo: photo.getBoundingClientRect().height,
        };
        detach();
        let mutations = 0;
        const observer = new MutationObserver((records) => {
          mutations += records.length;
        });
        observer.observe(slideEl, { attributes: true, subtree: true });
        resolveReady();
        fonts.dispatchEvent(new Event('loadingdone'));
        await frames();
        observer.disconnect();
        return { before, beforeEvent, after, mutations };
      }, moduleSource);
      assert.equal(
        result.before.heading,
        result.after.heading,
        'the heading never resized',
      );
      assert.equal(
        result.beforeEvent,
        result.before.photo,
        'caption metrics alone did not trigger a resize pass',
      );
      assert.notEqual(
        result.before.caption,
        result.after.caption,
        'caption metrics changed',
      );
      assert.notEqual(
        result.before.photo,
        result.after.photo,
        'font completion repacked the photo',
      );
      assert.equal(
        result.mutations,
        0,
        'neither ready nor loadingdone can mutate a detached slide',
      );
    } finally {
      await page.close();
    }
  });

  test('repeated mounts leave no observers behind', async (t) => {
    if (skip) return t.skip(skip);
    const s = await slide([RATIO_3_2, RATIO_3_2, RATIO_3_2, RATIO_3_2]);
    const html = await buildSlidesPdfHtml(repoRoot, {
      id: 'deck',
      title: 'Deck',
      slides: [s],
    });
    const moduleSource = readFileSync(
      path.join(repoRoot, 'client/lib/slide-runtime/team-cards-justify.js'),
      'utf8',
    ).replace('export function initTeamCardsJustify', 'function init');

    const browser = await getPuppeteerBrowser({ featureName: 'test' });
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1600, height: 900 });
      await page.setContent(html, { waitUntil: 'load' });
      await settleRenderedPage(page);

      const result = await page.evaluate(async (src) => {
        // Count how many ResizeObservers stay connected: wrap the constructor
        // and tally construct/disconnect over the mounts.
        let live = 0;
        const Native = window.ResizeObserver;
        window.ResizeObserver = class extends Native {
          constructor(cb) {
            super(cb);
            live += 1;
          }
          disconnect() {
            live -= 1;
            return super.disconnect();
          }
        };
        // eslint-disable-next-line no-new-func
        const init = new Function(`${src}; return init;`)();
        const frame = () =>
          new Promise((r) => requestAnimationFrame(() => r()));
        const detaches = [];
        for (let i = 0; i < 5; i += 1) {
          detaches.push(init(document.body));
          await frame();
        }
        const peak = live;
        for (const detach of detaches) detach();
        await frame();
        window.ResizeObserver = Native;
        return { peak, live };
      }, moduleSource);
      assert.ok(result.peak > 0, 'the pass really did observe something');
      assert.equal(
        result.live,
        0,
        `every mount's observers are disconnected (${result.live} left of ${result.peak})`,
      );
    } finally {
      await page.close();
    }
  });
});
