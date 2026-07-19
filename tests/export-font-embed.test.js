import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineLocalFontUrls } from '../server/utils/embed-fonts.js';
import { buildStandaloneHtml } from '../server/export/html.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

/**
 * Standalone HTML export must be self-contained: a downloaded file has no
 * server to resolve `/assets/fonts/*.woff2`, so those font references must be
 * inlined as data URLs or the deck falls back to system fonts offline.
 */

test('inlineLocalFontUrls embeds a referenced local woff2 as a data URL', async () => {
  const css = `@font-face {
    font-family: 'Bricolage Grotesque';
    src: url('/assets/fonts/BricolageGrotesque-700.woff2') format('woff2');
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

test('standalone HTML export inlines fonts and drops /assets/fonts references', async () => {
  const pres = {
    title: 'Font embed test',
    slides: [
      { id: 's1', type: 'text-slide', content: { title: 'Hello', body: 'World' } },
    ],
  };
  const html = await buildStandaloneHtml(repoRoot, pres, { theme: null });
  assert.ok(
    !html.includes('/assets/fonts/'),
    'downloaded standalone HTML must not reference server-hosted font files'
  );
  assert.ok(
    html.includes('data:font/woff2;base64,'),
    'the shared UI font must be embedded as a data URL'
  );
});
