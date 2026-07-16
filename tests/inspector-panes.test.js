/**
 * Inspector rail pane host (editor-UI fase 3 stap 2).
 *
 * - registerPane mounts panes as children and activates the first one.
 * - setActivePane flips is-active exclusively.
 * - toggle: open rail on the named pane, dismiss when it is already the
 *   active pane of an open rail, switch panes without dismissing otherwise.
 *
 * Run with: node --test tests/inspector-panes.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { createInspectorPanes } = await import(
  '../client/views/editor/inspector-panes.js'
);

function setup() {
  const panelEl = document.createElement('div');
  let collapsed = false;
  const panes = createInspectorPanes({
    panelEl,
    setCollapsed: (v) => { collapsed = v; },
    isCollapsed: () => collapsed,
  });
  const settings = document.createElement('div');
  const comments = document.createElement('div');
  panes.registerPane('settings', settings);
  panes.registerPane('comments', comments);
  return {
    panelEl,
    panes,
    settings,
    comments,
    isCollapsed: () => collapsed,
    setCollapsed: (v) => { collapsed = v; },
  };
}

test('registerPane mounts panes and activates the first', () => {
  const { panelEl, panes, settings, comments } = setup();
  assert.equal(panelEl.children.length, 2);
  assert.ok(settings.classList.contains('inspector-pane'));
  assert.equal(settings.dataset.pane, 'settings');
  assert.equal(panes.getActivePane(), 'settings');
  assert.ok(settings.classList.contains('is-active'));
  assert.ok(!comments.classList.contains('is-active'));
});

test('setActivePane flips is-active exclusively and ignores unknown names', () => {
  const { panes, settings, comments } = setup();
  panes.setActivePane('comments');
  assert.equal(panes.getActivePane(), 'comments');
  assert.ok(comments.classList.contains('is-active'));
  assert.ok(!settings.classList.contains('is-active'));
  panes.setActivePane('nope');
  assert.equal(panes.getActivePane(), 'comments');
});

test('toggle dismisses an open rail on its active pane', () => {
  const { panes, isCollapsed } = setup();
  assert.equal(isCollapsed(), false);
  panes.toggle('settings');
  assert.equal(isCollapsed(), true, 'open rail + active pane = dismiss');
  panes.toggle('settings');
  assert.equal(isCollapsed(), false, 'dismissed rail reopens');
  assert.equal(panes.getActivePane(), 'settings');
});

test('toggle switches panes without dismissing when another pane is active', () => {
  const { panes, isCollapsed } = setup();
  panes.toggle('comments');
  assert.equal(isCollapsed(), false, 'rail stays open on a pane switch');
  assert.equal(panes.getActivePane(), 'comments');
});

test('toggle from a dismissed rail opens the requested pane', () => {
  const { panes, setCollapsed, isCollapsed } = setup();
  setCollapsed(true);
  panes.toggle('comments');
  assert.equal(isCollapsed(), false);
  assert.equal(panes.getActivePane(), 'comments');
});
