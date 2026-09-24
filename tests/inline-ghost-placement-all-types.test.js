/**
 * No ghost chip covers content, on any slide type (B435, D212; Test 1 of the
 * brief).
 *
 * Every type that declares ghosts is rendered in edit mode with the real slide
 * CSS in a real browser, twice per optional field: with only that field empty
 * (the half-filled state, where the seam lies between filled neighbours) and
 * with every ghost field empty at once. For each empty field the chip is
 * placed by the editor's own rule - `describeSeam()` + `placeGhost()` from
 * `client/views/editor/inline-edit/ghost-placement.js`, loaded into the page -
 * against what the overlay places it against (the rendered text fields and
 * the chips already standing). The test fails when a chip lands on a field or
 * another chip.
 *
 * Sizes are in slide pixels. The editor canvas shows the 1600px slide at
 * about half size while chips keep screen size, so a 26px chip is ~52 slide
 * px; the numbers below model that.
 *
 * Run with: node --test tests/inline-ghost-placement-all-types.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initSanitizer } from '../shared/sanitize.js';
import { SLIDE_TYPES, renderSlideHtml } from '../shared/slide-types.js';
import { SLIDE_TYPE_INLINE_EDIT } from '../shared/slide-types/inline-edit.js';
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

/** The placement module, as a script the page can run (exports stripped). */
const PLACEMENT_SRC = readFileSync(
  path.join(repoRoot, 'client/views/editor/inline-edit/ghost-placement.js'),
  'utf8',
).replace(/^export /gm, '');

/** Chip and compact sizes, gap, in slide px (see the header). */
const SIZES = {
  chipHeight: 52,
  charWidth: 15,
  chipPad: 70,
  compact: 44,
  gap: 12,
};

/** The ghost fields a descriptor names at the top level, with their anchors. */
function topGhosts(descriptor) {
  const out = [];
  for (const g of descriptor.ghosts || []) {
    out.push({ field: g.field, anchors: g.anchors || [] });
  }
  if (descriptor.convert?.addMedia?.anchors) {
    out.push({
      field: null,
      label: 'Add image',
      anchors: descriptor.convert.addMedia.anchors,
    });
  }
  return out;
}

/** The content a type starts from, with `fields` emptied. */
function contentWith(def, emptied) {
  const content = structuredClone(def.defaults || {});
  for (const f of emptied) content[f] = '';
  return content;
}

async function renderDocument(slide) {
  const css = await loadExportCssBundle(repoRoot, null, null);
  const html = renderSlideHtml(slide, { mode: 'edit' });
  return `<!doctype html><html><head><meta charset="utf-8"><style>${buildExportStyleContent(
    css,
    [
      'html,body{margin:0}body{width:1600px;height:900px}.slide{width:1600px!important;height:900px!important}.ps-theme{position:relative;width:1600px;height:900px}',
    ],
  )}</style></head><body><div class="ps-theme">${html}</div></body></html>`;
}

/**
 * In the page: place every chip the way the overlay does and report each one
 * that lands on something.
 */
function placeAllInPage({ ghosts, itemGhosts, sizes }) {
  /* global describeSeam, placeGhost, overlaps */
  const slide = document.querySelector('.slide');
  const r = (el) => {
    const b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  };
  const fields = [...slide.querySelectorAll('[data-inline-field]')]
    .map(r)
    .filter((b) => b.width > 0 && b.height > 0);
  const chips = [];
  const bounds = { left: 0, top: 0, width: 1600, height: 900 };
  const chipFor = (label) => ({
    width: sizes.chipPad + label.length * sizes.charWidth,
    height: sizes.chipHeight,
  });
  const compact = { width: sizes.compact, height: sizes.compact };
  const problems = [];
  let placed = 0;
  const place = (name, el, pos, label) => {
    placed++;
    const seam = describeSeam(el, pos);
    const res = placeGhost({
      direction: seam.direction,
      side: seam.side,
      align: seam.align,
      ref: r(seam.ref),
      block: r(seam.block),
      chip: chipFor(label),
      compact,
      fields,
      chips,
      bounds,
      gap: sizes.gap,
    });
    if (res.collides) {
      const hit = [...fields, ...chips].find((o) => overlaps(res.rect, o));
      problems.push({ name, rect: res.rect, hit });
    }
    chips.push(res.rect);
  };
  for (const g of ghosts) {
    const a = g.anchors
      .map((c) => ({ el: slide.querySelector(c.sel), pos: c.pos || 'append' }))
      .find((c) => c.el);
    if (a) place(g.field || g.label, a.el, a.pos, g.label || g.field);
  }
  for (const g of itemGhosts) {
    for (const item of slide.querySelectorAll(g.item)) {
      if (item.querySelector(`[data-inline-field$=".${g.field}"]`)) continue;
      const host = (g.within && item.querySelector(g.within)) || item;
      place(`${g.list}[].${g.field}`, host, g.pos || 'append', g.field);
    }
  }
  return { problems, placed };
}

const TYPES = Object.entries(SLIDE_TYPE_INLINE_EDIT).filter(
  ([name, d]) =>
    SLIDE_TYPES[name] &&
    ((d.ghosts || []).length ||
      (d.itemGhosts || []).length ||
      d.convert?.addMedia),
);

for (const [name, descriptor] of TYPES) {
  test(
    `${name}: no ghost chip covers a field or another chip`,
    { skip },
    async () => {
      const def = SLIDE_TYPES[name];
      const known = new Set((def.fields || []).map((f) => f.key));
      const ghostFields = topGhosts(descriptor).filter(
        (g) => g.field === null || known.has(g.field),
      );
      const optional = ghostFields
        .map((g) => g.field)
        .filter((f) => f && !def.fields.find((x) => x.key === f)?.required);
      const states = [
        { label: 'all ghost fields empty', emptied: optional },
        ...optional.map((f) => ({ label: `only ${f} empty`, emptied: [f] })),
      ];
      const browser = await getPuppeteerBrowser({ featureName: 'test' });
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1600, height: 900 });
        const failures = [];
        let placed = 0;
        for (const state of states) {
          const content = contentWith(def, state.emptied);
          const html = await renderDocument({ id: 's', type: name, content });
          await page.setContent(html, { waitUntil: 'load' });
          await page.addScriptTag({ content: PLACEMENT_SRC });
          const empty = new Set(
            ghostFields
              .filter(
                (g) =>
                  g.field === null || !String(content[g.field] ?? '').trim(),
              )
              .map((g) => g.field),
          );
          const res = await page.evaluate(placeAllInPage, {
            ghosts: ghostFields.filter((g) => empty.has(g.field)),
            itemGhosts: descriptor.itemGhosts || [],
            sizes: SIZES,
          });
          placed += res.placed;
          for (const p of res.problems)
            failures.push(
              `${state.label}: ${p.name} at ${JSON.stringify(p.rect)} hits ${JSON.stringify(p.hit)}`,
            );
        }
        assert.deepEqual(failures, []);
        // Not vacuous: every type here declares ghosts, so chips were placed.
        assert.ok(placed > 0, `${name}: no ghost chip was placed at all`);
      } finally {
        await page.close();
      }
    },
  );
}
