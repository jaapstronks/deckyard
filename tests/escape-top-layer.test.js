/**
 * Escape goes to the topmost live surface (B493).
 *
 * Two reproduced faults from the #1309/#1312 follow-up:
 *
 *   1. The slides drawer registers its document bubble listener before any
 *      modal does, so with a modal open over the drawer an Escape closed the
 *      drawer and left the modal standing. `takeEscape` makes a press
 *      exclusive; it does not decide rank. The drawer now defers to the same
 *      top-layer marker the overlays use among themselves.
 *   2. A visibility menu closed by an outside click (or its X, or a preset)
 *      only removed its node; its capture keydown stayed live and stole a
 *      later Escape. Every way out now runs one close path.
 *
 * Run with: node --test tests/escape-top-layer.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const { h } = await import('../client/lib/dom.js');
const { createOverlay } = await import('../client/lib/dom/modal.js');
const { createDropdown } = await import('../client/lib/dom/dropdown.js');
const { createResponsiveDrawers } =
  await import('../client/views/editor/responsive-drawers.js');
const { createVisibilityMenu, showVisibilityMenuAt, closeVisibilityMenu } =
  await import('../client/views/editor/slide-visibility-menu.js');

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const escapeFrom = (el) => {
  const ev = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(ev);
  return ev;
};
const clickOn = (el) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

const drawerIsOpen = () =>
  document.documentElement.classList.contains('is-slides-drawer-open');

/** An editor shell with the drawer mounted and open. */
function mountOpenDrawer() {
  const root = h('div', { class: 'editor-shell' });
  document.body.append(root);
  const drawers = createResponsiveDrawers({ root });
  drawers.openSlidesDrawer();
  return {
    detach: () => {
      drawers.detach();
      root.remove();
    },
  };
}

/** A modal with a text input, the way a settings or rename dialog looks. */
function showModal() {
  const input = h('input', { type: 'text' });
  const surface = h('div', {}, [input]);
  const overlay = createOverlay({ surface });
  overlay.show(document.body);
  return { overlay, input, surface };
}

function openVisibilityMenu(anchor) {
  const menu = createVisibilityMenu({ slide: { id: 's1' } });
  showVisibilityMenuAt({ anchor, menu });
  return menu;
}

test('drawer + modal: Escape in the modal closes the modal, the drawer stays', async () => {
  const drawer = mountOpenDrawer();
  const { overlay, input } = showModal();

  const ev = escapeFrom(input);
  await tick();
  assert.equal(overlay.isOpen(), false, 'the modal closes');
  assert.equal(drawerIsOpen(), true, 'the drawer underneath stays open');
  assert.equal(ev.defaultPrevented, true);

  escapeFrom(document.body);
  assert.equal(drawerIsOpen(), false, 'the next Escape closes the drawer');
  drawer.detach();
});

test('drawer + modal + dropdown in the modal: one Escape per layer, top down', async () => {
  const drawer = mountOpenDrawer();
  const { overlay, surface } = showModal();
  const dropdown = createDropdown({ label: 'More', items: [h('button')] });
  surface.append(dropdown.el);
  dropdown.details.open = true;

  escapeFrom(dropdown.summary);
  await tick();
  assert.equal(dropdown.details.open, false, 'the dropdown closes first');
  assert.equal(overlay.isOpen(), true);
  assert.equal(drawerIsOpen(), true);

  escapeFrom(dropdown.summary);
  await tick();
  assert.equal(overlay.isOpen(), false, 'then the modal');
  assert.equal(drawerIsOpen(), true, 'the drawer waits its turn');

  escapeFrom(document.body);
  assert.equal(drawerIsOpen(), false, 'then the drawer');
  dropdown.detach();
  drawer.detach();
});

test('visibility menu: two rounds closed without Escape leave nothing that steals a later Escape', async () => {
  const drawer = mountOpenDrawer();
  const anchor = h('button');
  const elsewhere = h('div');
  document.body.append(anchor, elsewhere);

  // Round 1: closed by an outside click (after the deferred bind).
  const first = openVisibilityMenu(anchor);
  await tick();
  clickOn(elsewhere);
  assert.equal(first.isConnected, false, 'outside click closes the menu');

  // Round 2: closed with its X.
  const second = openVisibilityMenu(anchor);
  await tick();
  clickOn(second.querySelector('.visibility-menu-close'));
  assert.equal(second.isConnected, false, 'the X closes the menu');

  // A modal over the drawer now gets the Escape; nothing stale takes it.
  const { overlay, input } = showModal();
  escapeFrom(input);
  await tick();
  assert.equal(overlay.isOpen(), false, 'the modal closes on the first Escape');
  assert.equal(drawerIsOpen(), true);

  // And with no modal, the drawer gets the press, not a ghost menu.
  const ev = escapeFrom(document.body);
  assert.equal(drawerIsOpen(), false, 'the drawer closes on the next one');
  assert.equal(ev.defaultPrevented, true);
  anchor.remove();
  elsewhere.remove();
  drawer.detach();
});

test('visibility menu: a picked preset closes through the same path', async () => {
  const drawer = mountOpenDrawer();
  const anchor = h('button');
  document.body.append(anchor);

  const menu = openVisibilityMenu(anchor);
  clickOn(menu.querySelector('.visibility-menu-option'));
  await tick(150);
  assert.equal(menu.isConnected, false, 'the preset closes the menu');

  escapeFrom(document.body);
  assert.equal(drawerIsOpen(), false, 'the Escape reaches the drawer');
  anchor.remove();
  drawer.detach();
});

test('visibility menu: Escape closes the open menu, not the drawer under it', async () => {
  const drawer = mountOpenDrawer();
  const anchor = h('button');
  document.body.append(anchor);

  const menu = openVisibilityMenu(anchor);
  escapeFrom(document.body);
  assert.equal(menu.isConnected, false);
  assert.equal(drawerIsOpen(), true);

  escapeFrom(document.body);
  assert.equal(drawerIsOpen(), false);
  anchor.remove();
  drawer.detach();
});

test('visibility menu: a replaced menu and a late preset timer leave the new one alone', async () => {
  const drawer = mountOpenDrawer();
  const anchor = h('button');
  document.body.append(anchor);

  const first = openVisibilityMenu(anchor);
  clickOn(first.querySelector('.visibility-menu-option'));
  // Replaced before the preset's delayed close fires.
  const second = openVisibilityMenu(anchor);
  assert.equal(first.isConnected, false, 'the new menu replaces the old one');
  await tick(150);
  assert.equal(second.isConnected, true, 'the old timer does not close it');
  assert.equal(document.querySelectorAll('.visibility-menu').length, 1);

  // One Escape for the menu, one for the drawer: the replaced menu holds none.
  escapeFrom(document.body);
  assert.equal(second.isConnected, false);
  assert.equal(drawerIsOpen(), true);
  escapeFrom(document.body);
  assert.equal(drawerIsOpen(), false);
  anchor.remove();
  drawer.detach();
});

test('visibility menu: closing before the deferred bind leaves no click listener behind', async () => {
  const anchor = h('button');
  document.body.append(anchor);
  const added = [];
  const add = document.addEventListener;
  document.addEventListener = function (type, ...rest) {
    added.push(type);
    return add.call(this, type, ...rest);
  };
  try {
    const menu = openVisibilityMenu(anchor);
    added.length = 0;
    // The slide list's detach runs before the deferred click bind.
    closeVisibilityMenu();
    assert.equal(menu.isConnected, false);
    await tick(10);
    assert.deepEqual(added, [], 'the deferred bind never lands');
  } finally {
    document.addEventListener = add;
    anchor.remove();
  }
});
