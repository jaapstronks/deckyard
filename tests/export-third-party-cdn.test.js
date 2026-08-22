/**
 * The output gate: no render path reaches a third-party origin.
 *
 * Deckyard's rule is that a document it renders loads everything from this
 * server (or from inside itself) — see `docs/reference/no-third-party-origins.md`.
 * This file checks the *output*: it builds every path in the render-path
 * register from one deck that carries both a code block and a formula — the
 * two things that make a path load a library at all — and reads back which
 * hosts the resulting documents name.
 *
 * It used to build two of the eight paths — the two that already respected the
 * rule — while print, PDF, PNG and the single-slide render each pulled 14 files
 * from jsDelivr on every export (B102). Reading the list from
 * `server/render-paths.js` is what makes "add a ninth render path" and "forget
 * the rule in the ninth render path" different commits.
 *
 * The companion gate is `tests/no-third-party-origins.test.js`, which greps the
 * *source* — it catches a new offender the day it is written, without needing a
 * deck that triggers it.
 *
 * Run with: node --test tests/export-third-party-cdn.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStandaloneHtml } from '../server/export/html.js';
import { renderEmbedHtmlDocument } from '../server/utils/embed-html/template.js';
import {
  buildPrismKatexTags,
  detectPrismKatexNeeds,
} from '../server/utils/prism-katex.js';
import { RENDER_PATHS, buildAllRenderPaths } from '../server/render-paths.js';
import { closePuppeteerBrowser } from '../server/utils/puppeteer-browser.js';
import { initSanitizer } from '../shared/sanitize.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

// Markdown rendering runs through DOMPurify; without this the sanitizer falls
// back to escaping and no real code/math markup is produced.
await initSanitizer();

// The PDF path measures its gradients in a real browser and keeps that instance
// cached for the next caller.
after(closePuppeteerBrowser);

function deck(slides) {
  return { id: 'd', title: 'T', theme: 'default', slides };
}

function contentSlide(body, id = 's') {
  return { id, type: 'content-slide', content: { title: 'T', body } };
}

const codeBlock = (lang) => ['```' + lang, 'x = 1', '```'].join('\n');

/**
 * Hosts a rendered document may legitimately name, and why.
 *
 * Every entry is a documented carve-out, not a tolerated leftover: adding one
 * is a decision about the rule, so it belongs here in prose rather than in a
 * regex that quietly widens.
 */
const ALLOWED_HOSTS = {
  'www.w3.org':
    'XML namespace URIs (SVG, XHTML) — an identifier, never fetched',
  'assets.mediadelivery.net':
    'the Bunny player.js seam: a *lazy* loader the runtime only injects when a ' +
    'reader plays a video slide, documented in docs/reference/video-slides.md',
  'fonts.googleapis.com':
    'the font seam carve-out (docs/reference/font-management.md) — only ' +
    'emitted when a theme names a managed font',
  'fonts.gstatic.com': 'same font seam: the file host behind fonts.googleapis',
};

/**
 * Does the document actually carry (or link) the library?
 *
 * Deliberately not `/prism/i`: the core slide CSS styles Prism's token classes
 * and says so in its comments, so the library's *name* appears in every export.
 * These two markers appear only in the vendored files themselves.
 */
const carriesPrism = (html) =>
  /\/client\/vendor\/prism\//.test(html) ||
  /Prism\.languages\.markup=/.test(html);
const carriesKatex = (html) =>
  /\/client\/vendor\/katex\//.test(html) || /KaTeX_Main/.test(html);

/** Every distinct host an `http(s)://` URL in the document points at. */
function hostsIn(html) {
  const hosts = new Set();
  for (const m of String(html).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
    hosts.add(m[1].toLowerCase());
  }
  return [...hosts];
}

test('no render path reaches a third-party origin', async (t) => {
  // One deck that trips every conditional loader there is.
  const documents = await buildAllRenderPaths(
    repoRoot,
    deck([
      // The formula needs a paragraph of its own — `$$…$$` trailing a sentence
      // is inert text, and an inert fixture is how this gate would pass for
      // the wrong reason.
      contentSlide(`${codeBlock('python')}\n\n$$e^{i\\pi} + 1 = 0$$`, 'a'),
      contentSlide('Second slide, nothing special', 'b'),
    ]),
  );
  assert.equal(
    Object.keys(documents).length,
    RENDER_PATHS.length,
    'buildAllRenderPaths skipped a path',
  );

  // Non-vacuity: if the fixture stopped producing code/math markup, every path
  // below would load nothing at all and pass for the wrong reason. These are
  // the canvas paths that project the rendered slides server-side — the reader
  // re-projects them without a highlight chain, and the embed renders its
  // slides in the browser, so neither is a witness here.
  const MUST_CARRY = [
    'export/pdf-slides',
    'export/png-slides',
    'export/html',
    'export/print',
    'render/png',
    'mcp/preview (list)',
    'mcp/preview (single)',
  ];
  await t.test('the fixture deck really trips both loaders', () => {
    for (const name of MUST_CARRY) {
      assert.ok(
        carriesPrism(documents[name]),
        `${name} carries no Prism — the fixture stopped producing code markup`,
      );
      assert.ok(
        carriesKatex(documents[name]),
        `${name} carries no KaTeX — the fixture stopped producing math markup`,
      );
    }
  });

  for (const [name, html] of Object.entries(documents)) {
    await t.test(name, () => {
      const unexpected = hostsIn(html).filter((h) => !(h in ALLOWED_HOSTS));
      assert.deepEqual(
        unexpected,
        [],
        `${name} loads from ${unexpected.join(', ')} — a document Deckyard ` +
          'renders must resolve everything against this server or carry it ' +
          'inline (docs/reference/no-third-party-origins.md)',
      );
      // Belt and braces: the CDN spellings this gate was written for.
      assert.doesNotMatch(html, /https?:\/\/[^"'\s)]*(cdn|jsdelivr|unpkg)/i);
    });
  }
});

test('a deck with no code, math or video makes zero third-party requests', async () => {
  const html = await buildStandaloneHtml(
    repoRoot,
    deck([contentSlide('- Just a bullet')]),
    {},
  );
  assert.equal(carriesPrism(html), false);
  assert.equal(carriesKatex(html), false);
  assert.doesNotMatch(
    html,
    /<script src="https:\/\/assets\.mediadelivery\.net/,
  );
});

test('a downloaded file carries Prism inline; a published page links it', async () => {
  const download = await buildStandaloneHtml(
    repoRoot,
    deck([contentSlide(codeBlock('python'))]),
    {},
  );
  // No origin to resolve against: the library travels in the document.
  assert.doesNotMatch(download, /<script src="\/client\/vendor/);
  assert.match(download, /Prism\.languages\.python/);
  // Only the languages the deck uses, exactly as with the linked form.
  assert.doesNotMatch(download, /Prism\.languages\.sql/);
  // No math on any slide, so KaTeX stays out either way.
  assert.equal(carriesKatex(download), false);

  const published = await buildStandaloneHtml(
    repoRoot,
    deck([contentSlide(codeBlock('python'))]),
    { context: 'published' },
  );
  assert.match(
    published,
    /<script src="\/client\/vendor\/prism\/components\/prism-core\.min\.js">/,
  );
  assert.match(
    published,
    /<script src="\/client\/vendor\/prism\/components\/prism-python\.min\.js">/,
  );
  assert.doesNotMatch(
    published,
    /<script src="\/client\/vendor\/prism\/components\/prism-sql\.min\.js">/,
  );
  assert.match(
    published,
    /<link rel="stylesheet" href="\/client\/vendor\/prism\/themes\/prism-tomorrow\.min\.css" \/>/,
  );
});

test('an inlined KaTeX carries its own fonts, so a formula is not laid out in a fallback face', async () => {
  const html = await buildStandaloneHtml(
    repoRoot,
    deck([contentSlide('Euler:\n\n$$e^{i\\pi} + 1 = 0$$')]),
    {},
  );
  assert.equal(carriesKatex(html), true);
  // The relative font references cannot survive in an origin-less document.
  assert.doesNotMatch(html, /url\(fonts\/KaTeX_/);
  assert.match(html, /url\(data:font\/woff2;base64,/);
  // Code highlighting is not part of "carries math".
  assert.equal(carriesPrism(html), false);
});

test('the init script only initializes the library that was loaded', async () => {
  const codeOnly = await buildStandaloneHtml(
    repoRoot,
    deck([contentSlide(codeBlock('json'))]),
    {},
  );
  assert.match(codeOnly, /Prism\.highlightElement/);
  assert.doesNotMatch(codeOnly, /katex\.render\(/);

  const plain = await buildStandaloneHtml(
    repoRoot,
    deck([contentSlide('hi')]),
    {},
  );
  assert.doesNotMatch(plain, /Prism\.highlightElement/);
  assert.doesNotMatch(plain, /katex\.render\(/);
});

test('player.js is left to the lazy loader in both runtimes', async () => {
  const html = await buildStandaloneHtml(
    repoRoot,
    deck([contentSlide('hi')]),
    {},
  );
  const embed = renderEmbedHtmlDocument({ title: 'T', totalSlides: 1 });
  for (const doc of [html, embed]) {
    // No eager <script src> tag …
    assert.doesNotMatch(
      doc,
      /<script src="https:\/\/assets\.mediadelivery\.net/,
    );
    // … but the runtime can still fetch it when a video slide needs it.
    assert.match(doc, /function ensureBunnyPlayerJs/);
    assert.match(
      doc,
      /s\.src = 'https:\/\/assets\.mediadelivery\.net\/playerjs\/player-0\.1\.0\.min\.js'/,
    );
  }
});

test('detectPrismKatexNeeds reads the markup the init script queries', () => {
  assert.deepEqual(detectPrismKatexNeeds(''), {
    prism: false,
    katex: false,
    languages: [],
  });
  assert.deepEqual(
    detectPrismKatexNeeds(
      '<pre class="md-code-block" data-lang="ts"><code class="language-ts">x</code></pre>',
    ),
    { prism: true, katex: false, languages: ['ts'] },
  );
  assert.equal(
    detectPrismKatexNeeds('<span class="md-math-inline" data-math="x">x</span>')
      .katex,
    true,
  );
  assert.equal(
    detectPrismKatexNeeds('<div class="md-math-block" data-math="x">x</div>')
      .katex,
    true,
  );
  // Escaped markup is inert text, not a rendered code block.
  assert.equal(
    detectPrismKatexNeeds('&lt;pre class=&quot;md-code-block&quot;&gt;').prism,
    false,
  );
});

test('language packs resolve through aliases and dependencies', () => {
  const tags = (languages) =>
    buildPrismKatexTags({ mode: 'linked', katex: false, languages });
  // The four base components replicate the CDN bundle Deckyard used to load,
  // so they are always there; the interesting part is what a deck adds.
  const base = ['markup', 'css', 'clike', 'javascript'];
  const extra = (languages) =>
    [...tags(languages).matchAll(/prism-([\w-]+)\.min\.js/g)]
      .map((m) => m[1])
      .filter((n) => n !== 'core' && !base.includes(n));

  assert.deepEqual(extra(['ts']), ['typescript']);
  assert.deepEqual(extra(['tsx']), ['jsx', 'typescript', 'tsx']);
  assert.deepEqual(extra(['php']), ['markup-templating', 'php']);
  // Already in the base bundle — asking for a component would be a wasted tag.
  assert.deepEqual(extra(['js', 'html', 'css']), []);
  // Unknown language: no script, code block just renders unhighlighted.
  assert.deepEqual(extra(['brainfuck']), []);
  // Deduped across slides.
  assert.deepEqual(extra(['python', 'py', 'python']), ['python']);
});

test('callers that pass no languages keep the default set', () => {
  const tags = buildPrismKatexTags({ mode: 'linked' });
  for (const lang of [
    'typescript',
    'python',
    'java',
    'json',
    'sql',
    'bash',
    'markdown',
  ]) {
    assert.match(tags, new RegExp(`prism-${lang}\\.min\\.js`));
  }
  assert.match(tags, /katex\.min\.js/);
});

test('the mode is not guessable, so it has to be stated', () => {
  assert.throws(() => buildPrismKatexTags(), /unknown mode/);
  assert.throws(() => buildPrismKatexTags({}), /unknown mode/);
  assert.throws(
    () => buildPrismKatexTags({ mode: 'cdn' }),
    /unknown mode "cdn"/,
  );
});

test('no version literal survives in the server tree', () => {
  // The vendored copy is whatever package-lock.json resolves; a hardcoded
  // version in an export head is how the exports ended up two security
  // releases behind the app shell (Prism 1.29.0 / KaTeX 0.16.9 vs 1.30.0 /
  // 0.18.4).
  const tags = buildPrismKatexTags({ mode: 'linked' });
  assert.doesNotMatch(tags, /@\d+\.\d+\.\d+/);
});
