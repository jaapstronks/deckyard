/**
 * Regression: a "more" menu item must survive a synchronous `on*` handler.
 *
 * The items used to invoke their prop as `onVersions?.().catch?.(…)`. The `?.()`
 * covers "no handler was passed"; nothing covered "the handler is synchronous",
 * so reading `.catch` off its `undefined` return threw a TypeError before the
 * item had done anything — which is what opening **Versions…** did, every time
 * (B116; `openVersionsModal` is synchronous). The menu now awaits every handler
 * inside a try/catch, so one shape fits sync and async alike.
 *
 * Run with: node --test tests/editor-more-menu-handler-shape.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(
  '<!doctype html><html><body><div id="app"></div></body></html>',
  { url: 'http://localhost/app' },
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;

const { createEditorTopbarMoreMenu } =
  await import('../client/views/editor/topbar/more-menu.js');

/** Build the menu and hand back a click-by-label helper. */
function mountMenu(props) {
  const errors = [];
  const menu = createEditorTopbarMoreMenu({
    root: document.body,
    toast: { info() {}, success() {}, error() {} },
    onError: (e) => errors.push(e),
    ...props,
  });
  document.body.append(menu.el);
  const click = (label) => {
    const btn = [...menu.el.querySelectorAll('button.dropdown-item')].find(
      (b) => b.textContent.trim().startsWith(label),
    );
    assert.ok(btn, `no menu item labelled ${label}`);
    // A real event: `h()` wires `onclick:` through addEventListener, so calling
    // the `.onclick` property would only run the close-the-dropdown wrapper.
    btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  };
  return { menu, click, errors };
}

test('a synchronous handler opens its modal instead of throwing', () => {
  let opened = 0;
  // Exactly openVersionsModal's shape: synchronous, returns nothing.
  const { menu, click, errors } = mountMenu({
    onVersions: () => {
      opened += 1;
    },
  });
  click('Versions…');
  assert.equal(opened, 1);
  assert.deepEqual(errors, []);
  menu.detach();
});

test('an async handler that rejects is routed to onError, not to the console', async () => {
  const boom = new Error('versions failed');
  const { menu, click, errors } = mountMenu({
    onVersions: async () => {
      throw boom;
    },
  });
  click('Versions…');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(errors, [boom]);
  menu.detach();
});

test('a handler that throws synchronously is routed to onError too', async () => {
  const boom = new Error('settings failed');
  const { menu, click, errors } = mountMenu({
    onOpenSettings: () => {
      throw boom;
    },
  });
  click('Settings');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(errors, [boom]);
  menu.detach();
});

test('a missing handler is a no-op, not a crash', () => {
  const { menu, click, errors } = mountMenu({});
  click('Versions…');
  assert.deepEqual(errors, []);
  menu.detach();
});
