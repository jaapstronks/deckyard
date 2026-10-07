/**
 * No text-style control without an effect (B464 PR 2, closes B277).
 *
 * Declaring `size` or `align` on a field is a promise the CSS keeps
 * (docs/reference/text-styles.md). A class assertion cannot prove it - the
 * selector that reads `--tf-size-scale` can miss the element, which is exactly
 * how S/M/L did nothing on the title slide for months. So every core type's
 * every offer is rendered with the real slide CSS in a real browser and
 * measured:
 *
 *   - size: the text of every element the key covers renders smaller at `sm`
 *     and larger at `lg` than at the default, and no element outside the key
 *     changes size;
 *   - align: every alignment value the offer allows lands as the computed
 *     `text-align` of every covered element's text, and nothing else moves;
 *   - the title slide's fullest legal block still fits the frame with both
 *     title and subtitle at `lg`, in every `titleLayout`, while the meta line
 *     keeps its size.
 *
 * Run with: node --test tests/text-style-render-guard.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initSanitizer } from '../shared/sanitize.js';
import { isListOnlyMarkdown } from '../shared/markdown.js';
import { seedThemeConfig } from './helpers/theme-seed.js';
import { renderSlideHtml } from '../shared/slide-types.js';
import {
  CORE_SLIDE_TYPE_DEFS,
  CORE_SLIDE_TYPE_NAMES,
} from '../shared/slide-types/registry.js';
import {
  offerAlign,
  textStyleOffers,
} from '../shared/slide-types/text-styles.js';
import {
  resolveChromeExecutablePath,
  closePuppeteerBrowser,
  getPuppeteerBrowser,
} from '../server/utils/puppeteer-browser.js';
import {
  loadExportCssBundle,
  buildExportStyleContent,
} from '../server/export/css-bundle.js';

await initSanitizer();
after(closePuppeteerBrowser);

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const skip = !isCi && !chromePath ? 'no Chrome/Chromium found' : false;

const SAMPLE = 'Text the guard measures';
const CORE_THEMES = [
  'amethyst',
  'brand',
  'corporate',
  'editorial',
  'midnight',
  'playful',
];

const css = await loadExportCssBundle(repoRoot, null, null, { slides: [] });

function documentFor(slide, theme = null, bundle = css) {
  const html = renderSlideHtml(slide, { mode: 'edit', theme });
  return `<!doctype html><html><head><meta charset="utf-8"><style>${buildExportStyleContent(
    bundle,
    [
      'html,body{margin:0}body{width:1600px;height:900px}.slide{width:1600px!important;height:900px!important}.ps-theme{position:relative;width:1600px;height:900px}',
    ],
  )}</style></head><body><div class="ps-theme">${html}</div></body></html>`;
}

/** The `data-inline-field` values an offer covers, as one anchored regex. */
function coveredPattern(offer) {
  const keys = offer.scope === 'set' ? offer.members : [offer.key];
  const alts = keys.map((k) =>
    k
      .split('.')
      .map((p) =>
        p === '*' ? '\\d+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      )
      .join('\\.'),
  );
  return `^(?:${alts.join('|')})$`;
}

/**
 * The type's defaults with every offered field filled, and an array offer
 * given at least two instances, so a guard can never pass on an empty or
 * single element.
 */
function contentFor(def) {
  const content = structuredClone(def.defaults || {});
  for (const offer of textStyleOffers(def).values()) {
    if (offer.scope === 'items') {
      const [list, , item] = offer.key.split('.');
      const items = Array.isArray(content[list]) ? content[list] : [];
      while (items.length < 2) items.push(structuredClone(items[0] || {}));
      for (const it of items)
        if (!String(it[item] ?? '').trim()) it[item] = SAMPLE;
      content[list] = items;
    } else {
      // A list-only markdown value stays on its markers whatever the block
      // does, and the editor shows alignment disabled for it
      // (text-element-card.js), so the guard measures a paragraph.
      for (const k of offer.scope === 'set' ? offer.members : [offer.key])
        if (!String(content[k] ?? '').trim() || isListOnlyMarkdown(content[k]))
          content[k] = SAMPLE;
    }
  }
  return content;
}

/**
 * In the page: per `data-inline-field` element, the font size and alignment
 * of its first text - the element the reader sees, which may be a `<p>` or
 * `<li>` inside the field rather than the field itself.
 */
function measureInPage() {
  const out = {};
  for (const el of document.querySelectorAll('.slide [data-inline-field]')) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.textContent.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
    });
    const text = walker.nextNode();
    const host = text ? text.parentElement : el;
    const cs = getComputedStyle(host);
    const dir = cs.direction;
    const align =
      {
        start: dir === 'rtl' ? 'right' : 'left',
        end: dir === 'rtl' ? 'left' : 'right',
      }[cs.textAlign] || cs.textAlign;
    const key = el.getAttribute('data-inline-field');
    // A field may render twice (a hidden measuring copy); keep the first.
    if (!(key in out))
      out[key] = { size: parseFloat(cs.fontSize), align, hasText: !!text };
  }
  return out;
}

async function measure(page, slide, theme) {
  await page.setContent(documentFor(slide, theme), { waitUntil: 'load' });
  return page.evaluate(measureInPage);
}

const OFFERING = CORE_SLIDE_TYPE_NAMES.filter(
  (name) => textStyleOffers(CORE_SLIDE_TYPE_DEFS[name]).size > 0,
);

test('the guard is not vacuous: core types offer text styles', () => {
  assert.ok(OFFERING.length >= 7, `only ${OFFERING.join(', ')}`);
});

for (const name of OFFERING) {
  const def = CORE_SLIDE_TYPE_DEFS[name];
  test(
    `${name}: every offered size and alignment has an effect`,
    { skip },
    async () => {
      const browser = await getPuppeteerBrowser({ featureName: 'test' });
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1600, height: 900 });
        const content = contentFor(def);
        const slideWith = (textStyles) => ({
          id: 's',
          type: name,
          content: { ...content, textStyles },
        });
        const base = await measure(page, slideWith({}));
        const failures = [];
        for (const offer of textStyleOffers(def).values()) {
          const re = new RegExp(coveredPattern(offer));
          const covered = Object.keys(base).filter((k) => re.test(k));
          const others = Object.keys(base).filter((k) => !re.test(k));
          const minimum = offer.scope === 'field' ? 1 : 2;
          if (covered.filter((k) => base[k].hasText).length < minimum) {
            failures.push(
              `${offer.key}: renders ${covered.length} element(s) with text`,
            );
            continue;
          }
          const unchanged = (got, prop, label) => {
            for (const k of others)
              if (got[k] && got[k][prop] !== base[k][prop])
                failures.push(
                  `${offer.key} ${label}: ${k} changed ${prop} ${base[k][prop]} → ${got[k][prop]}`,
                );
          };
          if (offer.props.includes('size')) {
            const sm = await measure(
              page,
              slideWith({ [offer.key]: { size: 'sm' } }),
            );
            const lg = await measure(
              page,
              slideWith({ [offer.key]: { size: 'lg' } }),
            );
            for (const k of covered) {
              if (!(sm[k].size < base[k].size && base[k].size < lg[k].size))
                failures.push(
                  `${offer.key} size: ${k} sm/md/lg = ${sm[k].size}/${base[k].size}/${lg[k].size}`,
                );
            }
            unchanged(sm, 'size', 'sm');
            unchanged(lg, 'size', 'lg');
          }
          const { values } = offerAlign(def, offer);
          for (const value of values) {
            const got = await measure(
              page,
              slideWith({ [offer.key]: { align: value } }),
            );
            for (const k of covered)
              if (got[k].align !== value)
                failures.push(
                  `${offer.key} align ${value}: ${k} renders ${got[k].align}`,
                );
            unchanged(got, 'align', `align ${value}`);
          }
        }
        assert.deepEqual(failures, []);
      } finally {
        await page.close();
      }
    },
  );
}

test(
  'title slide: the fullest block fits with title and subtitle at L, meta stays fixed',
  { skip },
  async () => {
    const browser = await getPuppeteerBrowser({ featureName: 'test' });
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1600, height: 900 });
      // Real words, so the browser wraps them the way a deck would.
      const words = (n) =>
        'The quick brown fox jumps over the lazy dog '
          .repeat(Math.ceil(n / 44))
          .slice(0, n)
          .trim();
      const full = {
        ...CORE_SLIDE_TYPE_DEFS['title-slide'].defaults,
        title: words(120),
        subheading: words(160),
        meta: words(160),
      };
      const failures = [];
      // The cover scale's floor was measured across the six core themes and
      // the three `titleLayout`s; an L override has to hold on the same grid.
      for (const slug of CORE_THEMES) {
        const theme = await seedThemeConfig(slug);
        const bundle = await loadExportCssBundle(repoRoot, theme, null, {
          slides: [],
        });
        for (const titleLayout of ['bottom', 'center', 'top']) {
          for (const textStyles of [
            {},
            { title: { size: 'lg' }, subheading: { size: 'lg' } },
          ]) {
            const slide = {
              id: 's',
              type: 'title-slide',
              content: { ...full, textStyles },
            };
            await page.setContent(
              documentFor(slide, { ...theme, titleLayout }, bundle),
              { waitUntil: 'load' },
            );
            await page.evaluate(() => document.fonts.ready);
            const box = await page.evaluate(() => {
              const r = document
                .querySelector('.slide .tsu-content')
                .getBoundingClientRect();
              return { top: r.top, bottom: r.bottom };
            });
            if (box.top < 0 || box.bottom > 900)
              failures.push(
                `${slug} ${titleLayout} ${JSON.stringify(textStyles)}: block spans ${box.top}–${box.bottom}`,
              );
          }
        }
      }
      assert.deepEqual(failures, []);
      // At the fullest block, L still reads larger than M, and meta never moves.
      const at = async (textStyles) =>
        measure(page, {
          id: 's',
          type: 'title-slide',
          content: { ...full, textStyles },
        });
      const md = await at({});
      const lg = await at({
        title: { size: 'lg' },
        subheading: { size: 'lg' },
      });
      assert.ok(
        lg.title.size > md.title.size,
        `title L ${lg.title.size} vs M ${md.title.size}`,
      );
      assert.equal(lg.meta.size, md.meta.size);
    } finally {
      await page.close();
    }
  },
);
