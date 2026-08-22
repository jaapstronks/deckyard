/**
 * The exported PDF must not contain luminosity soft masks.
 *
 * The defect family: Chrome turns a *blurred* `box-shadow` (and a few other
 * effects) into a transparency group behind an `/SMask << /S /Luminosity >>`.
 * Ghostscript composites that correctly, so every measurement we took through
 * `gs` looked clean — but Apple's CoreGraphics (Preview, Quick Look, everything
 * on PDFKit) paints the group's **bounding box solid** instead. On screen that
 * is a hard dark rectangle around each element, larger than the element, with
 * the rounded corners and the shadow gone.
 *
 * Three of the four export defects reported in the week of 2026-07-27 were this
 * same construction reached by different routes: icon masks, the gradient
 * shadings (#490/#491), and the card shadows this file was added for. Counting
 * the masks catches the family instead of one symptom at a time, which is why
 * this is a count with an upper bound rather than a per-slide-type assertion.
 *
 * `00-tokens.css` already flattens the `--slide-shadow-*` tokens under
 * `@media print`, and `render/pdf.js` calls `emulateMediaType('print')`, so the
 * guard is real. What slips through are the places that set a blurred shadow
 * *without* going through those tokens; each one needs its own `@media print`
 * rule, and this test is what says so out loud when a new one appears.
 *
 * Requires a Chrome/Chromium binary — same gate as the export smoke test: skip
 * locally when none is installed, never skip in CI.
 *
 * Run with: node --test tests/export-pdf-luminosity-mask.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveChromeExecutablePath,
  closePuppeteerBrowser,
} from '../server/utils/puppeteer-browser.js';
import { renderSlidesToPdfBuffer } from '../server/render/pdf.js';
import { loadThemeAssets } from '../server/utils/themes.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());

/** Same gate as the export smoke test: skip locally without a browser, never in CI. */
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

const LUMINOSITY_RE = /\/S\s*\/Luminosity/g;

/**
 * Count `/S /Luminosity` soft-mask declarations in a PDF.
 *
 * Chrome writes the ExtGState dictionaries that carry these into **compressed
 * object streams**, so scanning the raw bytes finds nothing; the count has to
 * see inside every Flate stream. That is the whole reason the reporting fork
 * reached for `qpdf --qdf`. Doing it with `node:zlib` instead keeps the test
 * free of a system binary CI would have to provision — verified to agree with
 * `qpdf --qdf --object-streams=disable` exactly (9 and 0) on the two fixtures
 * this file was written against.
 *
 * Deliberately counts only `/S /Luminosity`. The other `/SMask` kind is image
 * alpha — an ordinary transparent PNG — which renders correctly everywhere and
 * is not what this test is about.
 *
 * @param {Buffer} pdf - The exported PDF.
 * @returns {number}
 */
function countLuminosityMasks(pdf) {
  const raw = pdf.toString('latin1');
  let count = (raw.match(LUMINOSITY_RE) || []).length;

  let cursor = 0;
  for (;;) {
    const start = raw.indexOf('stream', cursor);
    if (start < 0) break;
    // Skip the EOL that must follow the `stream` keyword (CR LF, or bare LF).
    let from = start + 'stream'.length;
    if (raw[from] === '\r') from++;
    if (raw[from] === '\n') from++;
    const end = raw.indexOf('endstream', from);
    if (end < 0) break;
    cursor = end + 'endstream'.length;
    try {
      const inflated = zlib.inflateSync(pdf.subarray(from, end));
      count += (inflated.toString('latin1').match(LUMINOSITY_RE) || []).length;
    } catch {
      // Not a Flate stream (or not a stream at all — `stream` also occurs inside
      // other text). A stream we cannot inflate carries nothing we can count.
    }
  }
  return count;
}

/** Three timeline slides on the dark background, three cards each. */
function timelineDeck() {
  return {
    title: 'Timeline op donker',
    slides: Array.from({ length: 3 }, (_, i) => ({
      id: `timeline-${i}`,
      type: 'timeline-slide',
      content: {
        title: `Tijdlijn ${i}`,
        background: 'calm',
        items: [
          { label: '2024', title: 'Start', body: 'Eerste stap' },
          { label: '2025', title: 'Groei', body: 'Tweede stap' },
          { label: '2026', title: 'Nu', body: 'Derde stap' },
        ],
      },
    })),
  };
}

test(
  'the dark timeline variant exports without luminosity masks',
  { skip },
  async () => {
    // The regression this file was added for. `86-timeline-slide.css` sets
    // `--timeline-card-shadow` to a literal blurred shadow on the dark variants —
    // the light variant uses `var(--slide-shadow-card)` and is flattened for free,
    // the dark one sets its own value (10%-black is invisible on a dark ground)
    // and so slipped past the print guard. One mask per card: this deck measured
    // **9** before the fix and **0** after, and the file halved (174 → 91 KB).
    const theme = await loadThemeAssets(repoRoot, 'amethyst');
    const pdf = await renderSlidesToPdfBuffer(repoRoot, timelineDeck(), {
      theme,
    });

    assert.equal(
      pdf.subarray(0, 5).toString('latin1'),
      '%PDF-',
      'a real PDF came back',
    );
    assert.equal(
      countLuminosityMasks(pdf),
      0,
      'a blurred box-shadow reached the PDF as a luminosity mask — CoreGraphics ' +
        'paints those as solid rectangles. Add an @media print rule that sets the ' +
        'offending shadow to none, next to its definition.',
    );
  },
);

test(
  'the shadow-carrying slide types export without luminosity masks',
  { skip },
  async () => {
    // The family bound, not a single symptom. Every slide type below sets a blurred
    // shadow outside the `--slide-shadow-*` tokens and therefore needs its own
    // `@media print` rule: poll already had one, the timeline did not, and the
    // video placeholder's `.vpdf-screen`/`.vpdf-base` live in the
    // export CSS itself (`PDF_DOC_CSS` in server/export/pdf-slides.js). A new type
    // that repeats the pattern fails here rather than in someone's Preview.
    const theme = await loadThemeAssets(repoRoot, 'amethyst');
    const deck = {
      title: 'Alles wat een schaduw draagt',
      slides: [
        // No `source`: the placeholder renders its laptop frame without a poster
        // fetch, which is exactly the part that carries the shadows.
        { id: 'v', type: 'video-slide', content: { title: 'Video' } },
        {
          id: 'p',
          type: 'poll-slide',
          content: { question: 'Welke kant op?' },
        },
        ...timelineDeck().slides,
      ],
    };
    const pdf = await renderSlidesToPdfBuffer(repoRoot, deck, { theme });

    assert.equal(
      countLuminosityMasks(pdf),
      0,
      'one of the shadow-carrying slide types leaked a luminosity mask into the PDF',
    );
  },
);

after(async () => {
  await closePuppeteerBrowser();
});
