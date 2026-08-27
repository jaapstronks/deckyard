/**
 * Core slide CSS may not name a theme's background variant (B165).
 *
 * `.slide-bg-<id>` is emitted for ANY id a slide stores (`bgClass()` in
 * shared/slide-types/helpers.js), so a stylesheet can select on one. Two very
 * different things were being said with that selector:
 *
 *   1. "the ground is THAT COLOUR" — a step-indicator that paints
 *      `var(--slide-bg-lime)` would vanish on a lime slide, so it swaps to the
 *      accent. Honest: the name means exactly what it says.
 *   2. "the ground is DARK" — the timeline's glass cards, the plain table
 *      header tint, the KPI tile rim, all keyed on `.slide-bg-calm`. A hidden
 *      contract: `calm` is one theme's variant id (amethyst and brand ship it),
 *      and its darkness is a property of that theme's palette, not of the name.
 *      Every new dark variant had to be added to all of them by hand.
 *
 * Meaning 2 now lives on `has-slide-bg-light-text`, the one luminance spelling
 * (00-base.css, docs/reference/theme-slide-backgrounds.md). This gate keeps
 * meaning 1 from growing back into meaning 2 the only way it can be checked
 * mechanically: **a core stylesheet may only select on a BUILT-IN background
 * name.** A theme-variant id appearing in `client/styles/` is by definition
 * core CSS reaching into theme data.
 *
 * `custom/styles/` is deliberately out of scope — a fork owns its own variants
 * and may style them by name (fork-css-seam.test.js is that boundary).
 *
 * Run with: node --test tests/slide-bg-luminance-contract.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RESERVED_SLIDE_BG_IDS } from '../shared/theme-slide-backgrounds.js';
import { CORE_SLIDE_TYPE_DEFS } from '../shared/slide-types/registry.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const stylesDir = path.join(repoRoot, 'client', 'styles');

/**
 * Ids a core stylesheet may name. Exactly the reserved set — the built-in
 * background values every theme answers for (`BACKGROUND_FIELD` /
 * `BACKGROUND_FIELD_EXTENDED` in shared/slide-types/helpers.js) — so the
 * allowlist cannot drift from the field definitions it mirrors.
 */
const BUILT_IN = RESERVED_SLIDE_BG_IDS;

/**
 * Structural class names in the `has-slide-bg` (background-IMAGE) family that
 * share the `slide-bg-` prefix without being background values.
 */
const IMAGE_LAYER = new Set(['layer', 'image', 'overlay']);

/**
 * Blank out comment bodies, keeping newlines so line numbers stay honest. The
 * prose in this repo names `.slide-bg-calm` precisely to say why nothing may
 * select on it any more; a gate that reads its own rationale as a violation is
 * not a gate.
 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

async function cssFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await cssFiles(full)));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

// `.slide-bg-<id>` as a SELECTOR. Excludes `--slide-bg-<id>` / `--t-slide-bg-<id>`
// (custom properties — reading a background's colour is meaning 1 by
// construction) by requiring a literal dot in front.
const SELECTOR_RE = /(^|[^-\w])\.slide-bg-([a-z0-9][a-z0-9-]*)/g;

describe('slide background names in core', () => {
  it('no core slide type offers a theme variant as a background option', () => {
    // The same defect one layer up, and the reason the CSS one survived:
    // `team-cards-slide` hardcoded `{ value: 'calm' }` in its own background
    // field, so core offered amethyst's variant on every theme — an inert
    // class on the four that do not ship it. The picker appends the ACTIVE
    // theme's variants itself (`mergeBackgroundOptions`), which is both the
    // shorter code and the only correct answer per theme.
    const offenders = [];
    for (const [type, def] of Object.entries(CORE_SLIDE_TYPE_DEFS)) {
      const field = (def?.fields || []).find((f) => f?.key === 'background');
      for (const o of field?.options || []) {
        const id = String(o?.value ?? '');
        if (!BUILT_IN.has(id)) offenders.push(`${type}: ${id}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "A background option that is not built in is one theme's variant. " +
        'Use BACKGROUND_FIELD / BACKGROUND_FIELD_EXTENDED and let the picker ' +
        "append the active theme's variants.\n  " +
        offenders.join('\n  '),
    );
  });

  it('never names a theme variant', async () => {
    const offenders = [];
    for (const file of await cssFiles(stylesDir)) {
      const text = stripComments(await fs.readFile(file, 'utf8'));
      const lines = text.split('\n');
      for (const [i, line] of lines.entries()) {
        for (const m of line.matchAll(SELECTOR_RE)) {
          const id = m[2];
          if (IMAGE_LAYER.has(id) || id.startsWith('overlay-')) continue;
          if (BUILT_IN.has(id)) continue;
          offenders.push(
            `${path.relative(repoRoot, file)}:${i + 1}  .slide-bg-${id}`,
          );
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'Core CSS selects on a theme-defined background variant. If the rule is ' +
        'about how light the ground is, key it on `has-slide-bg-light-text` ' +
        '(see 00-base.css § THE ONE LUMINANCE SPELLING). If it is about the ' +
        'colour, the variant belongs in the theme, not in core CSS.\n  ' +
        offenders.join('\n  '),
    );
  });

  it('keeps the luminance rules on the luminance class', async () => {
    // The three treatments B165 moved. Named explicitly so a future edit that
    // silently reverts one to a background name fails here as well as above —
    // `.slide-bg-dark` is a built-in and would pass the first check.
    const expected = [
      ['slides/01-layout-and-title/35-table-slide.css', '.md-table--plain'],
      ['slides/01-layout-and-title/80-kpi-metrics-slide.css', '.kpi-metric'],
      ['slides/01-layout-and-title/86-timeline-slide.css', '.timeline-track'],
    ];
    for (const [rel, marker] of expected) {
      const text = await fs.readFile(path.join(stylesDir, rel), 'utf8');
      const hits = text
        .split('\n')
        .filter((l) => l.includes('has-slide-bg-light-text'));
      assert.ok(
        hits.length > 0,
        `${rel} must key its dark-ground rules on has-slide-bg-light-text`,
      );
      assert.ok(text.includes(marker), `${rel} must still style ${marker}`);
    }
  });
});
