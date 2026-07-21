/**
 * Tests for the CommonMark-ward additions to the shared markdown renderer
 * (data-model track, PR 9): underscore emphasis with the intraword rule,
 * `*`/`+` bullet markers, backslash escapes, and `> ` blockquotes.
 *
 * The renderer deliberately stays a subset (one heading level, non-nested
 * emphasis). These tests pin the new behaviour AND guard the boundaries.
 *
 * Run with: node --test tests/markdown-commonmark.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { markdownToSafeHtml, inlineMarkdownToSafeHtml } from '../shared/markdown.js';

// The sync sanitizer HTML-escapes when no DOM is present (Node); decode so the
// assertions read the same in either environment.
function decode(html) {
  return String(html)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

const render = (md) => decode(markdownToSafeHtml(md));
const inline = (md) => decode(inlineMarkdownToSafeHtml(md));

describe('underscore emphasis', () => {
  it('renders _x_ as <em>', () => {
    assert.ok(render('an _italic_ word').includes('<em>italic</em>'));
  });
  it('renders __x__ as <strong>', () => {
    assert.ok(render('a __bold__ word').includes('<strong>bold</strong>'));
  });
  it('keeps intraword underscores literal (snake_case)', () => {
    const html = render('the snake_case_name stays literal');
    assert.ok(html.includes('snake_case_name'), html);
    assert.ok(!html.includes('<em>'), html);
  });
  it('keeps a lone file_name underscore literal', () => {
    const html = render('open file_name.js now');
    assert.ok(html.includes('file_name.js'), html);
    assert.ok(!html.includes('<em>'), html);
  });
  it('does not italicize an underscore inside a URL path', () => {
    const html = render('see [docs](https://example.com/a_b_c_d)');
    assert.ok(html.includes('href="https://example.com/a_b_c_d"'), html);
    assert.ok(!html.includes('<em>'), html);
  });
});

describe('star and plus bullets', () => {
  it('renders * bullets as a <ul>', () => {
    const html = render('* one\n* two');
    assert.ok(/<ul[^>]*><li[^>]*>one<\/li><li[^>]*>two<\/li><\/ul>/.test(html), html);
  });
  it('renders + bullets as a <ul>', () => {
    const html = render('+ one\n+ two');
    assert.ok(/<ul[^>]*><li[^>]*>one<\/li><li[^>]*>two<\/li><\/ul>/.test(html), html);
  });
  it('does not treat **bold** at line start as a bullet', () => {
    const html = render('**bold** lead');
    assert.ok(html.includes('<strong>bold</strong>'), html);
    assert.ok(!html.includes('<ul'), html);
  });
});

describe('backslash escapes', () => {
  it('renders \\* as a literal asterisk, not emphasis', () => {
    const html = render('a \\*literal\\* b');
    assert.ok(html.includes('*literal*'), html);
    assert.ok(!html.includes('<em>'), html);
  });
  it('renders \\_ as a literal underscore', () => {
    const html = render('a \\_kept\\_ b');
    assert.ok(html.includes('_kept_'), html);
    assert.ok(!html.includes('<em>'), html);
  });
  it('renders escaped brackets so it is not a link', () => {
    const html = render('\\[not a link\\](https://x.dev)');
    assert.ok(html.includes('[not a link]'), html);
    assert.ok(!html.includes('<a '), html);
  });
  it('renders an escaped pipe as a literal, not a table cell', () => {
    const html = render('a \\| b');
    assert.ok(html.includes('a | b'), html);
  });
  it('escaped < drops the backslash and stays literal (same as bare <)', () => {
    // \< must render exactly like a bare < (literal text, HTML-escaped),
    // never as backslash + tag.
    assert.equal(markdownToSafeHtml('a \\< b'), markdownToSafeHtml('a < b'));
    assert.ok(!render('a \\< b').includes('\\'), render('a \\< b'));
  });
  it('does NOT honour an escaped backtick (accepted boundary)', () => {
    // Escapes run after code extraction, so \` cannot suppress a code span;
    // this documents the boundary rather than pretending to support it.
    assert.ok(render('a \\`x\\` b').includes('<code'), render('a \\`x\\` b'));
  });
  it('leaves a backslash before a non-punctuation char alone', () => {
    assert.ok(render('a \\word b').includes('\\word'));
  });
});

describe('blockquotes', () => {
  it('renders a > line as a <blockquote> with a paragraph', () => {
    const html = render('> a quote');
    assert.ok(/<blockquote[^>]*><p[^>]*>a quote<\/p><\/blockquote>/.test(html), html);
  });
  it('joins consecutive > lines into one paragraph', () => {
    const html = render('> line one\n> line two');
    assert.ok(html.includes('<blockquote'), html);
    assert.ok(html.includes('line one line two'), html);
  });
  it('splits quote paragraphs on a blank > line', () => {
    const html = render('> first\n>\n> second');
    const paras = (html.match(/<p[^>]*>/g) || []).length;
    assert.equal(paras, 2, html);
  });
  it('supports inline formatting inside a quote', () => {
    const html = render('> a **bold** point');
    assert.ok(html.includes('<strong>bold</strong>'), html);
  });
});

describe('inline-only variant keeps the additions', () => {
  it('underscore emphasis and escapes work in inlineMarkdownToSafeHtml', () => {
    assert.ok(inline('_i_ and __b__').includes('<em>i</em>'));
    assert.ok(inline('_i_ and __b__').includes('<strong>b</strong>'));
    assert.ok(inline('a \\* b').includes('*'));
    assert.ok(!inline('a \\* b').includes('<em>'));
  });
});
