/**
 * Regression: a "more" menu item closes the dropdown **before** it acts.
 *
 * The close used to be bolted on after the fact — read `btn.onclick`, wrap it,
 * assign it back. It never worked. `h()` wires an `onclick:` prop through
 * `addEventListener`, so the property was always `null`: the wrapper had no
 * previous handler to call (`prev?.(e)` returned `undefined` forever), and the
 * two handlers ran in registration order — the action first, the close second.
 * The comment above it said the opposite ("close the dropdown *before*
 * executing actions"), which is how the shape survived review.
 *
 * Nothing user-visible broke, because both handlers did run. That is exactly
 * why it needs a test: the file read as if a decision had been made about
 * ordering when the ordering was an accident of registration, and the next
 * person to add an item that navigates away or tears down the editor tree
 * would have inherited it (B117; the same assumption class as B116, whose
 * shape test is `tests/editor-more-menu-handler-shape.test.js`).
 *
 * Run with: node --test tests/editor-more-menu-close-order.test.js
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

/** Build the menu, open it, and hand back a click-by-label helper. */
function mountMenu(props) {
  const menu = createEditorTopbarMoreMenu({
    root: document.body,
    toast: { info() {}, success() {}, error() {} },
    onError() {},
    ...props,
  });
  document.body.append(menu.el);
  // `createDropdown` builds a <details>; opening it is what "the menu is open"
  // means, and closing it is what `closeMore()` does.
  menu.el.open = true;

  const click = (label) => {
    const btn = [...menu.el.querySelectorAll('button.dropdown-item')].find(
      (b) => b.textContent.trim().startsWith(label),
    );
    assert.ok(btn, `no menu item labelled ${label}`);
    btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  };
  return { menu, click };
}

test('the dropdown is already closed when the action runs', () => {
  const seen = [];
  const { menu, click } = mountMenu({
    onVersions: () => seen.push(menu.el.open),
  });

  assert.equal(menu.el.open, true, 'the menu starts open');
  click('Versions…');

  assert.deepEqual(
    seen,
    [false],
    'the action observed an open dropdown, so the close ran after it',
  );
  assert.equal(menu.el.open, false);
  menu.detach();
});

test('an item with no handler still closes the dropdown', () => {
  const { menu, click } = mountMenu({});
  click('Versions…');
  assert.equal(
    menu.el.open,
    false,
    'closing is the item’s own job, not something the action does',
  );
  menu.detach();
});

test('a handler that throws has already closed the dropdown', () => {
  const { menu, click } = mountMenu({
    onOpenSettings: () => {
      throw new Error('settings failed');
    },
  });
  click('Settings');
  assert.equal(menu.el.open, false);
  menu.detach();
});

test('no menu item carries an onclick property handler', () => {
  // The shape rule: one wiring form per button. `h()` uses addEventListener,
  // so a non-null `.onclick` means a second handler was bolted on afterwards —
  // the form B117 removed, and the one whose ordering could not be read off
  // the source.
  const { menu } = mountMenu({});
  const items = [...menu.el.querySelectorAll('button.dropdown-item')];
  assert.ok(items.length >= 10, 'the menu still has its items');
  assert.deepEqual(
    items.filter((b) => b.onclick !== null).map((b) => b.textContent.trim()),
    [],
    'a menu item is wired once, through h()’s onclick prop',
  );
  menu.detach();
});
