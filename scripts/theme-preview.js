#!/usr/bin/env node
// theme:preview — a contact sheet of one theme across every slide type it
// allows and every background each of those types offers.
//
// WHY THIS EXISTS
// The theme editor's live preview (client/views/settings/theme-editor/preview.js)
// is good, and it has two hard edges that hit a theme author at exactly the
// wrong moment. It previews a DATABASE theme draft, so a *file* theme in
// custom/themes/<id>/theme.json — how a fork versions its house style — has no
// preview at all. And it deliberately shows a handful of slides, which is the
// right call for a side panel and means nobody ever sees what the theme does to
// the other thirty-odd registered types until a deck is in front of an audience.
//
// The first run of this harness in a fork found two bugs inside two minutes: a
// logo drifting to centre because `.slide` is a flex container and the wrapper
// had no explicit width, and white text landing on the bright edge of an
// artwork background. Both are trivial once they are on one sheet and invisible
// until then. Neither is expressible as a static assertion, which is why the
// deliverable is a sheet a human scans rather than a pass/fail.
//
// WHY THE EXPORT RENDER PATH
// Every tile goes through `renderSlideToPngBuffer` — the same
// `loadExportCssBundle` + `buildExportStyleContent` + `setContent` chain a PDF
// or PNG export runs. That is the whole reason the sheet is trustworthy: theme
// var embedding, gradient rasterisation and the SSRF pass are exactly as
// production. A lookalike renderer would keep passing through the very
// regressions the sheet exists to catch.
//
// NOT capture/: that harness navigates a RUNNING server and screenshots real
// pages (it is for the docs screenshots). This one wants the opposite —
// server-less, database-less, one slide straight to setContent. The anchor is
// server/render/png.js.
//
//   npm run theme:preview <theme-id>
//
// Writes tmp/theme-preview/<theme-id>/: one PNG per (type × background) plus an
// index.html that tiles them, grouped by type, with the WCAG report on top.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initSanitizer } from '../shared/sanitize.js';
import { assessContrast } from '../shared/contrast.js';
import { hexToRgb } from '../shared/color-utils.js';
import { mergeBackgroundOptions } from '../shared/theme-slide-backgrounds.js';
import { escapeHtml } from '../shared/slide-types/helpers.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { newSlide } from '../shared/slide-types/presentation.js';
import { isInsertableSlideType } from '../client/views/editor/slide-types-policy.js';
import { renderSlideToPngBuffer } from '../server/render/png.js';
import { loadThemeAssets, listThemeIds } from '../server/utils/themes.js';
import { closePuppeteerBrowser } from '../server/utils/puppeteer-browser.js';
import { parseArgs } from './lib/cli-args.js';
import { isCli } from './lib/is-cli.js';

const USAGE = 'node scripts/theme-preview.js <theme-id>';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * The backgrounds to render one slide type against.
 *
 * Reads the type's own `background` field rather than assuming lime/mist:
 * `countdown-slide` declares seven options and a custom type declares its own,
 * so a hardcoded pair would render a matrix the editor never offers. A type
 * with no `background` field renders once, against the theme default.
 *
 * @param {Object} def - slide type definition
 * @param {Object} theme - normalized theme
 * @returns {Array<string|null>} background ids, or `[null]` for "render once"
 */
export function backgroundsForType(def, theme) {
  const field = (def?.fields || []).find((f) => f?.key === 'background');
  if (!field) return [null];
  const ids = mergeBackgroundOptions(
    field.options,
    theme?.slideBackgrounds,
  ).map((o) => o.value);
  return ids.length ? ids : [null];
}

/**
 * The solid colour a background variant's text sits on, when there is one.
 *
 * A variant's `value` is CSS, not a colour: it may be a plain hex, a gradient
 * layered over a base colour (`radial-gradient(...), #140a26` — the convention
 * the docs use), or artwork. Only the first two have a single ground to measure
 * against; artwork's worst case is a per-pixel question that needs the rendered
 * PNG sampled under the text box, which is a second and heavier tool.
 *
 * Returns '' rather than guessing, so the report can say "not measured" instead
 * of publishing a number that means nothing.
 *
 * @param {string} value - the variant's CSS `value`
 * @returns {string} a hex colour, or '' when the ground is not a single colour
 */
export function groundColorOf(value) {
  const v = String(value || '').trim();
  if (!v || /\burl\s*\(/i.test(v)) return '';
  // Top-level comma split: gradient layers carry commas of their own.
  const layers = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < v.length; i += 1) {
    const c = v[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ',' && depth === 0) {
      layers.push(v.slice(start, i));
      start = i + 1;
    }
  }
  layers.push(v.slice(start));
  // The ground is the bottom layer; CSS paints the first layer on top.
  const last = layers[layers.length - 1].trim();
  return hexToRgb(last) ? last : '';
}

/**
 * WCAG readings for the theme's flat background variants.
 *
 * Scoped honestly: a variant that sets `textColor` against a solid or gradient
 * ground has a computable ratio, and that is the cheap 90%. Artwork variants
 * and non-hex colours (an `rgba()` muted tone, a `var()`) are reported as not
 * measured rather than scored as 1:1, which would read as a failure the theme
 * does not have.
 *
 * This reports; it does not gate. Turning the sheet into a build gate is the
 * natural follow-up, but a theme author needs to see the matrix before a
 * threshold starts refusing it.
 *
 * @param {Object} theme - normalized theme
 * @returns {Array<{id: string, ground: string, pairs: Array<Object>, skipped: string}>}
 */
export function contrastReport(theme) {
  const rows = [];
  for (const e of theme?.slideBackgrounds || []) {
    if (!e.textColor) continue; // no declared text colour, nothing to pair
    const ground = groundColorOf(e.value);
    if (!ground) {
      rows.push({ id: e.id, ground: '', pairs: [], skipped: 'artwork' });
      continue;
    }
    const pairs = [];
    for (const [role, color] of [
      ['text', e.textColor],
      ['muted', e.textColorMuted],
      ['link', e.linkColor],
    ]) {
      if (!color) continue;
      if (!hexToRgb(color)) {
        pairs.push({ role, color, skipped: 'non-hex' });
        continue;
      }
      // `body` for every pair, matching the theme editor's own variant badge
      // (variants-section.js): one bar, so the sheet and the panel cannot
      // disagree about the same variant.
      pairs.push({
        role,
        color,
        ...assessContrast(color, ground, { size: 'body' }),
      });
    }
    rows.push({ id: e.id, ground, pairs, skipped: '' });
  }
  return rows;
}

/**
 * Render the whole matrix and write the sheet.
 *
 * @param {string} themeId
 * @returns {Promise<number>} process exit code
 */
async function run(themeId) {
  const available = await listThemeIds(repoRoot);
  if (!available.includes(themeId)) {
    // loadThemeAssets falls back to the default theme on a miss, so a typo
    // would otherwise produce a full, plausible sheet of the wrong theme.
    console.error(`Unknown theme: ${themeId}`);
    console.error(`Available: ${available.join(', ')}`);
    return 1;
  }

  // Without this the markdown renderer escapes its own output and every slide
  // carrying rich text shows raw markup — a sheet that misreports the export it
  // is meant to stand in for. The server and the MCP entry point do the same.
  await initSanitizer();

  const theme = await loadThemeAssets(repoRoot, themeId);
  // Cleared, not merged: a tile left behind by an earlier run (a variant since
  // renamed, a type the theme now excludes) sits in the folder looking current.
  // The id is one of `listThemeIds`, so the path cannot be steered out of tmp/.
  const outDir = path.join(repoRoot, 'tmp', 'theme-preview', themeId);
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const allTypes = Object.keys(SLIDE_TYPES).sort();
  // The theme's own visibility policy, not the raw registry: a theme-scoped
  // type (`def.themeId`) rendered under a different theme, or a type the theme
  // excludes, is a tile of something no deck on this theme can contain.
  // `canEditCustomHtml` is true here because the sheet asks what the theme can
  // produce, not what one user may author.
  const types = allTypes.filter((type) =>
    isInsertableSlideType({
      type,
      def: SLIDE_TYPES[type],
      theme,
      canEditCustomHtml: true,
    }),
  );
  const hidden = allTypes.length - types.length;

  console.log(
    `theme "${themeId}": ${types.length} slide types` +
      (hidden ? ` (${hidden} not available on this theme)` : ''),
  );

  const cells = [];
  for (const type of types) {
    for (const bg of backgroundsForType(SLIDE_TYPES[type], theme)) {
      const name = `${type}${bg ? `--${bg}` : ''}.png`;
      try {
        const slide = newSlide({ type, theme });
        if (bg) slide.content.background = bg;
        const png = await renderSlideToPngBuffer(repoRoot, slide, { theme });
        await fs.writeFile(path.join(outDir, name), png);
        cells.push({ type, bg, name, error: '' });
        process.stdout.write('.');
      } catch (err) {
        cells.push({ type, bg, name, error: String(err?.message || err) });
        process.stdout.write('x');
      }
    }
  }
  process.stdout.write('\n');

  const report = contrastReport(theme);
  await fs.writeFile(
    path.join(outDir, 'index.html'),
    contactSheet(themeId, cells, report),
    'utf8',
  );

  printContrast(report);
  const failed = cells.filter((c) => c.error);
  console.log(
    `\n${cells.length - failed.length}/${cells.length} tiles → ${path.relative(repoRoot, outDir)}/index.html`,
  );
  for (const f of failed) console.log(`  FAILED ${f.name}: ${f.error}`);
  return failed.length ? 1 : 0;
}

/** One line per measured pair, so a failing combination is visible without opening the sheet. */
function printContrast(report) {
  if (!report.length) return;
  console.log('\nWCAG (flat background variants):');
  for (const row of report) {
    if (row.skipped) {
      console.log(`  ${row.id}: not measured (${row.skipped} background)`);
      continue;
    }
    for (const p of row.pairs) {
      console.log(
        p.skipped
          ? `  ${row.id}/${p.role}: not measured (${p.skipped})`
          : `  ${row.id}/${p.role}: ${p.ratio.toFixed(2)}:1 ${p.level.toUpperCase()} (Lc ${Math.round(Math.abs(p.apcaLc))})`,
      );
    }
  }
}

/** The report table, above the tiles it explains. */
function contrastSection(report) {
  if (!report.length) return '';
  const rows = report.flatMap((row) => {
    if (row.skipped) {
      return [
        `<tr><td>${escapeHtml(row.id)}</td><td colspan="4" class="muted">not measured (${escapeHtml(row.skipped)} background)</td></tr>`,
      ];
    }
    return row.pairs.map((p) => {
      const cells = p.skipped
        ? `<td colspan="3" class="muted">not measured (${escapeHtml(p.skipped)})</td>`
        : `<td>${p.ratio.toFixed(2)}:1</td>` +
          `<td data-level="${escapeHtml(p.level)}">${escapeHtml(p.level.toUpperCase())}</td>` +
          `<td class="muted">Lc ${Math.round(Math.abs(p.apcaLc))}</td>`;
      return (
        `<tr><td>${escapeHtml(row.id)}</td>` +
        `<td><span class="swatch" style="background:${escapeHtml(row.ground)};color:${escapeHtml(p.color)}">Aa</span> ${escapeHtml(p.role)}</td>` +
        `${cells}</tr>`
      );
    });
  });
  return `<section><h2>WCAG — flat background variants</h2>
<table><thead><tr><th>variant</th><th>pair</th><th>ratio</th><th>level</th><th>APCA</th></tr></thead>
<tbody>${rows.join('')}</tbody></table>
<p class="muted">Artwork grounds are a per-pixel question and are not measured here.</p></section>`;
}

/** Tile the renders, grouped by slide type, one row of backgrounds per type. */
function contactSheet(themeId, cells, report) {
  const byType = new Map();
  for (const c of cells) {
    if (!byType.has(c.type)) byType.set(c.type, []);
    byType.get(c.type).push(c);
  }
  const groups = [...byType.entries()]
    .map(([type, list]) => {
      const tiles = list
        .map((c) => {
          const caption = escapeHtml(c.bg || 'default');
          const body = c.error
            ? `<div class="err" title="${escapeHtml(c.error)}">render failed</div>`
            : `<img loading="lazy" src="${escapeHtml(c.name)}" alt="${escapeHtml(c.type)} on ${caption}">`;
          return `<figure${c.error ? ' class="fail"' : ''}>${body}<figcaption>${caption}</figcaption></figure>`;
        })
        .join('');
      return `<section><h2>${escapeHtml(type)}</h2><div class="row">${tiles}</div></section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>theme: ${escapeHtml(themeId)}</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 24px; background: #111; color: #eee; }
  h1 { font-size: 18px; }
  h2 { font-size: 14px; opacity: .7; margin: 28px 0 8px; font-weight: 600; }
  .row { display: flex; flex-wrap: wrap; gap: 12px; }
  figure { margin: 0; width: 320px; }
  img, .err { width: 320px; height: 180px; border: 1px solid #333; display: block; }
  img { object-fit: cover; }
  .err { display: grid; place-items: center; border-color: #722; color: #f88; background: #1a0d0d; }
  figcaption { font-size: 12px; opacity: .6; margin-top: 4px; }
  table { border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 4px 14px 4px 0; border-bottom: 1px solid #262626; }
  .muted { opacity: .6; }
  [data-level="fail"] { color: #f88; }
  [data-level="aa"], [data-level="aaa"] { color: #8f8; }
  .swatch { display: inline-grid; place-items: center; width: 26px; height: 20px;
    border: 1px solid #333; font-size: 11px; vertical-align: middle; }
</style></head>
<body>
<h1>theme: ${escapeHtml(themeId)} — every slide type × every background</h1>
${contrastSection(report)}
${groups}
</body></html>`;
}

if (isCli(import.meta.url)) {
  const { positional } = parseArgs(process.argv.slice(2), {
    usage: USAGE,
    maxPositional: 1,
  });
  const themeId = String(positional[0] || '').trim();
  if (!themeId) {
    console.error(`Usage: ${USAGE}`);
    process.exit(1);
  }
  try {
    process.exitCode = await run(themeId);
  } finally {
    await closePuppeteerBrowser();
  }
}
