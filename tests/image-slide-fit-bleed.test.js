import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import {
  resolveImageSlideImage,
  ensureImageSlideImage,
  IMAGE_SLIDE_IMAGE_DEFAULTS,
} from '../shared/slide-types/image-slide-image.js';
import { convertSlideToType } from '../shared/slide-types/convert.js';
import {
  ensureImageTextImages,
  imageTextImageItems,
} from '../shared/slide-types/image-text-images.js';
import { validateSlide } from '../shared/slide-types/presentation.js';

/**
 * Datamodel-normalisation step 3: image-slide's conflated `layout` splits
 * into the ImageRef axes `fit` + `bleed`. These tests pin the axis classes
 * the render emits, the legacy mapping (full/bleed/centered), the editor
 * fold, and the lossless travel of `bleed` through the conversion seam.
 */

const DEF = SLIDE_TYPES['image-slide'];
const render = (content) => DEF.renderHtml(content);
const slide = (content = {}) => ({
  ...structuredClone(DEF.defaults),
  ...content,
});

const axisClasses = (content) => {
  const html = render(content);
  return {
    fit: (html.match(/is-fit-(?:cover|contain)/) || [null])[0],
    bleed: /class="slide slide-image [^"]*is-bleed/.test(html),
    legacy: /slide-image-(?:full|bleed|centered)/.test(html),
  };
};

// ---- Render: axis classes + legacy mapping ---------------------------------

test('render: defaults resolve to cover, no bleed, no legacy class', () => {
  assert.deepEqual(axisClasses(slide({ image: '/a.png' })), {
    fit: 'is-fit-cover',
    bleed: false,
    legacy: false,
  });
  assert.equal(IMAGE_SLIDE_IMAGE_DEFAULTS.fit, 'cover');
  assert.equal(IMAGE_SLIDE_IMAGE_DEFAULTS.bleed, false);
});

test('render: legacy layout values map onto the axes (read-only fallback)', () => {
  assert.deepEqual(axisClasses(slide({ image: '/a.png', layout: 'full' })), {
    fit: 'is-fit-cover', bleed: false, legacy: false,
  });
  assert.deepEqual(axisClasses(slide({ image: '/a.png', layout: 'bleed' })), {
    fit: 'is-fit-cover', bleed: true, legacy: false,
  });
  assert.deepEqual(axisClasses(slide({ image: '/a.png', layout: 'centered' })), {
    fit: 'is-fit-contain', bleed: false, legacy: false,
  });
});

test('render: contain + bleed is expressible (the state the old enum could not say)', () => {
  assert.deepEqual(axisClasses(slide({ image: '/a.png', fit: 'contain', bleed: true })), {
    fit: 'is-fit-contain', bleed: true, legacy: false,
  });
});

test('render: heading overlays on the bleed axis alone', () => {
  // Non-bleed: heading above the media -> the container carries has-heading.
  const top = render(slide({ image: '/a.png', title: 'T' }));
  assert.match(top, /has-heading/);
  // Bleed (either fit): heading moves into the frame as an overlay.
  const overlayCover = render(slide({ image: '/a.png', title: 'T', bleed: true }));
  assert.doesNotMatch(overlayCover, /has-heading/);
  const overlayContain = render(
    slide({ image: '/a.png', title: 'T', fit: 'contain', bleed: true })
  );
  assert.doesNotMatch(overlayContain, /has-heading/);
});

// ---- Editor fold: layout -> fit + bleed ------------------------------------

test('migration: layout full is dropped without stamping the defaults', () => {
  const content = slide({ image: '/a.png', layout: 'full' });
  const before = render(structuredClone(content));
  ensureImageSlideImage(content);
  assert.equal(content.layout, '');
  assert.equal(content.fit ?? '', '', 'default fit is looked up, not stored');
  assert.equal(content.bleed ?? '', '', 'default bleed is looked up, not stored');
  assert.equal(render(content), before, 'render-identical');
});

test('migration: layout bleed folds to bleed=true only', () => {
  const content = slide({ image: '/a.png', layout: 'bleed' });
  const before = render(structuredClone(content));
  ensureImageSlideImage(content);
  assert.equal(content.layout, '');
  assert.equal(content.fit ?? '', '', 'cover equals the default, so not stored');
  assert.equal(content.bleed, true);
  assert.equal(render(content), before, 'render-identical');
});

test('migration: layout centered folds to fit=contain only', () => {
  const content = slide({ image: '/a.png', layout: 'centered' });
  const before = render(structuredClone(content));
  ensureImageSlideImage(content);
  assert.equal(content.layout, '');
  assert.equal(content.fit, 'contain');
  assert.equal(content.bleed ?? '', '');
  assert.equal(render(content), before, 'render-identical');
});

test('migration: an explicit own value wins over the folded legacy one', () => {
  const content = slide({ image: '/a.png', layout: 'centered', fit: 'cover' });
  ensureImageSlideImage(content);
  assert.equal(content.fit, 'cover', 'own fit not clobbered by the legacy fold');
  assert.equal(content.layout, '');
});

test('migration: idempotent', () => {
  const content = slide({ image: '/a.png', layout: 'bleed' });
  ensureImageSlideImage(content);
  const once = structuredClone(content);
  ensureImageSlideImage(content);
  assert.deepEqual(content, once);
});

// ---- Resolution authority ---------------------------------------------------

test('resolve: own value -> legacy layout -> type default, per axis', () => {
  assert.equal(resolveImageSlideImage({}).fit, 'cover');
  assert.equal(resolveImageSlideImage({}).bleed, false);
  assert.equal(resolveImageSlideImage({ layout: 'centered' }).fit, 'contain');
  assert.equal(resolveImageSlideImage({ layout: 'bleed' }).bleed, true);
  // Own values win over legacy, per axis independently.
  const mixed = resolveImageSlideImage({ layout: 'bleed', fit: 'contain' });
  assert.equal(mixed.fit, 'contain', 'own fit wins');
  assert.equal(mixed.bleed, true, 'bleed still reads the legacy layout');
  assert.equal(
    resolveImageSlideImage({ layout: 'bleed', bleed: false }).bleed,
    false,
    'an explicit boolean beats the legacy layout'
  );
});

// ---- Conversion: bleed travels losslessly to image-text ---------------------

test('convert: bleed image-slide -> image-text carries bleed on the ImageRef', () => {
  const src = {
    id: 's1',
    type: 'image-slide',
    content: { ...structuredClone(DEF.defaults), image: '/x.png', layout: 'bleed', title: 'T' },
  };
  const next = convertSlideToType(src, 'image-text-slide', { lang: 'nl' });
  assert.equal(next.content.images[0].bleed, true, 'bleed travels, not guessed away');
  assert.equal(next.content.images[0].fit ?? '', '', 'cover = default, so no fit written');
  // The image-text item sanitizer keeps the property through editor passes.
  ensureImageTextImages(next.content);
  assert.equal(imageTextImageItems(next.content)[0].bleed, true);
});

// ---- Validation: the boolean field type -------------------------------------

test('validate: bleed accepts booleans and the cleared empty string, rejects strings', () => {
  const base = {
    id: '00000000-0000-4000-8000-000000000001',
    type: 'image-slide',
    content: slide({ image: '/a.png' }),
  };
  const withBleed = (v) => ({ ...base, content: { ...base.content, bleed: v } });
  assert.deepEqual(validateSlide(withBleed(true)), []);
  assert.deepEqual(validateSlide(withBleed(false)), []);
  assert.deepEqual(validateSlide(withBleed('')), []);
  assert.ok(validateSlide(withBleed('on')).length, 'a string bleed is rejected');
});
