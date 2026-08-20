/**
 * Shared empty-state block (client/lib/dom/empty-state.js).
 *
 * The block form (icon + title + message + CTA row) is the one canonical
 * empty-state component (A7.16 cluster 3); analytics, the activity feed and
 * the settings tabs cloned its shape under their own class names before the
 * consolidation. This covers the markup contract the migration relies on:
 * the default icon, the `icon: null` icon-less variant, and the `className`
 * parameter that carries the dashed-panel visual.
 *
 * Run with: node --test tests/empty-state.test.js
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
globalThis.SVGElement = dom.window.SVGElement;

const { h } = await import('../client/lib/dom.js');
const { createEmptyState } = await import('../client/lib/dom/empty-state.js');

test('default builds .empty-state > img + title + message', () => {
  const el = createEmptyState({
    h,
    title: 'No viewers yet',
    message: 'Share your presentation to see sessions here.',
  });
  assert.equal(el.className, 'empty-state');
  const [icon, title, message] = el.children;
  assert.equal(icon.tagName, 'IMG');
  assert.equal(icon.className, 'empty-state-icon');
  assert.match(icon.getAttribute('src'), /presentation/);
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.equal(title.className, 'empty-state-title');
  assert.equal(title.textContent, 'No viewers yet');
  assert.match(message.className, /empty-state-message/);
});

test('a named icon resolves through iconUrl', () => {
  const el = createEmptyState({ h, icon: 'inbox', title: 'No activity yet' });
  assert.match(el.children[0].getAttribute('src'), /inbox\.svg$/);
});

test('icon: null renders an icon-less block', () => {
  const el = createEmptyState({ h, icon: null, title: 'No custom themes yet.' });
  assert.equal(el.querySelector('img'), null);
  assert.equal(el.children[0].className, 'empty-state-title');
});

test('className lands next to empty-state (the panel variant)', () => {
  const el = createEmptyState({
    h,
    icon: null,
    className: 'empty-state-panel',
    title: 'No custom fonts yet',
  });
  assert.equal(el.className, 'empty-state empty-state-panel');
});

test('primary/secondary actions render as buttons in the actions row', () => {
  let clicked = 0;
  const el = createEmptyState({
    h,
    title: 'No presentations yet',
    primaryLabel: 'Create',
    onPrimary: () => {
      clicked += 1;
    },
  });
  const actions = el.querySelector('.empty-state-actions');
  assert.ok(actions);
  const btn = actions.querySelector('button');
  assert.equal(btn.textContent, 'Create');
  btn.click();
  assert.equal(clicked, 1);
});

test('no actions row without handlers, no message node without message', () => {
  const el = createEmptyState({ h, title: 'Empty' });
  assert.equal(el.querySelector('.empty-state-actions'), null);
  assert.equal(el.querySelector('.empty-state-message'), null);
});
