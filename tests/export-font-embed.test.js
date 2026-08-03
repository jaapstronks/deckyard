import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inlineLocalFontUrls,
  buildEmbeddedFontCss,
} from '../server/utils/embed-fonts.js';
import { buildStandaloneHtml } from '../server/export/html.js';
import { curatedFontPath } from '../shared/theme-fonts.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

/**
 * Standalone HTML export must be self-contained: a downloaded file has no
 * server to resolve `/assets/fonts/*.woff2`, so those font references must be
 * inlined as data URLs or the deck falls back to system fonts offline.
 */

/** A repo-relative woff2 that exists, or null when postinstall was skipped. */
const localFont = await (async () => {
  const rel = curatedFontPath('inter', 400, 'latin');
  try {
    await fs.access(path.join(repoRoot, rel));
    return `/${rel}`;
  } catch {
    return null; // assets/fonts/google/ is gitignored and filled by postinstall
  }
})();

const deckyardTheme = JSON.parse(
  await fs.readFile(path.join(repoRoot, 'themes', 'deckyard.json'), 'utf8')
);

test('inlineLocalFontUrls embeds a referenced local woff2 as a data URL', async (t) => {
  if (!localFont) return t.skip('fonts not downloaded in this checkout');
  const css = `@font-face {
    font-family: 'Custom Brand Face';
    src: url('${localFont}') format('woff2');
    font-weight: 700;
  }`;
  const out = await inlineLocalFontUrls(repoRoot, css);
  assert.ok(
    out.includes('data:font/woff2;base64,'),
    'referenced font should be inlined as a base64 data URL'
  );
  assert.ok(
    !out.includes('/assets/fonts/'),
    'the server-relative /assets/fonts path must be gone'
  );
  // The rest of the @font-face rule (family, format, weight) is preserved.
  assert.ok(out.includes("format('woff2')"));
  assert.ok(out.includes('font-weight: 700'));
});

test('inlineLocalFontUrls leaves an unreadable font path untouched', async () => {
  const css = `src: url('/assets/fonts/does-not-exist-xyz.woff2') format('woff2');`;
  const out = await inlineLocalFontUrls(repoRoot, css);
  assert.equal(out, css, 'a missing font file should be left as-is');
});

test('inlineLocalFontUrls ignores remote and data URLs', async () => {
  const css = `src: url('https://cdn.example/x.woff2'), url('data:font/woff2;base64,AAAA');`;
  const out = await inlineLocalFontUrls(repoRoot, css);
  assert.equal(out, css, 'non-local URLs must not be rewritten');
});

test('standalone HTML export embeds theme fonts and drops /assets/fonts references', async (t) => {
  if (!localFont) return t.skip('fonts not downloaded in this checkout');
  const pres = {
    title: 'Font embed test',
    slides: [
      { id: 's1', type: 'text-slide', content: { title: 'Hello', body: 'World' } },
    ],
  };
  const html = await buildStandaloneHtml(repoRoot, pres, { theme: deckyardTheme });
  assert.ok(
    !html.includes('/assets/fonts/'),
    'downloaded standalone HTML must not reference server-hosted font files'
  );
  assert.ok(
    html.includes('data:font/woff2;base64,'),
    "the theme's fonts must be embedded as data URLs"
  );
});

test('each distinct font file is inlined exactly once', async (t) => {
  if (!localFont) return t.skip('fonts not downloaded in this checkout');
  // The regression this guards: a curated family is pinned once per weight but
  // Google serves one *variable* file per subset, so declaring one @font-face
  // per weight base64-inlined the same blob three or four times — ~930 KB of
  // fonts in the default theme where ~250 KB is unique, in every standalone
  // HTML and every PNG/PDF render document.
  const css = await buildEmbeddedFontCss(repoRoot, deckyardTheme);
  const blobs = css.match(/data:font\/woff2;base64,[A-Za-z0-9+/=]+/g) || [];
  assert.ok(blobs.length > 0, 'the default theme should embed some fonts');
  assert.equal(
    new Set(blobs).size,
    blobs.length,
    'the same font file is base64-inlined more than once'
  );
  // Two families × two Latin subsets, each family variable across its weights.
  assert.equal(blobs.length, 4, 'the default theme should embed four distinct files');
  assert.match(
    css,
    /font-weight: 400 700;/,
    'weights that share a variable file collapse into one range'
  );
});

test('duplicate embedFonts entries collapse instead of inlining twice', async (t) => {
  if (!localFont) return t.skip('fonts not downloaded in this checkout');
  // A hand-written custom theme that lists the same file under several weights
  // gets the same treatment as a generated one — the merge is a property of the
  // embedder, not of how the list happened to be produced.
  const rel = curatedFontPath('inter', 400, 'latin');
  const theme = {
    embedFonts: [400, 500, 700].map((weight) => ({
      family: 'Repeated',
      path: rel,
      weight,
      style: 'normal',
    })),
  };
  const css = await buildEmbeddedFontCss(repoRoot, theme);
  assert.equal((css.match(/@font-face/g) || []).length, 1);
  assert.match(css, /font-weight: 400 700;/);
});
