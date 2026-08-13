/**
 * Structural export metrics — form 2 of B14.
 *
 * The smoke test next door (`export-chrome-smoke.test.js`) proves the export
 * chain *runs*: Chrome launches, a PDF has pages, a PNG is not blank. It says
 * nothing about whether the result still looks right. This file closes that
 * gap without recording pixels.
 *
 * What it asserts per fixture, against a committed JSON baseline:
 *
 *   1. page count, page geometry and page text of the PDF
 *   2. the bounding boxes of title / subheading / body, within tolerance
 *   3. `document.fonts` **and the family Chrome actually painted with** — the
 *      one check that catches a webfont silently falling back to a system face
 *   4. the dominant frame colour, against the theme's own background token
 *   5. nothing painted outside the 1600×900 frame
 *
 * Why not pixel baselines: 37 types × 6 themes is 222 binary files nobody can
 * review, the flake is 10-25%, and the ubuntu runner rasterises differently
 * from a Mac anyway. That was decided against explicitly —
 * `docs/plans/briefs/export-structural-metrics.md`.
 *
 * **The tolerance lives here, not in the baselines.** A baseline records what
 * was measured; how strictly it is read is a property of the test, and mixing
 * the two is how a baseline quietly becomes unfalsifiable.
 *
 * Regenerating after an intentional layout or theme change:
 *
 *     UPDATE_EXPORT_METRICS=1 node --test tests/export-structural-metrics.test.js
 *
 * Requires a Chrome/Chromium binary and the `postinstall` font assets. Locally
 * the tests skip when either is missing; in CI a missing browser is a hard
 * failure, exactly as in the smoke test.
 *
 * Run with: node --test tests/export-structural-metrics.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Before anything that renders markdown. `markdownToSafeHtml()` ends in
// `sanitizeHtmlSync()`, which falls back to escaping its own output when no
// DOMPurify instance was initialised — so an uninitialised test process
// measures a slide whose body shows literal `<p>` tags, which is not what the
// server (server.js calls initSanitizer() at boot) renders. Measuring the wrong
// document would make every metric below meaningless.
import { initSanitizer } from '../shared/sanitize.js';
await initSanitizer();

import {
  resolveChromeExecutablePath,
  closePuppeteerBrowser,
} from '../server/utils/puppeteer-browser.js';
import { loadThemeAssets } from '../server/utils/themes.js';
import { curatedFontPath } from '../shared/theme-fonts.js';
import {
  FRAME,
  MEASURED_SELECTORS,
  measureSlide,
  measureDeckPdf,
  parseCssColor,
} from './helpers/export-metrics.js';
import {
  ALL_FIELD_TYPES_SLIDES,
  BUILTIN_THEMES,
  CALIBRATION_BACKGROUND_VARIANT,
  calibrationSlide,
  calibrationDeck,
  allFieldTypesDeck,
} from './fixtures/export-metrics/fixtures.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineDir = path.join(repoRoot, 'tests', 'fixtures', 'export-metrics');

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const updating = /^(1|true|yes)$/i.test(String(process.env.UPDATE_EXPORT_METRICS || '').trim());

/** The curated font assets are gitignored and filled by `postinstall`. */
const fontsPresent = await fs
  .access(path.join(repoRoot, curatedFontPath('inter', 400, 'latin')))
  .then(() => true)
  .catch(() => false);

const skip = (() => {
  if (isCi) return false;
  if (!chromePath)
    return 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';
  if (!fontsPresent)
    return 'no font assets — run `node scripts/download-google-fonts.js` (postinstall)';
  return false;
})();

// ---------------------------------------------------------------------------
// Tolerance
// ---------------------------------------------------------------------------

/**
 * Box tolerance: 3% of the baseline value, with a 2px floor.
 *
 * The percentage is what survives the rasteriser difference the brief names —
 * ubuntu and macOS lay out the same stack a hair differently, and that is
 * layout noise, not a regression. The floor keeps small values (a 24px
 * subheading height, an x of 0) from being held to a fraction of a pixel.
 *
 * It is deliberately *not* loose enough to absorb a wrapped line: a body block
 * gaining a line is a real layout change and should be seen. The fixtures keep
 * their text well clear of a wrap boundary so that stays a signal.
 */
const BOX_TOLERANCE_RATIO = 0.03;
const BOX_TOLERANCE_FLOOR_PX = 2;

/** Dominant-colour tolerance per channel: PNG encoding is exact, so this is tight. */
const COLOR_TOLERANCE = 2;

function boxAllowance(baselineValue) {
  return Math.max(Math.abs(baselineValue) * BOX_TOLERANCE_RATIO, BOX_TOLERANCE_FLOOR_PX);
}

/**
 * Compare one rect against its baseline, collecting readable failures.
 * @returns {string[]} - Empty when every side is within tolerance
 */
function rectDiffs(label, actual, expected) {
  const out = [];
  for (const side of ['x', 'y', 'width', 'height']) {
    const allowed = boxAllowance(expected[side]);
    const delta = Math.abs(actual[side] - expected[side]);
    if (delta > allowed) {
      out.push(
        `${label}.${side}: ${actual[side]} vs baseline ${expected[side]} ` +
          `(off by ${delta.toFixed(1)}px, allowed ${allowed.toFixed(1)}px)`
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Baseline I/O
// ---------------------------------------------------------------------------

async function readBaseline(name) {
  const file = path.join(baselineDir, `${name}.json`);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeBaseline(name, metrics) {
  const file = path.join(baselineDir, `${name}.json`);
  await fs.writeFile(file, `${JSON.stringify(metrics, null, 2)}\n`);
}

/**
 * Assert a measured fixture against its baseline, or record it when updating.
 * @returns {Promise<Object|null>} - The baseline, or null when it was just written
 */
async function baselineFor(name, metrics) {
  if (updating) {
    await writeBaseline(name, metrics);
    return null;
  }
  const baseline = await readBaseline(name);
  assert.ok(
    baseline,
    `missing baseline tests/fixtures/export-metrics/${name}.json — ` +
      'regenerate with UPDATE_EXPORT_METRICS=1'
  );
  return baseline;
}

after(async () => {
  await closePuppeteerBrowser();
});

// ---------------------------------------------------------------------------
// The calibration slide, once per theme
// ---------------------------------------------------------------------------

for (const themeName of BUILTIN_THEMES) {
  test(`calibration slide holds its structure in the ${themeName} theme`, { skip }, async () => {
    const theme = await loadThemeAssets(repoRoot, themeName);
    const metrics = await measureSlide(repoRoot, calibrationSlide(), { theme });
    const baseline = await baselineFor(`calibration-${themeName}`, metrics);
    if (!baseline) return;

    // 1. Boxes.
    const diffs = [];
    for (const selector of MEASURED_SELECTORS) {
      const actual = metrics.elements[selector];
      const expected = baseline.elements[selector];
      assert.ok(
        Boolean(actual) === Boolean(expected),
        `${selector}: present=${Boolean(actual)} but baseline present=${Boolean(expected)}`
      );
      if (!actual) continue;
      diffs.push(...rectDiffs(selector, actual.rect, expected.rect));
      assert.equal(actual.fontSize, expected.fontSize, `${selector}: font-size changed`);
      assert.equal(actual.fontWeight, expected.fontWeight, `${selector}: font-weight changed`);
      // The text itself, not only its box: the fixture's Latin-ext pangram is
      // the reason a subset regression has somewhere to show up, and a
      // mangled or dropped glyph would otherwise only move a width by a few
      // pixels — inside tolerance.
      assert.equal(actual.text, expected.text, `${selector}: rendered text changed`);
    }
    assert.deepEqual(diffs, [], `layout drifted beyond tolerance:\n  ${diffs.join('\n  ')}`);

    // 2. Fonts — both what loaded and what was painted.
    assert.deepEqual(
      metrics.loadedFonts,
      baseline.loadedFonts,
      'the set of loaded @font-face rules changed'
    );
    for (const selector of MEASURED_SELECTORS) {
      const actual = metrics.elements[selector];
      if (!actual) continue;
      assert.deepEqual(
        actual.paintedFamilies.map((f) => f.family),
        baseline.elements[selector].paintedFamilies.map((f) => f.family),
        `${selector}: Chrome painted a different font family than the baseline — ` +
          `a webfont that fails to load falls back here without any other symptom`
      );
    }

    // 3. Dominant colour against the theme's own token, not just against the
    //    baseline: this ties the rendered frame back to the theme file. The
    //    token is the slide's background *variant*, not `--t-color-background`
    //    — in the midnight theme those differ (#18181b vs #09090b).
    const tokenName = `--t-slide-bg-${CALIBRATION_BACKGROUND_VARIANT}`;
    const tokenRgb = parseCssColor(theme?.cssVars?.[tokenName]);
    assert.ok(tokenRgb, `${themeName}: ${tokenName} is not a parseable colour`);
    for (let i = 0; i < 3; i++) {
      assert.ok(
        Math.abs(metrics.dominantColor.rgb[i] - tokenRgb[i]) <= COLOR_TOLERANCE,
        `dominant frame colour rgb(${metrics.dominantColor.rgb}) should be the theme's ` +
          `${tokenName} rgb(${tokenRgb})`
      );
    }
    // And the slide element's own computed background should be that same
    // token — otherwise the frame could be dominated by something painted over
    // a mis-resolved slide background.
    const slideRgb = parseCssColor(metrics.slideBackground);
    assert.ok(slideRgb, `the .slide background did not resolve to a colour`);
    assert.deepEqual(
      slideRgb,
      tokenRgb,
      `.slide background ${metrics.slideBackground} should resolve to ${tokenName}`
    );
    assert.ok(
      metrics.dominantColor.share > 0.5,
      `the background should still dominate the frame (got ${metrics.dominantColor.share})`
    );

    // 4. Nothing outside the frame.
    assert.deepEqual(
      metrics.overflowing,
      [],
      `elements painted outside the ${FRAME.width}×${FRAME.height} frame`
    );
  });

  test(`calibration PDF keeps its page geometry in the ${themeName} theme`, { skip }, async () => {
    const theme = await loadThemeAssets(repoRoot, themeName);
    const metrics = await measureDeckPdf(repoRoot, calibrationDeck(themeName), { theme });
    const baseline = await baselineFor(`calibration-${themeName}-pdf`, metrics);
    if (!baseline) return;

    assert.deepEqual(metrics.parseErrors, [], 'the PDF should parse without errors');
    assert.equal(metrics.pageCount, baseline.pageCount, 'one slide in → one page out');
    assert.deepEqual(metrics.pages, baseline.pages, 'PDF page geometry changed');
    assert.deepEqual(metrics.pageText, baseline.pageText, 'PDF page text changed');
  });
}

// ---------------------------------------------------------------------------
// The all-field-types deck
// ---------------------------------------------------------------------------

test('the all-field-types deck exports one page per slide, unchanged', { skip }, async () => {
  const deck = allFieldTypesDeck();
  const theme = await loadThemeAssets(repoRoot, deck.theme);
  const metrics = await measureDeckPdf(repoRoot, deck, { theme });
  const baseline = await baselineFor('all-field-types-pdf', metrics);
  if (!baseline) return;

  assert.deepEqual(metrics.parseErrors, [], 'the PDF should parse without errors');
  assert.equal(
    metrics.pageCount,
    deck.slides.length,
    'every fixture slide should produce exactly one page'
  );
  assert.equal(metrics.pageCount, baseline.pageCount);
  assert.deepEqual(metrics.pages, baseline.pages, 'PDF page geometry changed');
  assert.deepEqual(metrics.pageText, baseline.pageText, 'PDF page text changed');
});

test('every all-field-types slide stays inside the frame with real fonts', { skip }, async () => {
  const deck = allFieldTypesDeck();
  const theme = await loadThemeAssets(repoRoot, deck.theme);

  const measured = [];
  for (const entry of ALL_FIELD_TYPES_SLIDES) {
    // Only the one role this slide type actually exposes is measured; the value
    // of this fixture is coverage of field kinds, not the exact geometry of six
    // different layouts. Each type names its own title element because they do
    // not share one (`.heading`, `.chart-title`, `.img-title`, …).
    const metrics = await measureSlide(repoRoot, entry.slide, {
      theme,
      selectors: [entry.titleSelector],
    });
    // Only what is asserted below is recorded. `fieldKinds` and
    // `titleSelector` describe the fixture and already live in fixtures.js;
    // `dominantColor` is the calibration slide's check, against the theme
    // token, and was never read here.
    measured.push({
      type: entry.slide.type,
      title: metrics.elements[entry.titleSelector],
      overflowing: metrics.overflowing,
      loadedFonts: metrics.loadedFonts,
    });
  }

  const baseline = await baselineFor('all-field-types', { slides: measured });
  if (!baseline) return;

  for (let i = 0; i < measured.length; i++) {
    const actual = measured[i];
    const expected = baseline.slides[i];
    assert.equal(actual.type, expected.type, `slide ${i}: fixture order changed`);
    assert.ok(
      actual.title,
      `${actual.type}: no element matched ${ALL_FIELD_TYPES_SLIDES[i].titleSelector} — ` +
        "the fixture's title selector no longer describes the rendered markup"
    );
    assert.deepEqual(
      actual.overflowing,
      [],
      `${actual.type}: elements painted outside the ${FRAME.width}×${FRAME.height} frame`
    );
    assert.deepEqual(
      actual.loadedFonts,
      expected.loadedFonts,
      `${actual.type}: the set of loaded @font-face rules changed`
    );
    if (actual.title && expected.title) {
      assert.deepEqual(
        rectDiffs(`${actual.type} .title`, actual.title.rect, expected.title.rect),
        [],
        `${actual.type}: the title box drifted beyond tolerance`
      );
      assert.deepEqual(
        actual.title.paintedFamilies.map((f) => f.family),
        expected.title.paintedFamilies.map((f) => f.family),
        `${actual.type}: Chrome painted the title in a different family`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// A guard on the guard
// ---------------------------------------------------------------------------

test('no measured element paints in a system fallback font', { skip }, async () => {
  // This is the assertion the whole exercise exists for, stated once directly
  // rather than only through the baselines: if the curated webfont fails to
  // load, Chrome silently paints a system face and every other metric still
  // matches. The theme's own first-choice family is the expected answer.
  const theme = await loadThemeAssets(repoRoot, 'deckyard');
  const metrics = await measureSlide(repoRoot, calibrationSlide(), { theme });

  for (const selector of MEASURED_SELECTORS) {
    const el = metrics.elements[selector];
    if (!el || !el.text) continue;
    const painted = el.paintedFamilies.map((f) => f.family);
    assert.ok(painted.length > 0, `${selector}: Chrome reported no painted font at all`);
    assert.ok(
      painted.some((family) => family.startsWith(el.requestedFamily)),
      `${selector}: requested "${el.requestedFamily}" but Chrome painted ${JSON.stringify(painted)} — ` +
        'the self-hosted webfont did not load'
    );
  }
});
