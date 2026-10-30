/**
 * The topbar title button keeps its pencil icon when the title changes
 * (B893). A rename, a remote title change and a language switch used to set
 * `textContent` on the button itself, which threw the pencil away.
 *
 * Run with: node --test tests/editor-topbar-title-button.test.js
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

const { createTopbarTitleButton, setTopbarTitleText } =
  await import('../client/views/editor/topbar/title-button.js');

test('a new title replaces the text and keeps the pencil', () => {
  const el = createTopbarTitleButton({ title: 'Oud' });
  setTopbarTitleText(el, 'Nieuw');
  assert.equal(
    el.querySelector('.topbar-pres-title-text').textContent,
    'Nieuw',
  );
  assert.equal(el.title, 'Nieuw');
  assert.ok(el.querySelector('.topbar-title-pencil'), 'pencil stays');
});

test('no button yet is a no-op', () => {
  assert.doesNotThrow(() => setTopbarTitleText(null, 'Nieuw'));
});
