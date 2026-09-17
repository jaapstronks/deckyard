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
      '\n',
    );
    const html = skeleton(await markdownToSafeHtml(md));
    // Child list opens inside the parent <li>, before it closes.
    assert.ok(
      html.includes(
        '<ul><li>Parent<ul><li>Child A</li><li>Child B</li></ul></li><li>Sibling</li></ul>',
      ),
      `unexpected structure: ${html}`,
    );
  });

  it('supports three levels of nesting', async () => {
    const md = ['- L1', '  - L2', '    - L3'].join('\n');
    const html = skeleton(await markdownToSafeHtml(md));
    assert.ok(
      html.includes(
        '<ul><li>L1<ul><li>L2<ul><li>L3</li></ul></li></ul></li></ul>',
      ),
      `unexpected structure: ${html}`,
    );
  });

  it('closes back out to a shallower level correctly', async () => {
    const md = ['- A', '  - A1', '- B'].join('\n');
    const html = skeleton(await markdownToSafeHtml(md));
    assert.ok(
      html.includes('<ul><li>A<ul><li>A1</li></ul></li><li>B</li></ul>'),
      `unexpected structure: ${html}`,
    );
  });

  it('keeps a flat list flat (no spurious nesting)', async () => {
    const html = skeleton(await markdownToSafeHtml('- one\n- two\n- three'));
    assert.ok(
      html.includes('<ul><li>one</li><li>two</li><li>three</li></ul>'),
      `unexpected structure: ${html}`,
    );
  });

  it('nests an unordered child under an ordered parent', async () => {
    const md = ['1. First', '  - detail', '2. Second'].join('\n');
    const html = skeleton(await markdownToSafeHtml(md));
    assert.ok(
      html.includes(
        '<ol><li>First<ul><li>detail</li></ul></li><li>Second</li></ol>',
      ),
      `unexpected structure: ${html}`,
    );
  });
});

describe('markdown loose lists and start numbers', () => {
  // A numbered list written with blank lines between the items rendered as
  // three one-item <ol>s, each showing "1." (ciiic-slides, 2026-09-17).
  it('joins ordered items separated by blank lines into one <ol>', () => {
    const html = skeleton(
      markdownToSafeHtml('Intro.\n\n1. Een\n\n2. Twee\n\n3. Drie'),
    );
    assert.ok(
      html.includes(
        '<p>Intro.</p> <ol><li>Een</li><li>Twee</li><li>Drie</li></ol>',
      ),
      `unexpected structure: ${html}`,
    );
  });

  it('joins unordered items separated by blank lines into one <ul>', () => {
    const html = skeleton(markdownToSafeHtml('- a\n\n- b\n\n\n- c'));
    assert.ok(
      html.includes('<ul><li>a</li><li>b</li><li>c</li></ul>'),
      `unexpected structure: ${html}`,
    );
  });

  it('keeps a nested item after a blank line inside its parent', () => {
    const html = skeleton(markdownToSafeHtml('1. a\n\n   - x\n\n2. b'));
    assert.ok(
      html.includes('<ol><li>a<ul><li>x</li></ul></li><li>b</li></ol>'),
      `unexpected structure: ${html}`,
    );
  });

  it('still ends the list at a paragraph between items', () => {
    const html = skeleton(markdownToSafeHtml('- a\n\nBetween\n\n- b'));
    assert.ok(
      html.includes('<ul><li>a</li></ul> <p>Between</p> <ul><li>b</li></ul>'),
      `unexpected structure: ${html}`,
    );
  });

  it('starts a new list when the marker kind changes', () => {
    for (const md of ['- a\n1. b', '- a\n\n1. b']) {
      const html = skeleton(markdownToSafeHtml(md));
      assert.match(
        html,
        /<ul><li>a<\/li><\/ul>\s?<ol><li>b<\/li><\/ol>/,
        `unexpected structure for ${JSON.stringify(md)}: ${html}`,
      );
    }
  });

  it('carries the first number of an ordered list as start', () => {
    const html = decode(markdownToSafeHtml('3. Drie\n4. Vier'));
    assert.match(
      html,
      /<ol[^>]* start="3"[^>]*><li[^>]*>Drie<\/li><li[^>]*>Vier<\/li><\/ol>/,
    );
  });

  it('omits start for a list that begins at 1', () => {
    const html = decode(markdownToSafeHtml('1. Een\n2. Twee'));
    assert.ok(!html.includes('start='), html);
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
      `unexpected structure: ${html}`,
    );
  });

  it('renders a ### line as a plain paragraph (and terminates)', () => {
    const html = skeleton(markdownToSafeHtml('### also not a heading'));
    assert.ok(
      html.includes('<p>### also not a heading</p>'),
      `unexpected structure: ${html}`,
    );
  });

  it('keeps ## working as the one supported heading, surrounded by # lines', () => {
    const html = skeleton(markdownToSafeHtml('# a\n\n## real\n\n### b'));
    assert.ok(html.includes('<h3>real</h3>'), `unexpected structure: ${html}`);
    assert.ok(html.includes('<p># a</p>'), `unexpected structure: ${html}`);
    assert.ok(html.includes('<p>### b</p>'), `unexpected structure: ${html}`);
  });
});
