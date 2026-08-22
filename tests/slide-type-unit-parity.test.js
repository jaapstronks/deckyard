/**
 * The fluid type unit is exactly 1 reference pixel — on every slide type.
 *
 * `client/styles/slides/00-tokens.css` derives the type scale from the slide's
 * own box: `(100cqi + 2 * var(--slide-padding)) / 1600`. Container query units
 * resolve against the *content* box, so that expression only reconstructs the
 * border box while `--slide-padding` tells the truth about the inline padding
 * the slide root actually carries. A type that zeroes or tightens its frame
 * with a bare `padding` declaration breaks the reconstruction silently, and
 * every piece of text on it renders a few percent off — which is what happened
 * to `title-slide` (`padding: 0`, 64px still claimed) while this was written.
 *
 * A syntactic gate cannot see that: the padding is a cascade result, not a
 * declaration. So this measures it. Each registered type renders through the
 * real PNG export document at 1600×900 and a probe inside the slide reports
 * what `--slide-text-base` computes to. It must be 20px — the value the px
 * scale had before it went fluid, on every type, which is also the export
 * parity check (PDF and PNG share this document).
 *
 * Run with: node --test tests/slide-type-unit-parity.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initSanitizer } from '../shared/sanitize.js';
await initSanitizer();

import {
  resolveChromeExecutablePath,
  getPuppeteerBrowser,
  closePuppeteerBrowser,
} from '../server/utils/puppeteer-browser.js';
import { buildSlidePngHtml } from '../server/render/png.js';
import { SLIDE_TYPES, newSlide } from '../shared/slide-types.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const skip =
  !isCi && !chromePath
    ? 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH'
    : false;

/** The reference canvas the px scale was drawn against. */
const FRAME = { width: 1600, height: 900 };
/** `--slide-text-base` before the scale went fluid. */
const REFERENCE_BASE_PX = 20;

test(
  'every slide type resolves the type unit to one reference pixel',
  { skip },
  async (t) => {
    const browser = await getPuppeteerBrowser({
      featureName: 'slide type unit parity',
    });
    t.after(() => closePuppeteerBrowser());

    const page = await browser.newPage();
    await page.setViewport({ ...FRAME, deviceScaleFactor: 1 });

    const off = [];
    for (const type of Object.keys(SLIDE_TYPES)) {
      const html = await buildSlidePngHtml(repoRoot, newSlide({ type }));
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      const measured = await page.evaluate(() => {
        const slide = document.querySelector('.slide');
        if (!slide) return null;
        // A probe inside the slide, because a query container is queried by
        // its descendants and never by itself.
        const probe = document.createElement('span');
        probe.style.fontSize = 'var(--slide-text-base)';
        probe.style.position = 'absolute';
        probe.textContent = 'x';
        slide.appendChild(probe);
        const px = parseFloat(getComputedStyle(probe).fontSize);
        probe.remove();
        return px;
      });

      if (measured === null) {
        off.push(`${type}: rendered no .slide element`);
        continue;
      }
      // Sub-pixel slack only: this is arithmetic, not layout.
      if (Math.abs(measured - REFERENCE_BASE_PX) > 0.05) {
        off.push(
          `${type}: --slide-text-base is ${measured}px, expected ${REFERENCE_BASE_PX}px`,
        );
      }
    }

    await page.close();

    assert.deepEqual(
      off.sort(),
      [],
      `${off.length} slide type(s) size their text against the wrong box.\n` +
        'Almost always: the slide root sets its own `padding` without stating ' +
        'the inline inset as `--slide-padding`, so the border-box ' +
        'reconstruction in 00-tokens.css § THE FLUID BASIS is off by that ' +
        'difference.',
    );
  },
);
