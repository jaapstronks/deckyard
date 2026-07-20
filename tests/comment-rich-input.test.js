/**
 * Rich comment composer: mentions show as atomic chips while typing, but the
 * stored body must stay byte-identical to what the old textarea produced.
 *
 * The round-trip is the load-bearing guarantee here: serialize(deserialize(x))
 * === x, or bodies drift every time an existing comment is re-hydrated for
 * editing. Everything else (chip atomicity, plain-text paste) protects that
 * same invariant.
 *
 * Run with: node --test tests/comment-rich-input.test.js
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

const {
  createRichCommentInput,
  serializeRichInput,
  deserializeRichInput,
  createMentionChip,
} = await import('../client/lib/comment-rich-input.js');
const { parseMentions } = await import('../shared/comment-mentions.js');

/** Build a composer element holding `body`, the way setValue does. */
function hydrate(body) {
  const el = document.createElement('div');
  el.append(...deserializeRichInput(body));
  return el;
}

const roundTrip = (body) => serializeRichInput(hydrate(body));

// ============================================================
// Round-trip: the canonical storage format survives untouched
// ============================================================

test('a body with no mentions round-trips unchanged', () => {
  assert.equal(roundTrip('Just a plain comment'), 'Just a plain comment');
});

test('a body with one mention round-trips unchanged', () => {
  const body = 'Hey @[Chris de Vries](user:chris@example.com), kijk mee';
  assert.equal(roundTrip(body), body);
});

test('multiple mentions and surrounding text round-trip unchanged', () => {
  const body =
    '@[Ann](user:ann@x.com) and @[Bo](user:bo@y.com) — both of you, please';
  assert.equal(roundTrip(body), body);
});

test('a mention at the very start and very end round-trips unchanged', () => {
  const body = '@[Ann](user:ann@x.com) ping @[Bo](user:bo@y.com)';
  assert.equal(roundTrip(body), body);
});

test('newlines survive the round-trip', () => {
  const body = 'first line\nsecond line\n\nfourth line';
  assert.equal(roundTrip(body), body);
});

test('a body ending in a newline round-trips unchanged', () => {
  // The composer needs a filler <br> to make the empty last line visible;
  // that filler must not read back as an extra newline, nor swallow the
  // real one. This is what the first serializer got wrong in both directions.
  assert.equal(roundTrip('text\n'), 'text\n');
  assert.equal(roundTrip('text\n\n'), 'text\n\n');
});

test('newlines mixed with mentions round-trip unchanged', () => {
  const body = 'line one\n@[Ann](user:ann@x.com) line two\nline three';
  assert.equal(roundTrip(body), body);
});

test('the server still parses the mentions out of a round-tripped body', () => {
  const body = 'cc @[Ann](user:ann@x.com) and @[Bo](user:bo@y.com)';
  const mentions = parseMentions(roundTrip(body));
  assert.deepEqual(
    mentions.map((m) => m.email),
    ['ann@x.com', 'bo@y.com']
  );
});

test('text that merely looks like markup is not treated as a mention', () => {
  // No `user:` scheme, so it is literal text and must survive verbatim.
  const body = 'see [the docs](https://example.com) please';
  assert.equal(roundTrip(body), body);
  assert.equal(parseMentions(roundTrip(body)).length, 0);
});

test('an email address in prose does not become a mention', () => {
  const body = 'mail me at ann@x.com about it';
  assert.equal(roundTrip(body), body);
  assert.equal(parseMentions(roundTrip(body)).length, 0);
});

// ============================================================
// Chip shape
// ============================================================

test('a hydrated mention becomes a non-editable chip carrying the mention data', () => {
  const el = hydrate('yo @[Ann Lee](user:ann@x.com)');
  const chips = el.querySelectorAll('.comment-mention-chip');
  assert.equal(chips.length, 1);
  const chip = chips[0];
  assert.equal(chip.getAttribute('contenteditable'), 'false');
  assert.equal(chip.getAttribute('data-mention-email'), 'ann@x.com');
  assert.equal(chip.getAttribute('data-mention-name'), 'Ann Lee');
  assert.equal(chip.textContent, '@Ann Lee');
});

test('the raw markup never shows in the composer text', () => {
  const el = hydrate('yo @[Ann Lee](user:ann@x.com) there');
  assert.ok(!el.textContent.includes('user:'));
  assert.ok(!el.textContent.includes(']('));
  assert.equal(el.textContent, 'yo @Ann Lee there');
});

test('a chip serialises back to markup even when nested in a wrapper', () => {
  // Browsers wrap lines in divs after Enter/paste; serialisation must still
  // find the chip and must not lose the line break.
  const el = document.createElement('div');
  const line1 = document.createElement('div');
  line1.append(document.createTextNode('hi '), createMentionChip({ name: 'Ann', email: 'ann@x.com' }));
  const line2 = document.createElement('div');
  line2.append(document.createTextNode('bye'));
  el.append(line1, line2);
  assert.equal(serializeRichInput(el), 'hi @[Ann](user:ann@x.com)\nbye');
});

test('a trailing filler <br> does not add a phantom newline', () => {
  const el = document.createElement('div');
  el.append(document.createTextNode('text'), document.createElement('br'));
  assert.equal(serializeRichInput(el), 'text');
});

// ============================================================
// Component behaviour
// ============================================================

test('getValue/setValue/clear/isEmpty behave as the textarea did', () => {
  const input = createRichCommentInput({ placeholder: 'Add a comment...' });
  assert.equal(input.getValue(), '');
  assert.equal(input.isEmpty(), true);

  input.setValue('hello @[Ann](user:ann@x.com)');
  assert.equal(input.getValue(), 'hello @[Ann](user:ann@x.com)');
  assert.equal(input.isEmpty(), false);
  assert.equal(input.el.querySelectorAll('.comment-mention-chip').length, 1);

  input.clear();
  assert.equal(input.getValue(), '');
  assert.equal(input.isEmpty(), true);
  assert.equal(input.el.childNodes.length, 0);
});

test('whitespace-only content counts as empty, so it cannot be posted', () => {
  const input = createRichCommentInput({});
  input.setValue('   \n  ');
  assert.equal(input.isEmpty(), true);
});

test('setValue replaces rather than appends', () => {
  const input = createRichCommentInput({});
  input.setValue('first');
  input.setValue('second');
  assert.equal(input.getValue(), 'second');
});

test('the composer is an accessible multiline textbox with a placeholder', () => {
  const input = createRichCommentInput({ placeholder: 'Add a comment...' });
  assert.equal(input.el.getAttribute('role'), 'textbox');
  assert.equal(input.el.getAttribute('aria-multiline'), 'true');
  assert.equal(input.el.getAttribute('contenteditable'), 'true');
  assert.equal(input.el.getAttribute('data-placeholder'), 'Add a comment...');
  assert.equal(input.el.getAttribute('aria-label'), 'Add a comment...');
});

test('Enter submits, Shift+Enter does not', () => {
  let submits = 0;
  const input = createRichCommentInput({ onSubmit: () => submits++ });
  document.body.append(input.el);

  input.el.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  );
  assert.equal(submits, 1);

  input.el.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  assert.equal(submits, 1, 'Shift+Enter must insert a newline, not submit');
  input.el.remove();
});

test('Enter does not submit while the mention popover claims it', () => {
  let submits = 0;
  let popoverOpen = true;
  const input = createRichCommentInput({
    onSubmit: () => submits++,
    isSubmitBlocked: () => popoverOpen,
  });
  document.body.append(input.el);

  const press = () =>
    input.el.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );

  press();
  assert.equal(submits, 0, 'the popover should have taken this Enter');

  popoverOpen = false;
  press();
  assert.equal(submits, 1);
  input.el.remove();
});

// ============================================================
// Links (phase 2a)
// ============================================================

test('a link round-trips unchanged', () => {
  const body = 'zie [de roadmap](https://example.com/r) even';
  assert.equal(roundTrip(body), body);
});

test('links and mentions coexist in one body', () => {
  const body = '@[Ann](user:ann@x.com) zie [docs](https://d.example/a?b=1#c)';
  assert.equal(roundTrip(body), body);
});

test('a mention is never mistaken for a link', () => {
  // `@[Name](user:…)` also matches the bare link shape once the @ is eaten,
  // so ordering matters: mentions must win.
  const el = hydrate('cc @[Ann](user:ann@x.com)');
  assert.equal(el.querySelectorAll('.comment-mention-chip').length, 1);
  assert.equal(el.querySelectorAll('[data-link-url]').length, 0);
});

test('a hydrated link is an anchor carrying its URL', () => {
  const el = hydrate('zie [roadmap](https://example.com/r)');
  const a = el.querySelector('[data-link-url]');
  assert.equal(a.tagName, 'A');
  assert.equal(a.getAttribute('data-link-url'), 'https://example.com/r');
  assert.equal(a.textContent, 'roadmap');
  // The label is editable — that is the difference from a mention chip.
  assert.notEqual(a.getAttribute('contenteditable'), 'false');
});

test('an unsafe URL never becomes a link, and its markup survives as text', () => {
  for (const url of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
  ]) {
    const body = `klik [hier](${url}) niet`;
    const el = hydrate(body);
    assert.equal(el.querySelectorAll('[data-link-url]').length, 0, `${url} must not linkify`);
    assert.equal(serializeRichInput(el), body, `${url} must round-trip as literal text`);
  }
});

test('editing a link label changes only the label, not the URL', () => {
  const input = createRichCommentInput({});
  input.setValue('zie [oud](https://example.com/r)');
  input.el.querySelector('[data-link-url]').textContent = 'nieuw';
  assert.equal(input.getValue(), 'zie [nieuw](https://example.com/r)');
});

test('emptying a link label drops the link entirely', () => {
  // A link with no text is nothing to click, so it must not serialise to
  // `[](url)` — that markup would render as literal text on the way back.
  const input = createRichCommentInput({});
  input.setValue('zie [oud](https://example.com/r) einde');
  input.el.querySelector('[data-link-url]').textContent = '';
  assert.equal(input.getValue(), 'zie  einde');
});
