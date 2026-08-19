import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStandaloneHtml } from '../server/export/html.js';
import { renderEmbedHtmlDocument } from '../server/utils/embed-html/template.js';
import {
  buildPrismKatexCdnTags,
  detectPrismKatexNeeds,
} from '../server/utils/prism-katex.js';
import { initSanitizer } from '../shared/sanitize.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * The standalone builder serves both the HTML download and every published
 * /p/ page, so anything it loads from a CDN is a third-party request every
 * reader makes. Prism, KaTeX and Bunny player.js used to be emitted
 * unconditionally: a nine-slide deck with no code, math or video pulled 15
 * files from jsDelivr and mediadelivery.net. They are now conditional.
 */

// Markdown rendering runs through DOMPurify; without this the sanitizer falls
// back to escaping and no real code/math markup is produced.
await initSanitizer();

function deck(slides) {
  return { id: 'd', title: 'T', slides };
}

function contentSlide(body, id = 's') {
  return { id, type: 'content-slide', content: { title: 'T', body } };
}

const codeBlock = (lang) => ['```' + lang, 'x = 1', '```'].join('\n');

test('a deck with no code, math or video makes zero third-party requests', async () => {
  const html = await buildStandaloneHtml(
    repoRoot,
    deck([contentSlide('- Just a bullet')]),
    {},
  );
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net/);
  assert.doesNotMatch(
    html,
    /<script src="https:\/\/assets\.mediadelivery\.net/,
  );
});

test('a code block loads Prism and only the languages the deck uses', async () => {
  const html = await buildStandaloneHtml(
    repoRoot,
    deck([contentSlide(codeBlock('python'))]),
    {},
  );
  assert.match(html, /prismjs@[\d.]+\/prism\.min\.js/);
  assert.match(html, /themes\/prism-tomorrow\.min\.css/);
  assert.match(html, /components\/prism-python\.min\.js/);
  // The other nine packs the head used to hardcode stay out.
  assert.doesNotMatch(
    html,
    /components\/prism-(java|sql|bash|markdown)\.min\.js/,
  );
  // No math on any slide, so KaTeX is not loaded either.
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/katex/);
});

test('math loads KaTeX but not Prism', async () => {
  const html = await buildStandaloneHtml(
    repoRoot,
    deck([contentSlide('Euler:\n\n$$e^{i\\pi} + 1 = 0$$')]),
    {},
  );
  assert.match(html, /katex@[\d.]+\/dist\/katex\.min\.js/);
  assert.match(html, /katex@[\d.]+\/dist\/katex\.min\.css/);
  assert.doesNotMatch(html, /prismjs/);
});

test('the init script only initializes the library that was loaded', async () => {
  const codeOnly = await buildStandaloneHtml(
    repoRoot,
    deck([contentSlide(codeBlock('json'))]),
    {},
  );
  assert.match(codeOnly, /Prism\.highlightElement/);
  assert.doesNotMatch(codeOnly, /katex\.render/);

  const plain = await buildStandaloneHtml(
    repoRoot,
    deck([contentSlide('hi')]),
    {},
  );
  assert.doesNotMatch(plain, /Prism\.highlightElement/);
  assert.doesNotMatch(plain, /katex\.render/);
});

test('the published context gets the same treatment as the download', async () => {
  const html = await buildStandaloneHtml(
    repoRoot,
    deck([contentSlide('No code here')]),
    { context: 'published' },
  );
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net/);
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
    buildPrismKatexCdnTags({ katex: false, languages });
  const components = (languages) =>
    [...tags(languages).matchAll(/components\/prism-([\w-]+)\.min\.js/g)].map(
      (m) => m[1],
    );

  assert.deepEqual(components(['ts']), ['typescript']);
  assert.deepEqual(components(['tsx']), ['jsx', 'typescript', 'tsx']);
  assert.deepEqual(components(['php']), ['markup-templating', 'php']);
  // Already in the core bundle — asking for a component would 404-or-waste.
  assert.deepEqual(components(['js', 'html', 'css']), []);
  // Unknown language: no script, code block just renders unhighlighted.
  assert.deepEqual(components(['brainfuck']), []);
  // Deduped across slides.
  assert.deepEqual(components(['python', 'py', 'python']), ['python']);
});

test('callers that pass no languages keep the default set', () => {
  const tags = buildPrismKatexCdnTags();
  for (const lang of [
    'markup',
    'css',
    'javascript',
    'typescript',
    'python',
    'java',
    'json',
    'sql',
    'bash',
    'markdown',
  ]) {
    assert.match(tags, new RegExp(`components/prism-${lang}\\.min\\.js`));
  }
  assert.match(tags, /katex\.min\.js/);
});
