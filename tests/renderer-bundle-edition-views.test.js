/**
 * The render entry's public views of an edition: the language version, the
 * chrome derived from the edition's address, the highlighter carried inline,
 * and the sealability rule over every language list.
 *
 * The entry runs from this checkout here (a bundle's `files/` is the same
 * tree); `tests/pg/publication-edition-reads.pgtest.js` runs it from built
 * bundles through the read path.
 *
 * Run with: node --test tests/renderer-bundle-edition-views.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { EDITION_INPUT_SCHEMA, RENDERER_BUNDLE_ERRORS } =
  await import('../server/render/renderer-bundle/index.js');
const { renderEdition, assertSealableEdition } =
  await import('../server/render/renderer-bundle/bundle/entry.js');
const { READER_IS_DEFAULT_META, declaredDefaultView } =
  await import('../server/render/renderer-bundle/default-view.js');

const repoRoot = process.cwd();
const BASE =
  'https://decks.example.test/p/11111111-2222-4333-8444-555555555555/3';

const title = (text) => ({
  id: 's1',
  type: 'title-slide',
  content: { title: text },
});
const code = {
  id: 's2',
  type: 'content-slide',
  content: { title: 'Code', body: '```js\nconst answer = 42;\n```' },
};

function input(extra = {}) {
  return {
    schema: EDITION_INPUT_SCHEMA,
    presentation: {
      title: 'Deck NL',
      lang: 'nl',
      slides: [title('Hallo'), code],
      i18n: {
        active: 'nl',
        dominant: 'nl',
        versions: {
          nl: { title: 'Deck NL', slides: [title('Hallo'), code] },
          'en-GB': { title: 'Deck EN', slides: [title('Hello'), code] },
        },
      },
    },
    theme: null,
    css: { fontCss: '' },
    metaDescription: 'A <description>',
    ...extra,
  };
}

test('renders the language version asked for, and the main list without one', async () => {
  const en = await renderEdition(repoRoot, input({ lang: 'en-GB' }));
  assert.ok(en.canvas.includes('Hello') && !en.canvas.includes('Hallo'));
  assert.ok(en.canvas.includes('<html lang="en'));
  assert.ok(en.reader.includes('Hello'));
  const main = await renderEdition(repoRoot, input());
  assert.ok(main.canvas.includes('Hallo'));
});

test('derives canonical links, card, language switch and view links from the address', async () => {
  const { canvas, reader } = await renderEdition(
    repoRoot,
    input({ canonicalUrl: BASE, lang: 'en-GB' }),
  );
  assert.ok(
    canvas.includes(`<link rel="canonical" href="${BASE}?lang=en-GB" />`),
    'the canvas names the bare address as canonical',
  );
  assert.ok(
    canvas.includes(`<meta property="og:image" content="${BASE}/og" />`),
  );
  assert.ok(canvas.includes('content="A &lt;description&gt;"'));
  assert.ok(
    canvas.includes(`href="${BASE}/slides?lang=nl"`),
    'the switch stays on the canvas',
  );
  assert.ok(canvas.includes(`href="${BASE}?lang=en-GB"`));
  assert.ok(canvas.includes('Reading view'));
  assert.ok(
    reader.includes(`<link rel="canonical" href="${BASE}?lang=en-GB" />`),
  );
  assert.ok(reader.includes(`href="${BASE}/slides?lang=en-GB"`));
  assert.ok(
    reader.includes(`class="reader-lang" href="${BASE}?lang=nl"`),
    'the switch stays on the reader',
  );

  const bare = await renderEdition(repoRoot, input());
  assert.ok(!bare.canvas.includes('rel="canonical"'), 'no address, no chrome');
});

test('the reader carries the same share card as the canvas, for its own address', async () => {
  const { canvas, reader } = await renderEdition(
    repoRoot,
    input({ canonicalUrl: BASE, lang: 'en-GB' }),
  );
  const readerUrl = `${BASE}?lang=en-GB`;
  assert.ok(
    reader.includes(`<meta property="og:url" content="${readerUrl}" />`),
  );
  assert.ok(reader.includes('<meta property="og:title" content="Deck EN" />'));
  assert.ok(
    reader.includes(`<meta property="og:image" content="${BASE}/og" />`),
  );
  assert.ok(
    reader.includes(
      '<meta name="twitter:card" content="summary_large_image" />',
    ),
  );
  assert.ok(reader.includes('content="A &lt;description&gt;"'));
  assert.ok(
    reader.includes(`<link rel="alternate" href="${BASE}/slides?lang=en-GB"`),
    'names the canvas as the other view',
  );

  const blocks = (html) =>
    [
      ...html.matchAll(
        /<script type="application\/ld\+json">(.*?)<\/script>/gs,
      ),
    ].map((m) => JSON.parse(m[1]));
  const [readerLd] = blocks(reader);
  assert.equal(readerLd['@type'], 'TextDigitalDocument');
  assert.equal(readerLd.url, readerUrl);
  assert.equal(readerLd.inLanguage, 'en-GB');
  assert.equal(blocks(canvas)[0]['@type'], 'PresentationDigitalDocument');

  // A data block is the only script: the reader still runs nothing.
  const scripts = [...reader.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
  assert.deepEqual(scripts, ['<script type="application/ld+json">']);
});

test('no value can close the share-card script block', async () => {
  const hostile = '</script><script>alert(1)</script>';
  const { canvas, reader } = await renderEdition(
    repoRoot,
    input({ canonicalUrl: BASE, metaDescription: hostile }),
  );
  for (const html of [canvas, reader]) {
    assert.ok(!html.includes(hostile));
  }
});

test('the canvas names a way out for a browser without JavaScript', async () => {
  const noscript = (html) => html.match(/<noscript>(.*?)<\/noscript>/s)?.[1];

  const en = await renderEdition(
    repoRoot,
    input({ canonicalUrl: BASE, lang: 'en-GB' }),
  );
  const out = noscript(en.canvas);
  assert.ok(out.includes('This presentation needs JavaScript to play.'));
  assert.ok(out.includes(`<a href="${BASE}?lang=en-GB" target="_top">`));
  assert.ok(out.includes('Reading view'));
  assert.equal(noscript(en.reader), undefined, 'the reader needs no way out');

  // No language in the address: the deck's own words, not the table's default.
  const nl = await renderEdition(repoRoot, input({ canonicalUrl: BASE }));
  assert.ok(noscript(nl.canvas).includes('Leesweergave'));
  assert.ok(noscript(nl.canvas).includes(`href="${BASE}"`));
  assert.ok(nl.canvas.includes(`title="Leesweergave"`));
  assert.ok(nl.reader.includes('title="Bekijk de dia'));

  const bare = await renderEdition(repoRoot, input());
  assert.equal(noscript(bare.canvas), undefined, 'no address, no way out');
});

test('the bundle declares the reader as what the bare address answers', async () => {
  const { reader, canvas } = await renderEdition(
    repoRoot,
    input({ canonicalUrl: BASE }),
  );
  assert.equal(declaredDefaultView(reader), 'reader');
  assert.equal(declaredDefaultView(canvas), 'canvas', 'only a reader declares');
  assert.equal(
    declaredDefaultView(reader.replace(READER_IS_DEFAULT_META, '')),
    'canvas',
    'a bundle from before the declaration keeps the canvas there',
  );
  assert.equal(
    declaredDefaultView(`<head></head><body>${READER_IS_DEFAULT_META}</body>`),
    'canvas',
    'text in the body declares nothing',
  );
});

test('a #slide=N link for the canvas lands on that section of the reader, without script', async () => {
  const { reader, canvas } = await renderEdition(
    repoRoot,
    input({ canonicalUrl: BASE }),
  );
  const target = (n) =>
    reader.match(new RegExp(`<section id="slide-${n + 1}"[^>]*>\\s*(.*)`))[1];
  assert.equal(target(0), '<span id="slide=0"></span>');
  assert.equal(target(1), '<span id="slide=1"></span>');
  assert.equal(
    [...canvas.matchAll(/<section class="deck-slide"/g)].length,
    2,
    'the canvas counts the same slides',
  );
});

test('the reader has a language switch only with versions to switch between', async () => {
  const pres = { title: 'Deck', lang: 'en', slides: [title('One')] };
  const single = await renderEdition(repoRoot, {
    ...input({ canonicalUrl: BASE }),
    presentation: pres,
  });
  assert.ok(!single.reader.includes('class="reader-langs"'));
  const { reader } = await renderEdition(
    repoRoot,
    input({ canonicalUrl: BASE, lang: 'nl' }),
  );
  assert.ok(reader.includes('class="reader-langs"'));
  assert.ok(reader.includes('aria-current="true"'));
});

test('carries Prism inline instead of linking the installation', async () => {
  const { canvas } = await renderEdition(repoRoot, input());
  assert.ok(canvas.includes('md-code-block'));
  assert.ok(!/<(script|link)[^>]+\/client\/vendor\/prism/.test(canvas));
  assert.ok(/Prism/.test(canvas), 'the Prism bytes are in the document');
});

test('renders markdown as markup, the same as the live page, and injection as text', async () => {
  const body = [
    'Plain **bold** text.',
    '',
    '- one',
    '- two',
    '',
    '```js',
    'if (a < b) {}',
    '```',
    '',
    '<script>alert(1)</script> <img src=x onerror=alert(1)>',
    '[x](javascript:alert(1)) [y](https://a.test/" onmouseover="alert(1))',
  ].join('\n');
  const slide = {
    id: 'md',
    type: 'content-slide',
    content: { title: 'M', body },
  };
  const pres = { title: 'Deck', lang: 'en', slides: [slide] };
  const { canvas, reader } = await renderEdition(repoRoot, {
    ...input(),
    presentation: pres,
  });

  // The live page renders the slide in a process that initialised DOMPurify;
  // the edition renders it without one. Both must be the same markup.
  const { initSanitizer } = await import('../shared/sanitize.js');
  await initSanitizer();
  const { markdownToSafeHtml } = await import('../shared/markdown.js');
  const { renderSlideHtml } = await import('../shared/slide-types.js');
  const markup = markdownToSafeHtml(body);
  assert.ok(renderSlideHtml(slide, {}).includes(markup), 'live carries it');
  assert.ok(canvas.includes(markup), 'the edition carries the same markup');

  for (const html of [canvas, reader]) {
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<ul dir="auto"><li dir="auto">one<\/li>/);
    assert.match(html, /<pre class="md-code-block" data-lang="js"/);
    assert.ok(html.includes('if (a &lt; b) {}'));
    assert.ok(!html.includes('&lt;pre'), 'no markup shown as text');
    assert.ok(!html.includes('<script>alert'), 'no script element');
    assert.ok(!/<img[^>]*onerror/.test(html), 'no handler attribute');
    assert.ok(!html.includes('href="javascript:'), 'no script URL');
    assert.ok(!/<a [^>]*onmouseover/.test(html), 'no attribute breakout');
  }
});

test('refuses an unsealable slide in any language list, naming the list', () => {
  const pres = input().presentation;
  pres.i18n.versions['en-GB'].slides.push({ id: 'x', type: 'db-only-type' });
  assert.throws(
    () => assertSealableEdition(pres),
    (err) =>
      err.code === RENDERER_BUNDLE_ERRORS.UNSEALABLE_INPUT &&
      err.details.lang === 'en-GB' &&
      err.details.type === 'db-only-type',
  );
});

test('refuses a language that is not one', async () => {
  await assert.rejects(
    renderEdition(repoRoot, input({ lang: '<script>' })),
    (err) => err.code === RENDERER_BUNDLE_ERRORS.INPUT_INVALID,
  );
});
