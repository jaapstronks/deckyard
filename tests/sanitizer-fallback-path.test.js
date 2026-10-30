/**
 * The no-DOMPurify render path.
 *
 * Every sync sanitizer in shared/sanitize.js degrades to escaping when no
 * DOMPurify instance is available. That degradation is safe, but it renders
 * authored markup as visible text — the symptom behind the "matrix sample shows
 * raw HTML" report. It was invisible in the codebase because the escape was
 * silent and because only one of the two Node entrypoints (server/server.js)
 * called initSanitizer(); the MCP server process (server/mcp/index.js) renders
 * slides too and did not. Markdown no longer takes that path: its generator
 * escapes by construction, so the matrix sample renders the same with or
 * without DOMPurify. Author HTML (database-backed types) still does.
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
import { sanitizeSlideHtmlSync } from '../shared/sanitize.js';

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

test('without DOMPurify, markdown fields still render real markup', () => {
  // The markdown generator escapes by construction and has no sanitizer pass
  // (tests/markdown-escaped-by-construction.test.js), so a process without
  // DOMPurify, like the frozen renderer bundle, renders the same list the
  // live page does. This used to be the escaped-markup symptom.
  let html;
  const warnings = captureWarnings(() => {
    html = renderSlideHtml(matrixSlide(), {});
  });
  assert.match(html, /<ul dir="auto">/, 'a real list, dir included');
  assert.doesNotMatch(html, /&lt;ul/, 'no escaped list markup');
  assert.deepEqual(warnings, [], 'markdown never reaches the fallback');
});

test('without DOMPurify, author HTML renders escaped and the fallback warns once', () => {
  let html;
  const warnings = captureWarnings(() => {
    html = sanitizeSlideHtmlSync('<ul><li>a</li></ul>');
  });
  assert.equal(html, '&lt;ul&gt;&lt;li&gt;a&lt;/li&gt;&lt;/ul&gt;');
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
    sanitizeSlideHtmlSync('<b>x</b>');
    sanitizeSlideHtmlSync('<b>y</b>');
  });
  assert.deepEqual(warnings, [], 'one warning per process, not one per render');
});

test('after initSanitizer() author HTML renders real markup', async () => {
  const { initSanitizer } = await import('../shared/sanitize.js');
  await initSanitizer();
  assert.equal(
    sanitizeSlideHtmlSync('<ul><li>a</li></ul>'),
    '<ul><li>a</li></ul>',
  );
});

test('the MCP server process initializes the sanitizer at boot', async () => {
  // server/mcp/index.js is the second Node entrypoint that renders slide HTML
  // (preview tools, exports). Dropping this call makes every database-backed
  // slide type render its template as escaped text in that process.
  const src = await fs.readFile(
    path.join(repoRoot, 'server/mcp/index.js'),
    'utf8',
  );
  assert.match(src, /await initSanitizer\(\)/);
});
