import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types/index.js';
import {
  convertSlideToType,
  getConvertibleSlideTypes,
  getConversionLossyKeys,
} from '../shared/slide-types/convert.js';
import { INLINE_DESCRIPTORS } from '../client/views/editor/inline-edit/descriptors.js';

/**
 * WYSIWYG add/remove image = type switch content <-> image-text (phase 0 of
 * the image-text layout-catalogue track). The inline affordances surface the
 * intent; the shared convert seam is the only mutation path. These tests pin
 * the seam behaviour the affordances rely on.
 */

const contentSlide = (content = {}) => ({
  id: 'slide-1',
  type: 'content-slide',
  notes: 'presenter notes',
  content: {
    ...structuredClone(SLIDE_TYPES['content-slide'].defaults),
    ...content,
  },
});

const imageTextSlide = (content = {}) => ({
  id: 'slide-2',
  type: 'image-text-slide',
  notes: 'presenter notes',
  content: {
    ...structuredClone(SLIDE_TYPES['image-text-slide'].defaults),
    ...content,
  },
});

test('convert seam offers the pair in both directions', () => {
  assert.deepEqual(getConvertibleSlideTypes(contentSlide()), ['image-text-slide']);
  assert.deepEqual(getConvertibleSlideTypes(imageTextSlide()), ['content-slide']);
});

test('content -> image-text: lossless for the pair, image starts empty', () => {
  const slide = contentSlide({ title: 'Titel', body: '- punt', background: 'mist' });
  const next = convertSlideToType(slide, 'image-text-slide', { lang: 'nl' });

  assert.equal(next.id, 'slide-1', 'slide id survives (comments/locks/URL)');
  assert.equal(next.notes, 'presenter notes', 'notes survive');
  assert.equal(next.type, 'image-text-slide');
  assert.equal(next.content.title, 'Titel');
  assert.equal(next.content.body, '- punt');
  assert.equal(next.content.background, 'mist');
  assert.equal(next.content.image, '', 'no image yet - placeholder takes over');
});

test('image-text -> content: title/body/notes survive, image area drops', () => {
  const slide = imageTextSlide({ title: 'Titel', body: '- punt', background: 'dark' });
  const next = convertSlideToType(slide, 'content-slide', { lang: 'nl' });

  assert.equal(next.id, 'slide-2');
  assert.equal(next.notes, 'presenter notes');
  assert.equal(next.type, 'content-slide');
  assert.equal(next.content.title, 'Titel');
  assert.equal(next.content.body, '- punt');
  assert.equal(next.content.background, 'dark');
  assert.equal(next.content.image, undefined, 'image fields do not leak along');
});

test('global cross-type fields survive the switch', () => {
  const slide = contentSlide({ slideBgImage: '/bg.png', slideLogo: 'top-right' });
  const next = convertSlideToType(slide, 'image-text-slide', { lang: 'nl' });
  assert.equal(next.content.slideBgImage, '/bg.png');
  assert.equal(next.content.slideLogo, 'top-right');
});

test('lossy confirm stays quiet for defaults in both directions', () => {
  // content -> image-text: `layout` is consumed (no equivalent, deliberate).
  assert.deepEqual(getConversionLossyKeys(contentSlide(), 'image-text-slide'), []);
  assert.deepEqual(
    getConversionLossyKeys(contentSlide({ layout: 'two-column' }), 'image-text-slide'),
    []
  );
  // image-text -> content: the image-area housekeeping enums (and focus) are
  // the point of the removal, not data loss.
  assert.deepEqual(
    getConversionLossyKeys(imageTextSlide({ focusX: 30, focusY: 60 }), 'content-slide'),
    []
  );
});

test('lossy confirm still fires for real content (image, caption, alt)', () => {
  const filled = imageTextSlide({ image: '/x.png', caption: 'cap', alt: 'alt' });
  const lossy = getConversionLossyKeys(filled, 'content-slide');
  assert.deepEqual([...lossy].sort(), ['alt', 'caption', 'image']);
});

test('descriptor convert entries point at supported conversions', () => {
  const add = INLINE_DESCRIPTORS['content-slide']?.convert?.addMedia;
  assert.equal(add?.toType, 'image-text-slide');
  assert.ok(
    getConvertibleSlideTypes(contentSlide()).includes(add.toType),
    'addMedia target is supported by the seam'
  );

  const rem = INLINE_DESCRIPTORS['image-text-slide']?.convert?.removeMedia;
  assert.equal(rem?.toType, 'content-slide');
  assert.ok(
    getConvertibleSlideTypes(imageTextSlide()).includes(rem.toType),
    'removeMedia target is supported by the seam'
  );
});

test('removeMedia selector matches the rendered empty placeholder only', () => {
  const rem = INLINE_DESCRIPTORS['image-text-slide'].convert.removeMedia;
  // The selector contract: empty image renders a matching placeholder…
  const empty = SLIDE_TYPES['image-text-slide'].renderHtml({ title: 'T', body: 'b' });
  assert.match(empty, /image-placeholder is-empty[^>]*data-inline-photo="0"/s);
  assert.ok(rem.selector.includes('.image-placeholder.is-empty'));
  // …and a filled image renders no placeholder, so the × cannot appear.
  const filled = SLIDE_TYPES['image-text-slide'].renderHtml({
    title: 'T',
    body: 'b',
    image: '/y.png',
  });
  assert.ok(!filled.includes('image-placeholder'));
});

test('addMedia anchor exists in the rendered content slide', () => {
  const add = INLINE_DESCRIPTORS['content-slide'].convert.addMedia;
  const html = SLIDE_TYPES['content-slide'].renderHtml({ title: 'T', body: 'b' });
  assert.equal(add.anchors[0].sel, '.slide-inner');
  assert.match(html, /class="slide-inner"/);
});
