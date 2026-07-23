/**
 * Mention autocomplete over its caret adapter.
 *
 * The composer moved from `<textarea>` to a contenteditable, so the
 * autocomplete no longer owns caret handling: it asks an adapter for the text
 * before the caret and hands the adapter the picked user. Both adapters must
 * behave identically for the parts users notice — when the popover opens, what
 * the query is, and what lands in the body.
 *
 * The textarea adapter is still exercised because it is the reference
 * implementation of that contract (and the shape any future composer copies).
 *
 * Run with: node --test tests/mention-autocomplete-adapter.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.getComputedStyle = dom.window.getComputedStyle;

const { textareaCaretAdapter, attachMentionAutocomplete } = await import(
  '../client/lib/comments/mention-autocomplete.js'
);
const { createRichCommentInput } = await import('../client/lib/comments/comment-rich-input.js');

const ANN = { name: 'Ann Lee', email: 'ann@x.com' };

/** A textarea with the caret parked at the end of `value`. */
function textareaAt(value) {
  const ta = document.createElement('textarea');
  document.body.append(ta);
  ta.value = value;
  ta.setSelectionRange(value.length, value.length);
  return ta;
}

// ============================================================
// Textarea adapter — the reference contract
// ============================================================

test('textarea adapter reports the text before the caret', () => {
  const ta = textareaAt('hello @an');
  const adapter = textareaCaretAdapter(ta);
  assert.equal(adapter.getTextBeforeCaret(), 'hello @an');

  ta.setSelectionRange(5, 5);
  assert.equal(adapter.getTextBeforeCaret(), 'hello');
  ta.remove();
});

test('textarea adapter replaces @query with markup and a trailing space', () => {
  const ta = textareaAt('hello @an');
  const adapter = textareaCaretAdapter(ta);

  assert.equal(adapter.replaceQueryWithMention(2, ANN), true);
  assert.equal(ta.value, 'hello @[Ann Lee](user:ann@x.com) ');
  assert.equal(ta.selectionStart, ta.value.length, 'caret sits after the space');
  ta.remove();
});

test('textarea adapter keeps text after the caret intact', () => {
  const ta = textareaAt('hi @an rest');
  const adapter = textareaCaretAdapter(ta);
  ta.setSelectionRange(6, 6); // right after "@an"

  adapter.replaceQueryWithMention(2, ANN);
  assert.equal(ta.value, 'hi @[Ann Lee](user:ann@x.com)  rest');
  ta.remove();
});

test('textarea adapter refuses to replace when the caret is not after an @query', () => {
  const ta = textareaAt('no mention here');
  const adapter = textareaCaretAdapter(ta);
  assert.equal(adapter.replaceQueryWithMention(2, ANN), false);
  assert.equal(ta.value, 'no mention here', 'body must be left untouched');
  ta.remove();
});

// ============================================================
// Rich-input adapter — same contract, chip instead of markup
// ============================================================

test('rich input adapter yields the same serialised body as the textarea', () => {
  const input = createRichCommentInput({});
  document.body.append(input.el);
  input.setValue('hello @an');

  // Park the caret at the end of the text node.
  const textNode = input.el.firstChild;
  const range = document.createRange();
  range.setStart(textNode, textNode.data.length);
  range.collapse(true);
  const sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  assert.equal(input.getTextBeforeCaret(), 'hello @an');
  assert.equal(input.replaceQueryWithMention(2, ANN), true);

  // A chip in the DOM, the identical markup on the wire.
  assert.equal(input.el.querySelectorAll('.comment-mention-chip').length, 1);
  assert.equal(input.getValue(), 'hello @[Ann Lee](user:ann@x.com) ');
  input.el.remove();
});

// ============================================================
// Query detection (shared across adapters)
// ============================================================

/**
 * Drive the autocomplete against a textarea and report which query it
 * searched for, or null when it never opened.
 */
async function queryFor(value) {
  const ta = textareaAt(value);
  let searched = null;
  const ac = attachMentionAutocomplete({
    textarea: ta,
    api: async (url) => {
      searched = decodeURIComponent(new URL(url, 'http://x').searchParams.get('q'));
      return { users: [] };
    },
  });
  ta.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const open = ac.isOpen();
  ac.detach();
  ta.remove();
  return open ? searched : null;
}

test('an @ at the start of the text opens the popover', async () => {
  assert.equal(await queryFor('@an'), 'an');
});

test('an @ after whitespace opens the popover', async () => {
  assert.equal(await queryFor('hey @an'), 'an');
});

test('an email address does not open the popover', async () => {
  // The @ is preceded by a word character, so it is an address, not a mention.
  assert.equal(await queryFor('mail ann@x.com'), null);
});

test('a completed mention does not reopen the popover', async () => {
  // Whitespace after the query ends the mention attempt.
  assert.equal(await queryFor('hey @[Ann Lee](user:ann@x.com) '), null);
});

test('a bare @ opens the popover with an empty query', async () => {
  assert.equal(await queryFor('hey @'), '');
});
