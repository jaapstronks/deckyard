/**
 * The tag editor's read-only mode (B340).
 *
 * Writing the tags of a shared library item follows the creator-or-admin rule
 * (D170), so the library lightbox shows them read-only when `canEdit` is false,
 * like the description. Read-only means the tags are shown and nothing offers
 * an edit the server would refuse: no input, no remove buttons.
 *
 * Run with: node --test tests/tag-editor-read-only.test.js
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

const { createTagEditor } = await import('../client/views/list/tag-editor.js');

const noApi = async () => [];

test('read-only: the tags show, with no input and no remove buttons', () => {
  const editor = createTagEditor({
    api: noApi,
    initialTags: ['alpha', 'beta'],
    readOnly: true,
  });
  const texts = [...editor.el.querySelectorAll('.tag-editor-tag-text')].map(
    (el) => el.textContent,
  );
  assert.deepEqual(texts, ['alpha', 'beta']);
  assert.equal(editor.el.querySelector('input'), null);
  assert.equal(editor.el.querySelector('.tag-editor-tag-remove'), null);
  editor.detach();
});

test('editable (the default): an input and a remove button per tag', () => {
  const editor = createTagEditor({ api: noApi, initialTags: ['alpha'] });
  assert.ok(editor.el.querySelector('input.tag-editor-input'));
  assert.equal(editor.el.querySelectorAll('.tag-editor-tag-remove').length, 1);
  editor.detach();
});
