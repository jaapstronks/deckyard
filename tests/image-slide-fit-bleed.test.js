import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import {
  resolveImageSlideImage,
  IMAGE_SLIDE_IMAGE_DEFAULTS,
} from '../shared/slide-types/types/image-slide/image.js';
import { migratePresentation } from '../shared/slide-types/schema-version.js';
import { convertSlideToType } from '../shared/slide-types/convert.js';
import { resolveImageTextImage } from '../shared/slide-types/types/image-text-slide/image.js';
import { validateSlide } from '../shared/slide-types/presentation.js';

/**
 * Datamodel-normalisation step 3: image-slide's conflated `layout` splits
 * into the ImageRef axes `fit` + `bleed`. These tests pin the axis classes
 * the render emits, the funnel fold of the legacy enum (full/bleed/centered,
 * schema v19 -> v20, B257-A2), and what each axis does at the conversion seam.
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

test('render: contain + bleed is expressible (the state the old enum could not say)', () => {
  assert.deepEqual(
    axisClasses(slide({ image: '/a.png', fit: 'contain', bleed: true })),
    {
      fit: 'is-fit-contain',
      bleed: true,
      legacy: false,
    },
  );
});

test('render: heading overlays on the bleed axis alone', () => {
  // Non-bleed: heading above the media -> the container carries has-heading.
  const top = render(slide({ image: '/a.png', title: 'T' }));
  assert.match(top, /has-heading/);
  // Bleed (either fit): heading moves into the frame as an overlay.
  const overlayCover = render(
    slide({ image: '/a.png', title: 'T', bleed: true }),
  );
  assert.doesNotMatch(overlayCover, /has-heading/);
  const overlayContain = render(
    slide({ image: '/a.png', title: 'T', fit: 'contain', bleed: true }),
  );
  assert.doesNotMatch(overlayContain, /has-heading/);
});

// ---- Funnel fold: layout -> fit + bleed, then deleted ----------------------

/** Run one image-slide's content through the read funnel; returns it. */
const fold = (content) =>
  migratePresentation({ slides: [{ type: 'image-slide', content }] }).slides[0]
    .content;

test('funnel: layout full is deleted without stamping the defaults', () => {
  const content = fold(slide({ image: '/a.png', layout: 'full' }));
  assert.equal(Object.hasOwn(content, 'layout'), false);
  assert.equal(content.fit ?? '', '', 'default fit is looked up, not stored');
  assert.equal(
    content.bleed ?? '',
    '',
    'default bleed is looked up, not stored',
  );
  assert.deepEqual(axisClasses(content), {
    fit: 'is-fit-cover',
    bleed: false,
    legacy: false,
  });
});

test('funnel: layout bleed folds to bleed=true only', () => {
  const content = fold(slide({ image: '/a.png', layout: 'bleed' }));
  assert.equal(Object.hasOwn(content, 'layout'), false);
  assert.equal(
    content.fit ?? '',
    '',
    'cover equals the default, so not stored',
  );
  assert.equal(content.bleed, true);
  assert.deepEqual(axisClasses(content), {
    fit: 'is-fit-cover',
    bleed: true,
    legacy: false,
  });
});

test('funnel: layout centered folds to fit=contain only', () => {
  const content = fold(slide({ image: '/a.png', layout: 'centered' }));
  assert.equal(Object.hasOwn(content, 'layout'), false);
  assert.equal(content.fit, 'contain');
  assert.equal(content.bleed ?? '', '');
  assert.deepEqual(axisClasses(content), {
    fit: 'is-fit-contain',
    bleed: false,
    legacy: false,
  });
});

test('funnel: an own value on an axis wins over the folded legacy one', () => {
  const fit = fold(
    slide({ image: '/a.png', layout: 'centered', fit: 'cover' }),
  );
  assert.equal(fit.fit, 'cover', 'own fit not clobbered by the legacy fold');
  assert.equal(Object.hasOwn(fit, 'layout'), false);
  const bleed = fold(slide({ image: '/a.png', layout: 'bleed', bleed: false }));
  assert.equal(bleed.bleed, false, 'an explicit boolean beats the legacy');
  const mixed = fold(
    slide({ image: '/a.png', layout: 'bleed', fit: 'contain' }),
  );
  assert.equal(mixed.fit, 'contain', 'own fit kept');
  assert.equal(mixed.bleed, true, 'the empty axis takes the legacy value');
});

test('funnel: an empty or unknown layout is deleted too', () => {
  for (const layout of ['', 'beside', null]) {
    const content = fold(slide({ image: '/a.png', layout }));
    assert.equal(Object.hasOwn(content, 'layout'), false, String(layout));
    assert.equal(content.fit ?? '', '');
    assert.equal(content.bleed ?? '', '');
  }
});

test('funnel: every language version is folded, other types untouched', () => {
  const pres = migratePresentation({
    slides: [{ type: 'image-slide', content: { layout: 'centered' } }],
    i18n: {
      versions: {
        en: {
          slides: [
            { type: 'image-slide', content: { layout: 'bleed' } },
            { type: 'image-text-slide', content: { layout: 'split' } },
          ],
        },
      },
    },
  });
  assert.deepEqual(pres.slides[0].content, { fit: 'contain' });
  const [en, other] = pres.i18n.versions.en.slides;
  assert.deepEqual(en.content, { bleed: true });
  assert.equal(other.content.layout, 'split', 'image-text keeps its layout');
});

test('funnel: idempotent', () => {
  const once = fold(slide({ image: '/a.png', layout: 'bleed' }));
  const twice = fold(structuredClone(once));
  assert.deepEqual(twice, once);
});

// ---- Resolution authority ---------------------------------------------------

test('resolve: own value -> type default, per axis; layout is not read', () => {
  assert.equal(resolveImageSlideImage({}).fit, 'cover');
  assert.equal(resolveImageSlideImage({}).bleed, false);
  assert.equal(resolveImageSlideImage({ fit: 'contain' }).fit, 'contain');
  assert.equal(resolveImageSlideImage({ bleed: true }).bleed, true);
  // Past the funnel nothing carries the enum, so the resolver knows no third
  // spelling: a stray value reads as the type default.
  assert.equal(resolveImageSlideImage({ layout: 'centered' }).fit, 'cover');
  assert.equal(resolveImageSlideImage({ layout: 'bleed' }).bleed, false);
});

// ---- Conversion: fit travels to image-text, bleed does not ------------------

test('convert: bleed image-slide -> image-text drops bleed and keeps the fit', () => {
  // The two axes part ways at the seam. `fit` means the same on image-text and
  // travels; `bleed` has no renderer there, and a carried-but-unrendered key is
  // a hidden field, so it is dropped rather than stored where nothing reads it
  // (D100). The seam declares it consumed, so the drop raises no confirm - see
  // tests/image-ref-round-trip.test.js.
  const src = {
    id: 's1',
    type: 'image-slide',
    content: {
      ...structuredClone(DEF.defaults),
      image: '/x.png',
      bleed: true,
      title: 'T',
    },
  };
  const next = convertSlideToType(src, 'image-text-slide', { lang: 'nl' });
  assert.equal(next.content.bleed, undefined, 'bleed does not travel');
  assert.equal(
    next.content.fit ?? '',
    '',
    'bleed resolves to cover = default, so no fit written',
  );
  assert.equal(resolveImageTextImage(next.content).fit, 'cover');
});

// ---- Validation: the boolean field type -------------------------------------

test('validate: bleed accepts booleans and the cleared empty string, rejects strings', () => {
  const base = {
    id: '00000000-0000-4000-8000-000000000001',
    type: 'image-slide',
    content: slide({ image: '/a.png' }),
  };
  const withBleed = (v) => ({
    ...base,
    content: { ...base.content, bleed: v },
  });
  assert.deepEqual(validateSlide(withBleed(true)), []);
  assert.deepEqual(validateSlide(withBleed(false)), []);
  assert.deepEqual(validateSlide(withBleed('')), []);
  assert.ok(
    validateSlide(withBleed('on')).length,
    'a string bleed is rejected',
  );
});
