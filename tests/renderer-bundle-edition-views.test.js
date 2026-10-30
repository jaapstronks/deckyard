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

test('derives canonical links, card, language switch and reader link from the address', async () => {
  const { canvas, reader } = await renderEdition(
    repoRoot,
    input({ canonicalUrl: BASE, lang: 'en-GB' }),
  );
  assert.ok(
    canvas.includes(`<link rel="canonical" href="${BASE}?lang=en-GB" />`),
  );
  assert.ok(
    canvas.includes(`<meta property="og:image" content="${BASE}/og" />`),
  );
  assert.ok(canvas.includes('content="A &lt;description&gt;"'));
  assert.ok(canvas.includes(`href="${BASE}?lang=nl"`), 'switch to Dutch');
  assert.ok(canvas.includes(`href="${BASE}/reader?lang=en-GB"`));
  assert.ok(canvas.includes('Reading view'));
  assert.ok(
    reader.includes(
      `<link rel="canonical" href="${BASE}/reader?lang=en-GB" />`,
    ),
  );
  assert.ok(reader.includes(`href="${BASE}?lang=en-GB"`));

  const bare = await renderEdition(repoRoot, input());
  assert.ok(!bare.canvas.includes('rel="canonical"'), 'no address, no chrome');
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
