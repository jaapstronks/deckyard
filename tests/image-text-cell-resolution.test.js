import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveImageTextCell } from '../shared/slide-types/image-text-images.js';

/**
 * resolveImageTextCell is the single authority for image-text's per-cell
 * image precedence (item wins; cell 0 falls back to slide-level alt/focus;
 * slide `imageFit` is the base fit). renderHtml, the canvas focal-point drag
 * and the inspector all read through it, so pinning the rule here keeps those
 * three from drifting apart (the CRDT footgun documented in
 * docs/reference/image-property-ownership.md). Datamodel track step 1.
 */

test('empty content: cell 0 defaults to cover, no override, empty alt', () => {
  const r = resolveImageTextCell({}, 0);
  assert.equal(r.fit, 'cover');
  assert.equal(r.fitOverride, '');
  assert.equal(r.altExplicit, '');
  assert.equal(r.hasOwnFocus, false);
});

test('slide-level imageFit is the base fit for a cell with no override', () => {
  const r = resolveImageTextCell({ imageFit: 'contain', images: [{ src: 'a.jpg' }] }, 0);
  assert.equal(r.fit, 'contain');
  assert.equal(r.fitOverride, '');
});

test('item fit overrides the slide-level imageFit', () => {
  const content = { imageFit: 'cover', images: [{ src: 'a.jpg', fit: 'contain' }] };
  const r = resolveImageTextCell(content, 0);
  assert.equal(r.fit, 'contain');
  assert.equal(r.fitOverride, 'contain');
});

test('cell 0 falls back to slide-level alt when the item has none', () => {
  const r = resolveImageTextCell({ alt: 'slide alt', images: [{ src: 'a.jpg' }] }, 0);
  assert.equal(r.altExplicit, 'slide alt');
});

test('cell 0 slide-level alt fallback order: alt, then altNl, then altEn', () => {
  assert.equal(resolveImageTextCell({ altNl: 'nl', altEn: 'en', images: [{ src: 'a.jpg' }] }, 0).altExplicit, 'nl');
  assert.equal(resolveImageTextCell({ altEn: 'en', images: [{ src: 'a.jpg' }] }, 0).altExplicit, 'en');
});

test("item alt wins over the slide-level fallback", () => {
  const r = resolveImageTextCell({ alt: 'slide', images: [{ src: 'a.jpg', alt: 'own' }] }, 0);
  assert.equal(r.altExplicit, 'own');
});

test('cell >0 does NOT inherit the slide-level alt/focus', () => {
  const content = { alt: 'slide', focusX: 10, focusY: 20, images: [{ src: 'a.jpg' }, { src: 'b.jpg' }] };
  const r = resolveImageTextCell(content, 1);
  assert.equal(r.altExplicit, '');
  assert.equal(r.hasOwnFocus, false);
  // focusSource is the (empty) item, NOT the slide — so the renderer defaults it.
  assert.equal(r.focusSource.focusX, '');
});

test('cell 0 without own focus reads the slide-level focus point', () => {
  const content = { focusX: 25, focusY: 75, images: [{ src: 'a.jpg' }] };
  const r = resolveImageTextCell(content, 0);
  assert.equal(r.hasOwnFocus, false);
  assert.equal(r.focusSource.focusX, 25);
  assert.equal(r.focusSource.focusY, 75);
});

test('a cell with its own focus point wins over the slide-level one', () => {
  const content = { focusX: 25, focusY: 75, images: [{ src: 'a.jpg', focusX: 90, focusY: 10 }] };
  const r = resolveImageTextCell(content, 0);
  assert.equal(r.hasOwnFocus, true);
  assert.equal(r.focusSource.focusX, 90);
  assert.equal(r.focusSource.focusY, 10);
});

test('legacy flat image folds into cell 0 (slide-level alt/focus still apply)', () => {
  const content = { image: 'legacy.jpg', alt: 'legacy alt', focusX: 40 };
  const r = resolveImageTextCell(content, 0);
  assert.equal(r.item.src, 'legacy.jpg');
  assert.equal(r.altExplicit, 'legacy alt');
  assert.equal(r.focusSource.focusX, 40);
});
