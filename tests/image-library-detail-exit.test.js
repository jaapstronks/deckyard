/**
 * The image-library detail pane tells its owner when it comes and goes
 * (client/views/editor/image-library/detail.js).
 *
 * The picker hides the list while the pane is up and must bring it back when
 * the pane hides. It used to do that by overriding `hide` on the object the
 * component returns — but the pane's own Back button called the inner
 * `hide()`, never the override, so Back left the modal empty (found in the
 * B579 review, 2026-10-01). The owner now passes `onShow` / `onHide`, and the
 * component runs them from every exit. This pins that Back reaches `onHide`.
 *
 * Run with: node --test tests/image-library-detail-exit.test.js
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
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const { createImageLibraryDetail } =
  await import('../client/views/editor/image-library/detail.js');

const noop = () => {};
const item = {
  id: 'img-1',
  url: '/uploads/one.png',
  alts: { en: 'One' },
  tags: [],
  photographer: '',
  description: '',
};

/** @returns {{ detail: Object, shown: number[], hidden: number[] }} */
function mount() {
  const shown = [];
  const hidden = [];
  const detail = createImageLibraryDetail({
    api: async () => ({ usage: [] }),
    user: null,
    items: () => [item],
    canAiAlt: false,
    context: null,
    onPick: noop,
    onClose: noop,
    onItemUpdated: noop,
    onItemDeleted: noop,
    allowCaptionCredit: false,
    creditCb: null,
    setStatus: noop,
    setBusy: noop,
    onShow: () => shown.push(1),
    onHide: () => hidden.push(1),
  });
  document.body.append(detail.el);
  return { detail, shown, hidden };
}

test('show runs onShow before the pane appears', () => {
  const { detail, shown, hidden } = mount();
  assert.equal(detail.el.hidden, true);
  detail.show(item);
  assert.equal(shown.length, 1);
  assert.equal(hidden.length, 0);
  assert.equal(detail.el.hidden, false);
  detail.el.remove();
});

test('the Back button hides the pane and runs onHide', () => {
  const { detail, hidden } = mount();
  detail.show(item);
  const back = [
    ...detail.el.querySelectorAll('.image-lib-detail-top button'),
  ].find((b) => b.textContent.trim() === 'Back');
  assert.ok(back, 'the pane has a Back button');
  back.click();
  assert.equal(detail.el.hidden, true);
  assert.equal(hidden.length, 1, 'Back reaches the owner through onHide');
  assert.equal(detail.getActiveId(), '');
  detail.el.remove();
});

test('hide() from the owner runs onHide too, and only once', () => {
  const { detail, hidden } = mount();
  detail.show(item);
  detail.hide();
  assert.equal(hidden.length, 1);
  assert.equal(detail.el.hidden, true);
  detail.el.remove();
});
