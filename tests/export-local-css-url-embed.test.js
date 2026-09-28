/**
 * Local `url(...)` in the export HTML, and what a dead remote image becomes.
 *
 * Both defects were found by re-rendering a real 78-page deck (the CIIIC
 * midterm review) and looking at the PDF instead of at the tests:
 *
 *   1. Every `icon-card-grid-slide` showed a solid dark square where its icon
 *      belongs. The icon is not an `<img>` but a CSS mask, passed as
 *      `style="--icg-icon-url:url(/client/vendor/lucide-icons/<name>.svg)"`.
 *      The export embeds `src="…"` and *remote* `url(…)`, never a local one, and
 *      the document reaches headless Chrome through `setContent()` — no base
 *      URL, so a root-relative path resolves nowhere. The mask never loaded and
 *      the chip rendered as its bare `background-color`.
 *
 *   2. Two portraits on a team-cards slide had been deleted at the CDN. The
 *      failed fetch left `src=""`, which a browser resolves against the
 *      document, fails, and draws its broken-image glyph plus alt text for —
 *      baked into the PDF.
 *
 * Run with: node --test tests/export-local-css-url-embed.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSlidesPdfHtml } from '../server/export/pdf-slides.js';
import {
  embedImgSrcDataUrls,
  embedLocalCssUrls,
} from '../server/utils/html-utils.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test('an icon-card-grid slide carries its icons as data URLs in the PDF export', async () => {
  const pres = {
    title: 'Icons',
    slides: [
      {
        id: 's1',
        type: 'icon-card-grid-slide',
        content: {
          title: 'Four things',
          items: [
            { icon: 'lightbulb', title: 'One', body: 'First' },
            { icon: 'activity', title: 'Two', body: 'Second' },
          ],
        },
      },
    ],
  };

  const html = await buildSlidesPdfHtml(repoRoot, pres, {});

  assert.ok(
    !/url\(\s*['"]?\/client\//.test(html),
    'no icon may still point at a path that headless Chrome cannot resolve',
  );
  assert.ok(
    html.includes('data:image/svg+xml;base64,'),
    'the icon SVGs must be inlined as data URLs',
  );
});

test('a local url() outside the asset roots is left alone', async () => {
  // Widening *where* an asset may be referenced from must not widen *which*
  // files can be read: the roots are the same allow-list as the <img src> pass.
  const html = `<span style="--x:url(/etc/passwd)"></span>`;
  const out = await embedLocalCssUrls(repoRoot, html);
  assert.equal(out, html);
});

test('a local url() traversing out of an asset root is left alone', async () => {
  const html = `<span style="--x:url(/assets/../../../etc/passwd)"></span>`;
  const out = await embedLocalCssUrls(repoRoot, html);
  assert.equal(out, html);
});

test('under /client/ only the vendored icon SVGs inline (B261)', async () => {
  // The renderer emits icon URLs itself, so every export carries them; the
  // rest of the client tree is code, and a url() naming it stays as written.
  const icon = `<span style="--icg-icon-url:url(/client/vendor/lucide-icons/activity.svg)"></span>`;
  const inlined = await embedLocalCssUrls(repoRoot, icon);
  assert.ok(inlined.includes('data:image/svg+xml;base64,'));

  const code = `<span style="--x:url(/client/lib/dom.js)"></span>`;
  assert.equal(await embedLocalCssUrls(repoRoot, code), code);
  const img = `<img src="/client/lib/dom.js">`;
  assert.equal(await embedImgSrcDataUrls(repoRoot, img), img);
});

test('a remote image that cannot be fetched becomes a blank pixel, not a dead src', async () => {
  // 169.254.169.254 is refused by the SSRF guard, which is the same code path a
  // 404 takes: the embed comes back empty.
  const html = '<img src="http://169.254.169.254/gone.jpg" alt="Someone">';
  const out = await embedImgSrcDataUrls(repoRoot, html, { embedRemote: true });

  assert.ok(!out.includes('169.254.169.254'), 'the dead URL must not survive');
  assert.ok(
    !/src=""/.test(out),
    'an empty src resolves to the document and draws a broken-image glyph',
  );
  assert.ok(
    out.includes('data:image/png;base64,'),
    'it becomes a transparent pixel',
  );
});
