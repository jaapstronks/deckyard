/**
 * Tests for nested (indented) list rendering in the shared markdown renderer.
 *
 * Indented bullets/numbers must build nested <ul>/<ol> inside the parent <li>
 * so they render indented on content-slide and image-text-slide, instead of
 * being flattened into one flat list.
 *
 * Run with: node --test tests/markdown-nested-lists.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { markdownToSafeHtml } from '../shared/markdown.js';

// The sync sanitizer HTML-escapes when no DOM is present (Node) but returns
// real tags in the browser; decoding entities makes the assertions hold in
// either environment.
function decode(html) {
  return String(html)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Collapse attributes/whitespace to just the tag skeleton so assertions focus
// on structure, e.g. "<ul><li>...<ul><li>...".
function skeleton(html) {
  return decode(html)
    .replace(/<(ul|ol|li|p|h3)[^>]*>/g, '<$1>')
    .replace(/\s+/g, ' ');
}

describe('markdown nested lists', () => {
  it('nests indented bullets inside the parent <li>', async () => {
    const md = ['- Parent', '  - Child A', '  - Child B', '- Sibling'].join(
      '\n'
    );
    const html = skeleton(await markdownToSafeHtml(md));
    // Child list opens inside the parent <li>, before it closes.
    assert.ok(
      html.includes('<ul><li>Parent<ul><li>Child A</li><li>Child B</li></ul></li><li>Sibling</li></ul>'),
      `unexpected structure: ${html}`
    );
  });

  it('supports three levels of nesting', async () => {
    const md = ['- L1', '  - L2', '    - L3'].join('\n');
    const html = skeleton(await markdownToSafeHtml(md));
    assert.ok(
      html.includes('<ul><li>L1<ul><li>L2<ul><li>L3</li></ul></li></ul></li></ul>'),
      `unexpected structure: ${html}`
    );
  });

  it('closes back out to a shallower level correctly', async () => {
    const md = ['- A', '  - A1', '- B'].join('\n');
    const html = skeleton(await markdownToSafeHtml(md));
    assert.ok(
      html.includes('<ul><li>A<ul><li>A1</li></ul></li><li>B</li></ul>'),
      `unexpected structure: ${html}`
    );
  });

  it('keeps a flat list flat (no spurious nesting)', async () => {
    const html = skeleton(await markdownToSafeHtml('- one\n- two\n- three'));
    assert.ok(
      html.includes('<ul><li>one</li><li>two</li><li>three</li></ul>'),
      `unexpected structure: ${html}`
    );
  });

  it('nests an unordered child under an ordered parent', async () => {
    const md = ['1. First', '  - detail', '2. Second'].join('\n');
    const html = skeleton(await markdownToSafeHtml(md));
    assert.ok(
      html.includes('<ol><li>First<ul><li>detail</li></ul></li><li>Second</li></ol>'),
      `unexpected structure: ${html}`
    );
  });
});

describe('unsupported heading levels (#, ###)', () => {
  // Regression guard: these lines used to spin markdownToSafeHtml in an
  // infinite loop — the paragraph pass refused to consume `#{1,3}` lines but
  // nothing else consumed them either, so the line cursor never advanced.
  // The test completing at all is the point; the structure asserts are bonus.
  it('renders a single-# line as a plain paragraph (and terminates)', () => {
    const html = skeleton(markdownToSafeHtml('# not a heading'));
    assert.ok(
      html.includes('<p># not a heading</p>'),
      `unexpected structure: ${html}`
    );
  });

  it('renders a ### line as a plain paragraph (and terminates)', () => {
    const html = skeleton(markdownToSafeHtml('### also not a heading'));
    assert.ok(
      html.includes('<p>### also not a heading</p>'),
      `unexpected structure: ${html}`
    );
  });

  it('keeps ## working as the one supported heading, surrounded by # lines', () => {
    const html = skeleton(markdownToSafeHtml('# a\n\n## real\n\n### b'));
    assert.ok(html.includes('<h3>real</h3>'), `unexpected structure: ${html}`);
    assert.ok(html.includes('<p># a</p>'), `unexpected structure: ${html}`);
    assert.ok(html.includes('<p>### b</p>'), `unexpected structure: ${html}`);
  });
});
