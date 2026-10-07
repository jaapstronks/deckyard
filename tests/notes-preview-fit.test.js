/**
 * The speaker-notes view fits the current slide on both axes (B594).
 *
 * The current-slide preview used to scale to its width only while the shell
 * squeezed its height: at 1440×900 the slide was 810 px tall inside a 270 px
 * box and its lower part was cut off. The preview now sits in its own stage,
 * apart from the up-next preview, notes and Q&A, and is fitted into that stage
 * with attachThumbScaleContain(). These tests pin the scaffold and the fit
 * arithmetic; the real geometry is checked in a browser.
 *
 * Run with: node --test tests/notes-preview-fit.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/notes/session-1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = () => 0;

const { buildNotesLayout } = await import('../client/views/notes/layout.js');
const { attachThumbScaleContain } =
  await import('../client/lib/slide-runtime/thumb-scale.js');

test('the current slide has a stage of its own, apart from the side zone', () => {
  const ui = buildNotesLayout();
  assert.equal(ui.previewWrap.parentElement, ui.previewStage);
  assert.ok(ui.previewStage.closest('.notes-main'));
  for (const el of [ui.nextPreviewWrap, ui.notesWrap, ui.qaWrap]) {
    assert.ok(el.closest('.notes-side'));
    assert.equal(el.closest('.notes-main'), null);
  }
});

/** A length in px from an inline style, rounded to 0.01 px. */
const px = (value) => Math.round(parseFloat(value) * 100) / 100;

/** A stage element that reports a fixed layout size. */
function stageOf(width, height) {
  const stage = document.createElement('div');
  Object.defineProperty(stage, 'clientWidth', { value: width });
  Object.defineProperty(stage, 'clientHeight', { value: height });
  const thumb = document.createElement('div');
  stage.append(thumb);
  return { stage, thumb };
}

test('a wide stage fits the slide to its width', () => {
  const { stage, thumb } = stageOf(980, 773);
  const detach = attachThumbScaleContain(thumb, { containerEl: stage });
  assert.equal(px(thumb.style.width), 980);
  assert.equal(px(thumb.style.height), 551.25);
  detach();
});

test('a low stage fits the slide to its height instead of cutting it off', () => {
  const { stage, thumb } = stageOf(1440, 270);
  const detach = attachThumbScaleContain(thumb, { containerEl: stage });
  assert.equal(px(thumb.style.height), 270);
  assert.equal(px(thumb.style.width), 480);
  assert.equal(px(thumb.style.getPropertyValue('--thumb-scale')), 0.3);
  detach();
});
