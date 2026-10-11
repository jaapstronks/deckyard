/**
 * The PPTX export paints with the deck's theme, not with one fork's brand
 * (B656).
 *
 * The video placeholder set a fixed lime or mist as the slide's ground — the
 * two CIIIC hexes — whatever theme the deck wore, and wrote fixed dark greys on
 * top. The theme master kept a second copy of the `--slide-accent` default.
 * Same class as B640 (slide CSS) and B648 (`shared/`), but under `server/`,
 * where neither guard looked.
 *
 * Pinned here: the placeholder's ground and text follow the theme on a light
 * and a dark ground, no CIIIC hex survives under `server/export/`, and the
 * accent default is spelled once in JS.
 *
 * Run with: node --test tests/export-pptx-brand-colors.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

import { buildPptxBuffer } from '../server/export/pptx.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** The first slide's XML for one video slide under `theme`. */
async function videoSlideXml(theme, content) {
  const pres = {
    title: 'Deck',
    lang: 'en-GB',
    slides: [
      {
        id: 'v1',
        type: 'video-slide',
        content: { source: YOUTUBE, ...content },
      },
    ],
  };
  const { buffer } = await buildPptxBuffer('.', pres, { scale: 1, theme });
  const zip = await JSZip.loadAsync(Buffer.from(buffer));
  return zip.file('ppt/slides/slide1.xml').async('string');
}

/** The slide's own background colour. */
function groundOf(xml) {
  const m = xml.match(/<p:bg>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"/);
  assert.ok(m, 'the slide carries a solid background');
  return m[1].toUpperCase();
}

/** The colour of the run that carries `text`. */
function runColor(xml, text) {
  const runs = [...xml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)].map((m) => m[1]);
  const run = runs.find((r) => r.includes(`<a:t>${text}</a:t>`));
  assert.ok(run, `a run reads "${text}"`);
  const m = run.match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/);
  assert.ok(m, `the run "${text}" has a colour`);
  return m[1].toUpperCase();
}

const light = {
  cssVars: {
    '--t-slide-bg-lime': '#f4efe6',
    '--t-slide-bg-mist': '#e9eef2',
    '--t-color-text': '#1d2430',
    '--t-color-text-muted': '#5a6270',
  },
};
const dark = {
  cssVars: {
    '--t-slide-bg-lime': '#0e1726',
    '--t-slide-bg-mist': '#18233a',
    '--t-slide-bg-mist-text': '#f2f4f8',
    '--t-color-text': '#f2f4f8',
  },
};

// ------------------------------------------------------- the placeholder

test('a light theme: the default mist ground and its text colour', async () => {
  const xml = await videoSlideXml(light, { title: 'Launch film' });
  assert.equal(groundOf(xml), 'E9EEF2');
  assert.equal(runColor(xml, 'Launch film'), '1D2430');
});

test('a dark theme: the lime ground the slide asks for, and light text', async () => {
  const xml = await videoSlideXml(dark, {
    title: 'Launch film',
    background: 'lime',
  });
  assert.equal(groundOf(xml), '0E1726');
  assert.equal(runColor(xml, 'Launch film'), 'F2F4F8');
});

// ------------------------------------------------------------- the guards

/** Every `.js` file under `dir`, recursively. */
function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no CIIIC brand hex survives under server/export/', () => {
  // Spelled in halves so this file is not itself a hit.
  const banned = ['db' + 'ff00', 'e8' + 'f0f0', '38' + '5c5c', '37' + '5c5d'];
  const offenders = [];
  for (const file of jsFiles(join(ROOT, 'server', 'export'))) {
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const hex of banned) {
      if (text.includes(hex)) offenders.push(`${relative(ROOT, file)}: ${hex}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `the export paints with the theme, not a fork's colours:\n${offenders.join('\n')}`,
  );
});

test('the --slide-accent default is spelled once in JS', () => {
  const hex = '#38' + '5c5c';
  const hits = [
    ...jsFiles(join(ROOT, 'shared')),
    ...jsFiles(join(ROOT, 'server')),
  ]
    .filter((file) => readFileSync(file, 'utf8').toLowerCase().includes(hex))
    .map((file) => relative(ROOT, file));
  assert.deepEqual(hits, ['shared/constants/themes.js']);
});
