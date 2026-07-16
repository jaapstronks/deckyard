/**
 * Bulk-edit modal: locked-slide gating. The panel's read-only state for
 * locked slides is CSS scoped to .editor-shell, which can't reach a modal
 * mounted on document.body - so the modal mirrors it itself via the
 * getSlideLockKind seam: is-locked class + visible banner, cleared again
 * when navigating back to an editable slide.
 *
 * Run with: node --test tests/bulk-edit-modal-lock.test.js
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
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame || clearTimeout;
globalThis.ResizeObserver =
  dom.window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const { h } = await import('../client/lib/dom.js');
const { createBulkEditModal } = await import('../client/views/editor/bulk-edit-modal.js');

test('modal gates its form pane on locked slides and releases it again', () => {
  const pres = {
    id: 'p1',
    slides: [
      { id: 's1', type: 'content-slide', content: {} },
      { id: 's2', type: 'content-slide', content: {} },
    ],
  };
  let selectedId = 's1';
  const modalApi = createBulkEditModal({
    h,
    pres,
    getSelectedSlideId: () => selectedId,
    setSelectedSlideId: (v) => {
      selectedId = v;
    },
    createFormRenderer: () => () => {},
    getSlideLockKind: (slideId) => (slideId === 's2' ? 'author' : null),
    openOverlayClosers: new Set(),
  });
  modalApi.open();

  const modalEl = document.querySelector('.bulk-edit-modal');
  const note = document.querySelector('.bulk-edit-locked-note');
  assert.ok(modalEl, 'modal renders');
  assert.equal(modalEl.classList.contains('is-locked'), false, 'editable slide: not locked');
  assert.equal(note.hidden, true, 'editable slide: banner hidden');

  const nextBtn = [...modalEl.querySelectorAll('button')].find((b) => b.textContent === '›');
  nextBtn.click();
  assert.equal(selectedId, 's2', 'navigated through the selection seam');
  assert.equal(modalEl.classList.contains('is-locked'), true, 'locked slide: is-locked set');
  assert.equal(note.hidden, false, 'locked slide: banner visible');
  assert.ok(note.textContent.length > 0, 'banner has text');

  const prevBtn = [...modalEl.querySelectorAll('button')].find((b) => b.textContent === '‹');
  prevBtn.click();
  assert.equal(modalEl.classList.contains('is-locked'), false, 'back on editable slide: released');
  assert.equal(note.hidden, true, 'banner hidden again');
});
