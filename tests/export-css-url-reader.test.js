import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSlidesPdfHtml } from '../server/export/pdf-slides.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import {
  renderSlideHtml,
  newSlide,
} from '../shared/slide-types/presentation.js';
import { embedImgSrcDataUrls } from '../server/utils/html-utils.js';

/**
 * DY-865: the export's `url(...)` safety net reads CSS, not the document. A
 * title, a body, an alt text, an image field or a background whose *text*
 * holds `url(https://host/?d=deck-text)` must not make the export fetch that
 * address server-side; a real remote background in a style attribute still
 * gets inlined through the SSRF guard.
 */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

// An IP literal: the guard resolves no DNS for it, and fetch is stubbed.
const HOST = '93.184.216.34';
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let fetched = [];
let realFetch;
beforeEach(() => {
  fetched = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    if (!String(url).includes(HOST)) return new Response('', { status: 404 });
    return new Response(PIXEL, { headers: { 'content-type': 'image/png' } });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const fetchedFromHost = () => fetched.filter((u) => u.includes(HOST));

const INNER = `url(https://${HOST}/c?d=deck-text)`;

const TEXT_CASES = [
  ['title', 'content-slide', { title: `Results ${INNER}` }],
  ['body', 'content-slide', { body: `See ${INNER}` }],
  ['image field', 'image-slide', { image: `/u/${INNER}` }],
  ['background', 'content-slide', { slideBgImage: `/u/${INNER}` }],
  ['background, bare', 'content-slide', { slideBgImage: `x ${INNER}` }],
];

for (const [name, type, content] of TEXT_CASES) {
  test(`PDF export fetches nothing for url() in the ${name} (DY-865)`, async () => {
    const pres = {
      title: 'DY-865',
      slides: [{ id: 's1', type, content: { title: 'T', ...content } }],
    };
    await buildSlidesPdfHtml(repoRoot, pres, {});
    assert.deepEqual(fetchedFromHost(), []);
  });
}

test('PDF/PNG export pass fetches nothing for url() in the alt text (DY-865)', async () => {
  // Rendered and passed the way the export does it; an image-slide with a
  // local image would start Chrome for the size measurement in the PDF build.
  const slide = newSlide({ type: 'image-slide', slideTypes: SLIDE_TYPES });
  Object.assign(slide.content, { image: '/uploads/a.png', alt: INNER });
  const html = renderSlideHtml(slide, {
    slideTypes: SLIDE_TYPES,
    stripEditorAttrs: true,
  });
  assert.ok(html.includes(`alt="${INNER}"`), 'the alt text is rendered');
  await embedImgSrcDataUrls(repoRoot, html, {
    embedRemote: true,
    cache: new Map(),
  });
  assert.deepEqual(fetchedFromHost(), []);
});

test('url() in text and in a non-CSS attribute stays text, unfetched', async () => {
  const html = `<h1 title="${INNER}">Results ${INNER}</h1><img src="/uploads/a.png" alt="${INNER}">`;
  const out = await embedImgSrcDataUrls(repoRoot, html, {
    embedRemote: true,
  });
  assert.deepEqual(fetchedFromHost(), []);
  assert.equal((out.match(/url\(https:/g) || []).length, 3);
});

test('a remote background in a style attribute is still inlined', async () => {
  const html = `<div style="background-image:url('https://${HOST}/bg.png')">x</div>`;
  const out = await embedImgSrcDataUrls(repoRoot, html, {
    embedRemote: true,
  });
  assert.deepEqual(fetchedFromHost(), [`https://${HOST}/bg.png`]);
  assert.ok(out.includes("url('data:image/png;base64,"), out);
  assert.ok(!out.includes(HOST));
});

test('a style attribute is read decoded, as the browser reads it', async () => {
  // `&quot;` and `&#x75;` decode before CSS sees the value, and `\75 rl(` is
  // `url(` to CSS; the old regex over the raw string missed all three and left
  // a live remote url() for Chrome.
  const html = `<div style="background:url(&quot;https://${HOST}/q.png&quot;)"></div><p style="background:&#x75;rl(https://${HOST}/e.png)"></p><i style="background:\\75 rl(https://${HOST}/x.png)"></i>`;
  const out = await embedImgSrcDataUrls(repoRoot, html, {
    embedRemote: true,
  });
  assert.deepEqual(fetchedFromHost().sort(), [
    `https://${HOST}/e.png`,
    `https://${HOST}/q.png`,
    `https://${HOST}/x.png`,
  ]);
  assert.ok(!out.includes(HOST), out);
});

test('<style> text and SVG presentation attributes are CSS', async () => {
  const html = `<style>.a{background:url(https://${HOST}/s.png)}</style><svg><rect fill="url(https://${HOST}/f.png)"/></svg>`;
  const out = await embedImgSrcDataUrls(repoRoot, html, {
    embedRemote: true,
  });
  assert.deepEqual(fetchedFromHost().sort(), [
    `https://${HOST}/f.png`,
    `https://${HOST}/s.png`,
  ]);
  assert.ok(!out.includes(HOST), out);
});

test('a local url() in text is not inlined; in a style attribute it is', async () => {
  const icon = '/client/vendor/lucide-icons/star.svg';
  const html = `<p>See url(${icon})</p><span style="--i:url(${icon})"></span>`;
  const out = await embedImgSrcDataUrls(repoRoot, html);
  assert.ok(out.includes(`<p>See url(${icon})</p>`), out);
  assert.ok(
    /<span style="--i:url\('data:image\/svg\+xml;base64,/.test(out),
    out,
  );
});

test('markup outside the CSS is left byte for byte', async () => {
  const html = `<div  class=a style='color:red'>a &amp; b</div><div style="x:url(https://${HOST}/b.png)">c</div>`;
  const out = await embedImgSrcDataUrls(repoRoot, html, {
    embedRemote: true,
  });
  assert.ok(
    out.startsWith(
      `<div  class=a style='color:red'>a &amp; b</div><div style="x:url('data:`,
    ),
    out,
  );
  assert.ok(out.endsWith('\')">c</div>'), out);
});

test('a rewritten style attribute keeps its other quotes encoded', async () => {
  const html = `<p style="font-family:&quot;A B&quot;;background:url(https://${HOST}/b.png)">x</p>`;
  const out = await embedImgSrcDataUrls(repoRoot, html, {
    embedRemote: true,
  });
  assert.match(
    out,
    /^<p style="font-family:&quot;A B&quot;;background:url\(&#039;data:image\/png;base64,[^"]+&#039;\)">x<\/p>$/,
  );
});

for (const [name, html] of [
  ['SVG label', `<svg aria-label="${INNER}" data-note="${INNER}"></svg>`],
  ['MathML text', `<math data-note="${INNER}" alttext="${INNER}"></math>`],
  [
    'inert template',
    `<template><style>p{background:${INNER}}</style><i style="background:${INNER}"></i></template>`,
  ],
]) {
  test(`${name} is preserved without a server fetch`, async () => {
    const out = await embedImgSrcDataUrls(repoRoot, html, {
      embedRemote: true,
    });
    assert.deepEqual(fetchedFromHost(), []);
    assert.equal(out, html);
  });
}

for (const value of [
  `url(https://${HOST}/eof`,
  `url('https://${HOST}/eof'`,
  `url('https://${HOST}/eof`,
  `url&#40https://${HOST}/eof)`,
  `url&#x28https://${HOST}/eof)`,
]) {
  test(`browser-loadable CSS is embedded: ${value}`, async () => {
    const out = await embedImgSrcDataUrls(
      repoRoot,
      `<div style="background:${value}"></div>`,
      { embedRemote: true },
    );
    assert.deepEqual(fetchedFromHost(), [`https://${HOST}/eof`]);
    assert.ok(!out.includes(HOST), out);
  });
}

// Active controls pin both the remote fetch and the local file-read pass.
for (const namespace of ['html', 'svg']) {
  for (const type of [
    null,
    '',
    'text/css',
    'TEXT/CSS',
    'text/plain',
    'text/less',
    ' text/css',
    'text/css ',
    'text/css;charset=utf-8',
  ]) {
    test(`${namespace} style type ${JSON.stringify(type)} controls CSS embedding`, async () => {
      const active =
        type === null || type === '' || type.toLowerCase() === 'text/css';
      const remote = `https://${HOST}/typed.png`;
      const local = '/client/vendor/lucide-icons/star.svg';
      const style = `<style${type === null ? '' : ` type="${type}"`}>.x{background:url(${remote});mask:url(${local})}</style>`;
      const html =
        namespace === 'svg'
          ? `<svg>${style}<rect class="x" /></svg>`
          : `${style}<div class="x">x</div>`;
      const out = await embedImgSrcDataUrls(repoRoot, html, {
        embedRemote: true,
        cache: new Map(),
      });
      assert.deepEqual(fetchedFromHost(), active ? [remote] : []);
      if (active) {
        assert.ok(out.includes('data:image/png;base64,'), out);
        assert.ok(out.includes('data:image/svg+xml;base64,'), out);
        assert.ok(!out.includes(remote) && !out.includes(local), out);
      } else {
        assert.equal(
          out,
          html,
          'inert text, including its local URL, stays byte for byte',
        );
      }
    });
  }
}
