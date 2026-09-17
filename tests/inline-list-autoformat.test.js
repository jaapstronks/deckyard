/**
 * List autoformat in the rich inline edit: Enter at the end of a line typed
 * as `1. …` or `- …` makes it a list item and opens the next item, so a
 * typed numbered list is one list numbered on from its first marker instead
 * of loose paragraphs that each became a list numbered 1 after blur.
 *
 * Run with: node --test tests/inline-list-autoformat.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

const { initSanitizer } = await import('../shared/sanitize.js');
await initSanitizer();

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { autoformatListOnEnter } =
  await import('../client/views/editor/inline-edit/list-autoformat.js');
const { serializeMarkdownDom } =
  await import('../client/lib/slide-authoring/markdown-serialize.js');
const { markdownToSafeHtml } = await import('../shared/markdown.js');

let root;
beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
});

/** Put the caret in `node` at `offset` and return the selection. */
function caret(node, offset) {
  const sel = document.getSelection();
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  return sel;
}

/** Caret at the end of the last text node inside `el`. */
function caretAtEndOf(el) {
  const walker = document.createTreeWalker(el, 4);
  let last = null;
  while (walker.nextNode()) last = walker.currentNode;
  return caret(last, last.nodeValue.length);
}

/** Simulate typing `text` at the caret (a text node in the caret's place). */
function typeAtCaret(text) {
  const sel = document.getSelection();
  const r = sel.getRangeAt(0);
  const node = document.createTextNode(text);
  r.insertNode(node);
  return caret(node, text.length);
}

describe('autoformatListOnEnter', () => {
  it('turns a typed `1. …` paragraph into an <ol> and opens item 2', () => {
    root.innerHTML = '<p>Intro</p>\n<p>1. Een</p>';
    const sel = caretAtEndOf(root.querySelector('p:last-child'));
    assert.equal(autoformatListOnEnter(root, sel), true);
    assert.equal(
      root.innerHTML,
      '<p>Intro</p>\n<ol><li>Een</li><li><br></li></ol>',
    );
    const r = sel.getRangeAt(0);
    assert.equal(r.startContainer, root.querySelector('li:last-child'));
  });

  it('keeps typing in the list: two typed items serialize as one list', () => {
    root.innerHTML = '<p>1. Een</p>';
    autoformatListOnEnter(root, caretAtEndOf(root.querySelector('p')));
    // The browser owns Enter inside an <li>; the user types the second item.
    typeAtCaret('Twee');
    assert.equal(serializeMarkdownDom(root), '1. Een\n2. Twee');
  });

  it('carries a first number other than 1 as start', () => {
    root.innerHTML = '<p>3. Drie</p>';
    autoformatListOnEnter(root, caretAtEndOf(root.querySelector('p')));
    assert.equal(root.querySelector('ol').getAttribute('start'), '3');
    typeAtCaret('Vier');
    assert.equal(serializeMarkdownDom(root), '3. Drie\n4. Vier');
  });

  it('makes `- …` an unordered list', () => {
    root.innerHTML = '<p>- punt</p>';
    autoformatListOnEnter(root, caretAtEndOf(root.querySelector('p')));
    assert.equal(root.innerHTML, '<ul><li>punt</li><li><br></li></ul>');
  });

  it('keeps inline formatting and removes only the marker', () => {
    root.innerHTML = '<p>1. <strong>vet</strong> tekst</p>';
    autoformatListOnEnter(root, caretAtEndOf(root.querySelector('p')));
    assert.equal(
      root.querySelector('li').innerHTML,
      '<strong>vet</strong> tekst',
    );
  });

  it('joins a same-kind list right above', () => {
    root.innerHTML = markdownToSafeHtml('1. Een') + '\n<p>2. Twee</p>';
    autoformatListOnEnter(root, caretAtEndOf(root.querySelector('p')));
    assert.equal(root.querySelectorAll('ol').length, 1);
    assert.equal(serializeMarkdownDom(root), '1. Een\n2. Twee');
  });

  it('wraps text typed straight into an empty field', () => {
    root.appendChild(document.createTextNode('1. Een'));
    const sel = caret(root.firstChild, 6);
    assert.equal(autoformatListOnEnter(root, sel), true);
    assert.equal(root.innerHTML, '<ol><li>Een</li><li><br></li></ol>');
  });

  it('leaves Enter to the browser elsewhere', () => {
    const cases = [
      ['plain paragraph', '<p>Gewoon</p>', 'p'],
      ['marker without text', '<p>1.</p>', 'p'],
      ['a year is not a list', '<p>2026.</p>', 'p'],
      ['already in a list', '<ol><li>1. Een</li></ol>', 'li'],
    ];
    for (const [name, html, sel] of cases) {
      root.innerHTML = html;
      const before = root.innerHTML;
      const s = caretAtEndOf(root.querySelector(sel));
      assert.equal(autoformatListOnEnter(root, s), false, name);
      assert.equal(root.innerHTML, before, name);
    }
  });

  it('leaves Enter to the browser with the caret mid-line', () => {
    root.innerHTML = '<p>1. Een twee</p>';
    const text = root.querySelector('p').firstChild;
    assert.equal(autoformatListOnEnter(root, caret(text, 6)), false);
    assert.equal(root.innerHTML, '<p>1. Een twee</p>');
  });
});
