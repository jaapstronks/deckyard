/**
 * One script assembler, and the highlight gap it closes.
 *
 * Before `server/utils/script-chain.js` there were six independent script
 * assemblers. Five functions were duplicated byte-for-byte between
 * `server/export/html.js` and `server/utils/embed-html/template.js` (bar one
 * `catch (e) {}` / `catch {}`), and the Prism/KaTeX initialiser had three
 * spellings: a ready-made tag, the same tag hand-rewritten character for
 * character, and a bare body spliced into somebody else's IIFE.
 *
 * The visible cost was a feature gap: a code block or a formula rendered
 * **unhighlighted** in an embed and in both MCP previews, because those paths
 * emitted neither the libraries nor the initialiser — while the same deck
 * highlighted in the editor, in `/p/`, in the download, in print and in the
 * PDF. That gap is what the last test here pins, and it is the reason the gate
 * is written as "every path", not "the paths that had it".
 *
 * Run with: node --test tests/script-chain.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  buildScriptChain,
  SCRIPT_RUNTIMES,
  SLIDE_RUNTIME_BANNER,
} from '../server/utils/script-chain.js';
import { closePuppeteerBrowser } from '../server/utils/puppeteer-browser.js';
import { initSanitizer } from '../shared/sanitize.js';
import { RENDER_PATHS } from '../server/render-paths.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

// Without DOMPurify the markdown renderer escapes its own output, so the code
// block below would arrive as visible text and every assertion about it would
// be measuring the wrong document. The server calls this at boot.
await initSanitizer();

after(closePuppeteerBrowser);

test('the runtime set is closed', () => {
  assert.deepEqual(SCRIPT_RUNTIMES, ['stage', 'none']);
  assert.throws(
    () => buildScriptChain({ runtime: 'deck' }),
    /unknown script runtime/,
    'an unrecognised runtime has to fail loudly — silently emitting nothing ' +
      'is how a path ends up with no runtime at all',
  );
});

test('a document with nothing to run gets no <script>', () => {
  assert.equal(
    buildScriptChain({ needs: { prism: false, katex: false } }),
    '',
    'a deck with no code block and no formula must emit no script at all',
  );
});

test('needs narrows the initialiser', () => {
  const prismOnly = buildScriptChain({ needs: { prism: true, katex: false } });
  assert.match(prismOnly, /Prism\.highlightElement/);
  assert.doesNotMatch(prismOnly, /katex\.render/);

  const katexOnly = buildScriptChain({ needs: { prism: false, katex: true } });
  assert.match(katexOnly, /katex\.render/);
  assert.doesNotMatch(katexOnly, /Prism\.highlightElement/);

  // Omitted (not `{}`-with-flags) means "assume both" — the paths that render
  // an arbitrary deck without inspecting it first.
  const both = buildScriptChain({});
  assert.match(both, /Prism\.highlightElement/);
  assert.match(both, /katex\.render/);
});

test('order is runtime, then body, then the DOM sweep', () => {
  // The initialiser rewrites code blocks in place; a body that rewrites the DOM
  // after it would leave the new markup unhighlighted.
  const out = buildScriptChain({
    runtime: 'stage',
    leadCapture: true,
    body: 'const marker = 1;',
  });
  assert.ok(out.indexOf('function attachStageScale') < out.indexOf('marker'));
  assert.ok(out.indexOf('marker') < out.indexOf('initLeadCaptureForms'));
  assert.ok(
    out.indexOf('initLeadCaptureForms') < out.indexOf('Prism.highlightElement'),
  );
});

test('a chain is a script element with a scope of its own', () => {
  const iife = buildScriptChain({ body: 'const x = 1;' });
  assert.match(iife, /^<script>\n\s*\(function \(\) \{/);
  assert.match(iife, /\}\)\(\);\n\s*<\/script>$/);

  const mod = buildScriptChain({ body: 'const x = 1;', module: true });
  assert.match(mod, /^<script type="module">/);
  assert.doesNotMatch(mod, /\(function \(\) \{/);
});

test('every assembled block is syntactically valid JavaScript', () => {
  for (const runtime of SCRIPT_RUNTIMES) {
    for (const leadCapture of [false, true]) {
      const html = buildScriptChain({
        runtime,
        leadCapture,
        body: 'const bodyMarker = 1;',
      });
      const source = html
        .replace(/^<script[^>]*>/, '')
        .replace(/<\/script>$/, '');
      assert.doesNotThrow(
        () => new vm.Script(source, { filename: `${runtime}/${leadCapture}` }),
        `runtime=${runtime} leadCapture=${leadCapture} does not parse`,
      );
    }
  }
});

test('no render path keeps a copy of the shared runtime', async (t) => {
  // The duplication this module removed: five functions living in two paths at
  // once. A third copy is how it comes back.
  // Declarations, not calls: a path may still *use* the shared runtime (that is
  // what it is for), it may not define its own.
  const SHARED = [
    'function ensureBunnyPlayerJs',
    'function initVideoEmbeds',
    'function pauseVideoEmbeds',
    'function activateVideoEmbeds',
    'function updateStageScale',
    'Prism.highlightElement',
    'katex.render',
  ];
  for (const module of [...new Set(RENDER_PATHS.map((p) => p.module))]) {
    await t.test(module, async () => {
      const src = await readFile(path.join(repoRoot, module), 'utf8');
      for (const name of SHARED) {
        assert.ok(
          !src.includes(name),
          `${module} declares "${name}" itself — it belongs to ` +
            'server/utils/script-chain.js, which is the one place it lives',
        );
      }
    });
  }
});

const CODE_DECK = {
  id: 'chain',
  title: 'Chain',
  theme: 'default',
  slides: [
    {
      id: 's1',
      type: 'content-slide',
      content: {
        title: 'Code',
        body: 'Zie:\n\n```js\nconst a = 1;\n```\n\nEn $x^2$.',
      },
    },
  ],
};

test('a code block highlights in every render path', async (t) => {
  // The gap: the embed and both MCP previews emitted no Prism at all, so the
  // same deck highlighted in five paths and rendered plain in three.
  for (const p of RENDER_PATHS) {
    await t.test(p.name, async () => {
      const html = await p.build(repoRoot, CODE_DECK, {});
      if (p.kind === 'reflow') {
        // The reader is a semantic re-projection with no JavaScript at all
        // (tests/semantic-reader.test.js pins that); it renders code as
        // readable text, not as a highlighted canvas block.
        assert.doesNotMatch(html, /<script/i);
        return;
      }
      assert.match(
        html,
        /class="[^"]*\bmd-code-block\b/,
        'the fixture stopped producing a code block — the assertions below ' +
          'would pass vacuously',
      );
      assert.match(
        html,
        /prismjs@[\d.]+\/prism\.min\.js/,
        'this path renders a code block but never loads Prism',
      );
      assert.match(
        html,
        /Prism\.highlightElement/,
        'this path loads Prism but never runs it',
      );
      assert.ok(
        html.includes(SLIDE_RUNTIME_BANNER),
        'this path builds a script without the chain',
      );
    });
  }
});

test('a deck without code or math loads nothing from a CDN', async (t) => {
  const plain = {
    id: 'plain',
    title: 'Plain',
    theme: 'default',
    slides: [{ id: 's1', type: 'title-slide', content: { title: 'Kop' } }],
  };
  // Only the paths that inspect the deck can make this promise; the export
  // paths that render an arbitrary deck still load both libraries eagerly.
  for (const name of [
    'utils/embed-html',
    'export/html',
    'mcp/preview (list)',
  ]) {
    await t.test(name, async () => {
      const p = RENDER_PATHS.find((x) => x.name === name);
      const html = await p.build(repoRoot, plain, {});
      assert.doesNotMatch(html, /cdn\.jsdelivr\.net/);
      assert.doesNotMatch(html, /Prism\.highlightElement/);
    });
  }
});
