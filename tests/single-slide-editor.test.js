/**
 * Single-slide editor (D171): the full slide form for one deckless slide.
 *
 * The adapter wraps the slide in a presentation that lives only in memory, so
 * the guard here is the one D171 turns on: editing, undoing and detaching never
 * reach `/api/presentations` - not through the api client it is handed, not
 * through a raw fetch, and not in its source.
 *
 * Run with: node --test tests/single-slide-editor.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/library',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Every URL anything asks for, through the api client or a raw fetch.
const requested = [];
globalThis.fetch = async (url) => {
  requested.push(String(url));
  return new Response('{}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
const api = async (url) => {
  requested.push(String(url));
  return {};
};

const { createSingleSlideEditor } =
  await import('../client/views/editor/single-slide-editor.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');

async function mountEditor(content) {
  let changes = 0;
  const editor = await createSingleSlideEditor({
    slideType: 'content-slide',
    content,
    lang: 'nl',
    themeId: 'default',
    api,
    user: {},
    features: {},
    SLIDE_TYPES,
    onChange: () => {
      changes += 1;
    },
  });
  document.body.append(editor.el);
  return { editor, changes: () => changes };
}

function titleInput(el) {
  const label = [...el.querySelectorAll('label, .field-label')].find((l) =>
    /title/i.test(l.textContent),
  );
  const field = label?.closest('.field') || label?.parentElement;
  return field?.querySelector('input, textarea');
}

test('edits, undo and redo work on a copy, and report through onChange', async () => {
  const content = {
    ...structuredClone(SLIDE_TYPES['content-slide'].defaults),
    title: 'Origineel',
    futureKey: { kept: true },
  };
  const { editor, changes } = await mountEditor(content);

  assert.equal(editor.isDirty(), false, 'a fresh editor is clean');
  assert.equal(editor.canUndo(), false);

  const input = titleInput(editor.el);
  assert.ok(input, 'the title field renders');
  input.value = 'Nieuw';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));

  assert.equal(editor.getContent().title, 'Nieuw');
  assert.equal(content.title, 'Origineel', 'the caller content is not mutated');
  assert.deepEqual(
    editor.getContent().futureKey,
    { kept: true },
    'a key the schema does not know survives the round trip',
  );
  assert.equal(editor.isDirty(), true);
  assert.equal(editor.canUndo(), true);
  assert.ok(changes() > 0, 'onChange fired');

  assert.equal(editor.undo(), true);
  assert.equal(editor.getContent().title, 'Origineel');
  assert.equal(editor.isDirty(), false);
  assert.equal(editor.canRedo(), true);
  assert.equal(editor.redo(), true);
  assert.equal(editor.getContent().title, 'Nieuw');

  editor.detach();
  editor.el.remove();
});

test('the library surface renders Background and Accessibility, no deck chrome', async () => {
  const { editor } = await mountEditor(
    structuredClone(SLIDE_TYPES['content-slide'].defaults),
  );
  assert.ok(editor.el.querySelector('.editor-bg-section'));
  assert.ok(editor.el.querySelector('.editor-a11y-section'));
  assert.ok(
    editor.el.querySelector('.single-slide-editor-toolbar .pill'),
    'type pill in the toolbar',
  );
  assert.equal(editor.el.querySelector('.ai-iterate-panel'), null);
  assert.equal(editor.el.querySelector('.editor-form-close-slot'), null);
  editor.detach();
  editor.el.remove();
});

test('nothing it does reaches /api/presentations', () => {
  assert.ok(requested.length > 0, 'the stubs saw the requests');
  const deckCalls = requested.filter((u) => u.includes('/api/presentations'));
  assert.deepEqual(deckCalls, []);
});

test('the adapter source never names /api/presentations', () => {
  const src = readFileSync('client/views/editor/single-slide-editor.js', 'utf8')
    // The module comment explains the rule; the guard is on the code.
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(src.includes('/api/presentations'), false);
});
