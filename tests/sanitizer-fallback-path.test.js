/**
 * The no-DOMPurify render path.
 *
 * Every sync sanitizer in shared/sanitize.js degrades to escaping when no
 * DOMPurify instance is available. That degradation is safe, but it renders
 * authored markup as visible text — the symptom behind the "matrix sample shows
 * raw HTML" report. It was invisible in the codebase because the escape was
 * silent and because only one of the two Node entrypoints (server/server.js)
 * called initSanitizer(); the MCP server process (server/mcp/index.js) renders
 * slides too and did not.
 *
 * This file therefore must NOT initialize the sanitizer at import time — it is
 * the only test that exercises the uninitialized path. node --test runs each
 * test file in its own process, so the state here is not shared with the tests
 * that do call initSanitizer().
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SLIDE_TYPES, renderSlideHtml } from '../shared/slide-types.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const matrixSlide = () => ({
  id: 'sample-matrix',
  type: 'matrix-slide',
  content: structuredClone(SLIDE_TYPES['matrix-slide'].defaults),
  notes: '',
});

/** Collect console.warn output while fn() runs. */
function captureWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return warnings;
}

test('without DOMPurify, markdown fields render escaped and the fallback warns once', () => {
  let html;
  const warnings = captureWarnings(() => {
    html = renderSlideHtml(matrixSlide(), {});
  });

  // The bug as reported: the list markup arrives as visible text, including the
  // dir="auto" attribute the real sanitizer would have stripped.
  assert.match(
    html,
    /&lt;ul/,
    'expected escaped list markup on the fallback path',
  );
  assert.doesNotMatch(html, /<ul[ >]/, 'no real list markup without DOMPurify');

  assert.equal(
    warnings.length,
    1,
    'the fallback warns exactly once per process',
  );
  assert.match(warnings[0], /\[sanitize\]/);
  assert.match(warnings[0], /initSanitizer/);
});

test('the fallback warning does not repeat on later renders', () => {
  const warnings = captureWarnings(() => {
    renderSlideHtml(matrixSlide(), {});
    renderSlideHtml(matrixSlide(), {});
  });
  assert.deepEqual(warnings, [], 'one warning per process, not one per render');
});

test('after initSanitizer() the same slide renders real markup', async () => {
  const { initSanitizer } = await import('../shared/sanitize.js');
  await initSanitizer();

  const html = renderSlideHtml(matrixSlide(), {});
  assert.match(html, /<ul[ >]/, 'expected a rendered list');
  assert.doesNotMatch(
    html,
    /&lt;ul/,
    'no escaped markup once DOMPurify is available',
  );
  // The markdown pipeline emits <ul dir="auto">; the sanitizer's allowed-attribute
  // list drops dir, so its presence in the output means the string never met
  // DOMPurify. (Slide templates add dir="auto" themselves outside the sanitized
  // markdown, so this asserts on the list element specifically.)
  assert.doesNotMatch(
    html,
    /<ul dir=/,
    'the sanitizer strips dir from markdown output',
  );
});

test('the MCP server process initializes the sanitizer at boot', async () => {
  // server/mcp/index.js is the second Node entrypoint that renders slide HTML
  // (preview tools, exports). Dropping this call reintroduces the escaped-markup
  // bug for every markdown field of every slide type in that process.
  const src = await fs.readFile(
    path.join(repoRoot, 'server/mcp/index.js'),
    'utf8',
  );
  assert.match(src, /await initSanitizer\(\)/);
});
