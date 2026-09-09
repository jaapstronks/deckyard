import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveImageSetCell } from '../shared/slide-types/types/image-set-slide/images.js';
import { resolveImageTextImage } from '../shared/slide-types/types/image-text-slide/image.js';

/**
 * resolveImageSetCell is the single authority for image-set's per-cell image
 * precedence: the item's own value, or the type default. renderHtml, the canvas
 * focal-point drag and the inspector all read through it, so pinning the rule
 * here keeps those three from drifting apart (the CRDT footgun documented in
 * docs/reference/image-property-ownership.md).
 *
 * The chain is one link long by construction. A set has no slide-level image
 * keys to fall back to - that is what makes `images[i]` the single home for
 * alt, fit and focus (D100), and the absence of a fallback is pinned as
 * explicitly as the presence of the item value.
 */

test('empty content: cell 0 defaults to cover, no override, empty alt', () => {
  const r = resolveImageSetCell({}, 0);
  assert.equal(r.fit, 'cover');
  assert.equal(r.fitOverride, '');
  assert.equal(r.altExplicit, '');
  assert.equal(r.hasOwnFocus, false);
});

test('an item without its own fit follows the type default', () => {
  const r = resolveImageSetCell({ images: [{ src: 'a.jpg' }] }, 0);
  assert.equal(r.fit, 'cover');
  assert.equal(r.fitOverride, '');
});

test('an item fit is the override, and it is reported as one', () => {
  const r = resolveImageSetCell(
    { images: [{ src: 'a.jpg', fit: 'contain' }] },
    0,
  );
  assert.equal(r.fit, 'contain');
  assert.equal(r.fitOverride, 'contain');
});

test('the item alt is the explicit alt; there is no slide-level fallback', () => {
  assert.equal(
    resolveImageSetCell({ images: [{ src: 'a.jpg', alt: 'own' }] }, 0)
      .altExplicit,
    'own',
  );
  // A slide-level `alt` is not a field on this type; a stray one must not be
  // read, or the item would stop being the single home for alt.
  assert.equal(
    resolveImageSetCell({ alt: 'stray', images: [{ src: 'a.jpg' }] }, 0)
      .altExplicit,
    '',
  );
});

test('the item focus is the focus source; there is no slide-level fallback', () => {
  const own = resolveImageSetCell(
    { images: [{ src: 'a.jpg', focusX: 90, focusY: 10 }] },
    0,
  );
  assert.equal(own.hasOwnFocus, true);
  assert.equal(own.focusSource.focusX, 90);
  assert.equal(own.focusSource.focusY, 10);

  const stray = resolveImageSetCell(
    { focusX: 25, focusY: 75, images: [{ src: 'a.jpg' }] },
    0,
  );
  assert.equal(stray.hasOwnFocus, false);
  assert.equal(stray.focusSource.focusX, '');
});

test('every cell resolves the same way — index 0 is not special', () => {
  const content = {
    images: [{ src: 'a.jpg' }, { src: 'b.jpg', alt: 'own', fit: 'contain' }],
  };
  const second = resolveImageSetCell(content, 1);
  assert.equal(second.item.src, 'b.jpg');
  assert.equal(second.altExplicit, 'own');
  assert.equal(second.fit, 'contain');
});

test('a cell past the end resolves to an empty ImageRef, not undefined', () => {
  // renderHtml pads to the minimum cell count, so it asks for cells the stored
  // images[] may not have yet.
  const r = resolveImageSetCell({ images: [{ src: 'a.jpg' }] }, 1);
  assert.equal(r.item.src, '');
  assert.equal(r.fit, 'cover');
  assert.equal(r.altExplicit, '');
});

// ---- image-text: the same authority, one image, flat keys -----------------

/**
 * image-text's counterpart. It is a singleton since D100, so its resolver reads
 * the flat ImageRef (`image`/`alt`/`fit`/`focusX`/`focusY`) and has the same
 * one-link chain: own fit, or the type default.
 */

test('image-text: flat keys resolve, an absent fit follows the type default', () => {
  assert.deepEqual(resolveImageTextImage({ image: ' /a.png ', alt: ' Own ' }), {
    src: '/a.png',
    alt: 'Own',
    fit: 'cover',
    fitExplicit: false,
    focusX: '',
    focusY: '',
  });
});

test('image-text: an explicit fit is reported as explicit', () => {
  const r = resolveImageTextImage({ image: '/a.png', fit: 'contain' });
  assert.equal(r.fit, 'contain');
  assert.equal(r.fitExplicit, true);
  // An explicit `cover` equal to the type default is still the author's choice,
  // so the flag says so - that is what keeps a later default change from
  // silently re-cropping this slide.
  assert.equal(resolveImageTextImage({ fit: 'cover' }).fitExplicit, true);
});

test('image-text: focus carries through untouched, empty when unset', () => {
  const r = resolveImageTextImage({ image: '/a.png', focusX: 25, focusY: 75 });
  assert.equal(r.focusX, 25);
  assert.equal(r.focusY, 75);
  assert.equal(resolveImageTextImage({}).focusX, '');
});

test('image-text: a non-object content resolves to the empty ImageRef', () => {
  assert.equal(resolveImageTextImage(null).src, '');
  assert.equal(resolveImageTextImage(null).fit, 'cover');
});
