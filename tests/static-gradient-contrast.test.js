import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { buildThemeConfig } from '../server/utils/theme-builder.js';
import { normalizeTheme } from '../shared/theme-normalize.js';
import { buildSlidePngHtml } from '../server/render/png.js';
import { buildSlidesPdfHtml } from '../server/export/pdf-slides.js';
import { STATIC_GRADIENT_CSS } from '../server/utils/static-gradient-css.js';
import { getContrastRatio } from '../shared/color-utils.js';
import {
  getPuppeteerBrowser,
  resolveChromeExecutablePath,
  closePuppeteerBrowser,
  toNodeBuffer,
} from '../server/utils/puppeteer-browser.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const skip =
  (await resolveChromeExecutablePath()) || process.env.CI
    ? false
    : 'Chrome required';
after(closePuppeteerBrowser);

// Core-owned records, with the reported lime ground and a dark counterpart.
const seed = JSON.parse(
  await fs.readFile(new URL('../themes/playful.json', import.meta.url)),
);
function fixture(background) {
  const record = structuredClone(seed);
  record.logoUrl = '';
  record.colors.background = background;
  record.colors.textDark = '#212121';
  record.colors.textMuted =
    background === '#e2fe52' ? 'rgba(33,33,33,0.65)' : 'rgba(255,255,255,0.72)';
  record.config.gradient.enabled = true;
  record.config.cssVarOverrides = {};
  return normalizeTheme(buildThemeConfig(record));
}

function slide(layout) {
  return {
    id: `contrast-${layout}`,
    type: 'icon-card-grid-slide',
    content: {
      title: 'Readable cards',
      subheading: 'Readable subheading',
      layout,
      items: [{ icon: 'target', title: 'Focus', body: 'Example', link: '' }],
    },
  };
}

function rgbHex(channels) {
  return (
    '#' +
    channels.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')
  );
}

async function measure(page, html, animationTime = 0) {
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((time) => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = time;
    }
  }, animationTime);
  const text = await page.evaluate(() => {
    return ['.header .title', '.header .subheading'].map((selector) => {
      const el = document.querySelector(selector);
      const rect = el.getBoundingClientRect();
      const color = getComputedStyle(el)
        .color.match(/[\d.]+/g)
        .map(Number);
      // Hide only glyphs, leaving every painted background and overlay in place.
      el.style.visibility = 'hidden';
      return {
        color,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    });
  });
  const { data, info } = await sharp(toNodeBuffer(await page.screenshot()))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return text.map(({ color, x, y, width, height }) => {
    let min = Infinity;
    for (const fx of [0.1, 0.5, 0.9]) {
      for (const fy of [0.2, 0.8]) {
        const offset =
          (Math.floor(y + height * fy) * info.width +
            Math.floor(x + width * fx)) *
          info.channels;
        const bg = [...data.subarray(offset, offset + 3)];
        const alpha = color[3] ?? 1;
        const fg = bg.map((v, i) => color[i] * alpha + v * (1 - alpha));
        min = Math.min(min, getContrastRatio(rgbHex(fg), rgbHex(bg)));
      }
    }
    return min;
  });
}

for (const background of ['#e2fe52', '#18181b']) {
  for (const layout of ['cards', 'tiles']) {
    test(
      `${background} ${layout}: header contrast in PNG, PDF and live gradient`,
      { skip },
      async (t) => {
        const theme = fixture(background);
        const one = slide(layout);
        const png = await buildSlidePngHtml(repoRoot, one, { theme });
        assert.ok(png.includes(STATIC_GRADIENT_CSS));
        const pdf = await buildSlidesPdfHtml(
          repoRoot,
          { title: 'Contrast', slides: [one] },
          { theme },
        );
        assert.ok(pdf.includes(STATIC_GRADIENT_CSS));
        const browser = await getPuppeteerBrowser();
        const page = await browser.newPage();
        try {
          await page.setViewport({
            width: 1600,
            height: 1000,
            deviceScaleFactor: 1,
          });
          // The live document uses the same slide and theme CSS without the static gate.
          for (const [surface, html, time] of [
            ['PNG/PPTX', png],
            ['PDF', pdf],
            ...[0, 47500, 95000].map((time) => [
              `live at ${time}ms`,
              png.replace(STATIC_GRADIENT_CSS, ''),
              time,
            ]),
          ]) {
            const ratios = await measure(page, html, time);
            t.diagnostic(
              `${surface}: title ${ratios[0].toFixed(2)}, subheading ${ratios[1].toFixed(2)}`,
            );
            for (const ratio of ratios)
              assert.ok(ratio >= 4.5, `${surface}: contrast ${ratio} < 4.5`);
          }
        } finally {
          await page.close();
        }
      },
    );
  }
}
