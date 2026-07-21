/**
 * HTML→markdown serializer (editing-surfaces text phase).
 *
 * The serializer is what lets a markdown field be edited in place on the
 * canvas: the rendered block is edited as contenteditable HTML and committed
 * back as dialect markdown. Two families of guarantees:
 *
 * 1. Round trip over the renderer: for canonical dialect markdown,
 *    serialize(render(md)) === md, and for anything that passes the
 *    canInlineEditMarkdown gate, render(serialize(render(md))) === render(md).
 * 2. Contenteditable tolerance: the messier DOM an edit session produces
 *    (<b>/<i>, <div> line wrappers, <br>, style spans, junk hrefs)
 *    serializes to sane dialect markdown.
 *
 * Run with: node --test tests/markdown-serialize.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

// Init the sanitizer BEFORE any window global exists: with a `window` present
// initSanitizer takes the browser path and demands a pre-loaded DOMPurify;
// without one it builds its own jsdom+DOMPurify (the server path), giving the
// real (non-escaping) sanitizer output the round-trip tests need.
const { initSanitizer } = await import('../shared/sanitize.js');
await initSanitizer();

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { markdownToSafeHtml } = await import('../shared/markdown.js');
const {
  serializeMarkdownDom,
  markdownNeedsModal,
  canInlineEditMarkdown,
} = await import('../client/lib/markdown-serialize.js');

/** Parse an HTML string into a detached container. */
function domOf(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

const roundTrip = (md) => serializeMarkdownDom(domOf(markdownToSafeHtml(md)));

describe('canonical round trips (serialize(render(md)) === md)', () => {
  const cases = [
    ['plain paragraph', 'Hello world'],
    ['two paragraphs', 'Paragraph one\n\nParagraph two'],
    ['inline formatting', 'Some **bold** and *italic* text'],
    ['link', 'Visit [the site](https://example.com/x) today'],
    ['heading + body', '## Subheading\n\nBody text below'],
    ['flat unordered list', '- one\n- two\n- three'],
    ['ordered list', '1. first\n2. second\n3. third'],
    ['nested list', '- Parent\n  - Child A\n  - Child B\n- Sibling'],
    ['mixed nesting', '1. First\n  - detail\n2. Second'],
    ['paragraph then list', 'Intro line:\n\n- item a\n- item b'],
    ['list then paragraph', '- item a\n- item b\n\nOutro line'],
    ['formatting inside list items', '- has **bold**\n- has [link](https://x.dev/p)'],
    ['single-# line as paragraph', '# not a heading'],
    ['blockquote', '> Quoted line'],
    ['multi-paragraph blockquote', '> First para\n>\n> Second para'],
  ];
  for (const [name, md] of cases) {
    it(name, () => {
      assert.equal(roundTrip(md), md);
    });
  }
});

describe('modal-only constructs still serialize faithfully', () => {
  // These never reach the in-place editor (markdownNeedsModal gates them),
  // but the serializer handles them so a stray occurrence can't corrupt.
  const cases = [
    ['fenced code', '```js\ncode()\n```'],
    ['fenced code, no lang', '```\nplain\n```'],
    ['math block', '$$x^2 + y^2$$'],
    ['inline code', 'use `x` here'],
    ['inline math', 'formula $a+b$ here'],
    ['pipe table', '| A | B |\n| --- | --- |\n| 1 | 2 |'],
  ];
  for (const [name, md] of cases) {
    it(name, () => {
      assert.equal(roundTrip(md), md);
    });
  }
});

describe('render-equivalence for non-canonical input', () => {
  // Byte equality is too strict here (the dialect normalizes); the rendered
  // HTML must be identical instead.
  const cases = [
    ['repeated 1. markers renumber', '1. first\n1. second'],
    ['extra internal spaces collapse', 'spaced    out   text'],
    ['multi-line paragraph joins', 'line one\nline two'],
    ['underscore italic canonicalizes to *', '_italic_ text'],
    ['underscore bold canonicalizes to **', '__bold__ text'],
    ['star bullets canonicalize to dash', '* a\n* b'],
    ['plus bullets canonicalize to dash', '+ a\n+ b'],
    ['stray backslash escape survives render', 'a \\* b'],
  ];
  for (const [name, md] of cases) {
    it(name, () => {
      const html = markdownToSafeHtml(md);
      assert.equal(markdownToSafeHtml(serializeMarkdownDom(domOf(html))), html);
    });
  }
});

describe('contenteditable-shaped DOM', () => {
  const cases = [
    ['div line wrappers become paragraphs', '<div>line one</div><div>line two</div>', 'line one\n\nline two'],
    ['b/i map to strong/em markers', '<p>foo <b>x</b> and <i>y</i></p>', 'foo **x** and *y*'],
    ['block-level br splits paragraphs', '<p>one<br>two</p>', 'one\n\ntwo'],
    ['bare text node at root', 'just text', 'just text'],
    ['text node next to a block', 'lead <div>block</div>', 'lead\n\nblock'],
    ['style span keeps its text', '<p><span style="font-weight:600">kept</span></p>', 'kept'],
    ['non-http link keeps only its text', '<p><a href="javascript:alert(1)">evil</a></p>', 'evil'],
    ['empty paragraphs vanish', '<p></p><div><br></div><p>real</p>', 'real'],
    ['li text wrapped in p unwraps', '<ul><li><p>item</p></li></ul>', '- item'],
    ['unknown inline formatting degrades to text', '<p><u>under</u> <s>gone</s></p>', 'under gone'],
    ['nested bold inside italic degrades flat', '<p><em>a <strong>b</strong></em></p>', '*a **b***'],
  ];
  for (const [name, html, expected] of cases) {
    it(name, () => {
      assert.equal(serializeMarkdownDom(domOf(html)), expected);
    });
  }
});

describe('markdownNeedsModal', () => {
  const modal = [
    ['fenced code', '```js\nx\n```'],
    ['math block', 'before $$x$$ after'],
    ['inline code', 'a `b` c'],
    ['inline math', 'a $x+y$ c'],
    ['pipe table', '| A | B |\n| --- | --- |\n| 1 | 2 |'],
  ];
  const inline = [
    ['plain', 'hello'],
    ['bold + link', '**b** [l](https://x.dev)'],
    ['lists + heading', '## H\n\n- a\n- b'],
    ['currency is not math', 'costs $50 and $60 total'],
    ['pipes without separator', 'a | b | c'],
    ['blockquote', '> a quote'],
    ['underscore emphasis', '_i_ and __b__'],
    ['star bullets', '* a\n* b'],
    ['stray escaped marker', 'a \\* b'],
  ];
  for (const [name, md] of modal) {
    it(`modal: ${name}`, () => assert.equal(markdownNeedsModal(md), true));
  }
  for (const [name, md] of inline) {
    it(`inline-editable: ${name}`, () => assert.equal(markdownNeedsModal(md), false));
  }
});

describe('canInlineEditMarkdown (the in-place gate)', () => {
  it('accepts empty and simple content', () => {
    assert.equal(canInlineEditMarkdown('', markdownToSafeHtml), true);
    assert.equal(canInlineEditMarkdown('Hello **world**', markdownToSafeHtml), true);
    assert.equal(
      canInlineEditMarkdown('## H\n\n- a\n  - b\n\n[l](https://x.dev)', markdownToSafeHtml),
      true
    );
  });
  it('rejects modal-only constructs', () => {
    assert.equal(canInlineEditMarkdown('```js\nx\n```', markdownToSafeHtml), false);
    assert.equal(canInlineEditMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |', markdownToSafeHtml), false);
    assert.equal(canInlineEditMarkdown('a $x+y$ b', markdownToSafeHtml), false);
  });
  it('accepts blockquotes and underscore/star constructs', () => {
    assert.equal(canInlineEditMarkdown('> a quote', markdownToSafeHtml), true);
    assert.equal(canInlineEditMarkdown('_i_ and __b__', markdownToSafeHtml), true);
    assert.equal(canInlineEditMarkdown('* one\n* two', markdownToSafeHtml), true);
    assert.equal(canInlineEditMarkdown('a \\* b', markdownToSafeHtml), true);
  });
  it('rejects when the round trip does not reproduce the render', () => {
    // Nested emphasis: the dialect's non-nested regexes mangle it
    // (render gives "*<em>a </em>b<em> c</em>*"), so serialization cannot
    // reproduce the render — the gate must send this to the modal.
    assert.equal(canInlineEditMarkdown('**a *b* c**', markdownToSafeHtml), false);
    // Fully-escaped would-be emphasis: render gives literal "*x*", but the
    // serializer can't re-emit the escapes, so serialize→render re-italicizes.
    // The gate must keep this on the modal.
    assert.equal(canInlineEditMarkdown('\\*x\\*', markdownToSafeHtml), false);
  });
});
