import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES, validateSlide } from '../shared/slide-types/index.js';
import {
  resolveContentColumnImage,
  ensureContentColumnsImages,
  CONTENT_COLUMNS_IMAGE_DEFAULTS,
} from '../shared/slide-types/content-columns-images.js';
import { convertSlideToType } from '../shared/slide-types/convert.js';

/**
 * Datamodel-normalisation step 4: content-columns' numbered col{n}* image
 * keys resolve into the canonical ImageRef through one authority, the type
 * declares its image defaults as config instead of stamping them into every
 * deck, and the editor fold drops the historically stamped default-equal
 * values (cover + focus 50/50) so empty means "follow the type" again.
 */

const DEF = SLIDE_TYPES['content-columns-slide'];
const render = (content) => DEF.renderHtml(content);
const slide = (content = {}) => ({
  ...structuredClone(DEF.defaults),
  ...content,
});

// ---- Config anchor: defaults are looked up, not stamped ---------------------

test('defaults: new decks carry no per-column fit/focus (config, not record)', () => {
  for (const defaults of [DEF.defaults, DEF.defaultsByLang?.nl, DEF.defaultsByLang?.['en-GB']]) {
    assert.ok(defaults, 'defaults block exists');
    for (let n = 1; n <= 7; n += 1) {
      assert.equal(defaults[`col${n}ImageFit`], undefined, `col${n}ImageFit not stamped`);
      assert.equal(defaults[`col${n}ImageFocusX`], undefined, `col${n}ImageFocusX not stamped`);
      assert.equal(defaults[`col${n}ImageFocusY`], undefined, `col${n}ImageFocusY not stamped`);
    }
  }
  assert.equal(DEF.imageDefaults, CONTENT_COLUMNS_IMAGE_DEFAULTS, 'the type declares its config anchor');
  assert.equal(CONTENT_COLUMNS_IMAGE_DEFAULTS.fit, 'cover');
});

// ---- Resolution authority ---------------------------------------------------

test('resolve: own value -> type default, per column', () => {
  const content = slide({
    col1Image: '/a.png',
    col2Image: '/b.png',
    col2ImageFit: 'contain',
    col2ImageFocusX: 30,
    col2ImageFocusY: 70,
  });
  const c1 = resolveContentColumnImage(content, 1);
  assert.equal(c1.fit, 'cover', 'unset fit follows the type default');
  assert.equal(c1.fitExplicit, false);
  assert.equal(c1.hasOwnFocus, false);
  const c2 = resolveContentColumnImage(content, 2);
  assert.equal(c2.fit, 'contain');
  assert.equal(c2.fitExplicit, true);
  assert.deepEqual([c2.focusX, c2.focusY], [30, 70]);
});

// ---- Render reads through the authority -------------------------------------

test('render: unset fit renders the default cover class, explicit contain deviates', () => {
  const html = render(slide({
    columnCount: '2',
    col1Image: '/a.png',
    col2Image: '/b.png',
    col2ImageFit: 'contain',
  }));
  assert.match(html, /cc-image is-cover/);
  assert.match(html, /cc-image is-contain/);
});

// ---- Editor fold: stamped default-equal values drop -------------------------

test('migration: stamped cover + 50/50 drop; render stays visually identical', () => {
  // The old type defaults wrote these onto every column of every new deck.
  const content = slide({
    columnCount: '1',
    col1Image: '/a.png',
    col1ImageFit: 'cover',
    col1ImageFocusX: 50,
    col1ImageFocusY: 50,
  });
  ensureContentColumnsImages(content);
  assert.equal(content.col1ImageFit, '');
  assert.equal(content.col1ImageFocusX, '');
  assert.equal(content.col1ImageFocusY, '');
  const html = render(content);
  // Same fit class; the dropped 50/50 focus falls back to object-position's
  // own initial value (50% 50%), so no explicit style is needed.
  assert.match(html, /cc-image is-cover/);
  assert.doesNotMatch(html, /object-position/);
});

test('migration: deviating values are user choices and stay', () => {
  const content = slide({
    columnCount: '1',
    col1Image: '/a.png',
    col1ImageFit: 'contain',
    col1ImageFocusX: 25,
    col1ImageFocusY: 75,
  });
  const before = render(structuredClone(content));
  ensureContentColumnsImages(content);
  assert.equal(content.col1ImageFit, 'contain');
  assert.equal(content.col1ImageFocusX, 25);
  assert.equal(content.col1ImageFocusY, 75);
  assert.equal(render(content), before, 'render byte-identical');
});

test('migration: idempotent', () => {
  const content = slide({ col1Image: '/a.png', col1ImageFit: 'cover', col1ImageFocusX: 50, col1ImageFocusY: 50 });
  ensureContentColumnsImages(content);
  const once = structuredClone(content);
  ensureContentColumnsImages(content);
  assert.deepEqual(content, once);
});

// ---- Conversion: only deviating fits are written ----------------------------

test('convert: image-text -> content-columns writes fit only when it deviates', () => {
  const IT = SLIDE_TYPES['image-text-slide'];
  const src = (images) => ({
    id: 's1',
    type: 'image-text-slide',
    content: { ...structuredClone(IT.defaults), images, body: '- a\n- b' },
  });
  // Default cover: no fit key lands on the column (empty = follow the type).
  const covered = convertSlideToType(src([{ src: '/a.png' }]), 'content-columns-slide', { lang: 'nl' });
  assert.equal(covered.content.col1Image, '/a.png');
  assert.equal(covered.content.col1ImageFit, undefined);
  // Explicit contain deviates and travels.
  const contained = convertSlideToType(
    src([{ src: '/a.png', fit: 'contain' }]),
    'content-columns-slide',
    { lang: 'nl' }
  );
  assert.equal(contained.content.col1ImageFit, 'contain');
});

// ---- Validation: folded '' values survive an API round-trip -----------------

test('validate: folded/cleared image values (the \'\' convention) stay valid', () => {
  // The editor fold and the silent-default controls write '' into cleared
  // fields. validateSlide gates the public API PUT path, so this content must
  // round-trip without errors — for every type the datamodel track folds.
  const cases = [
    {
      type: 'content-columns-slide',
      content: {
        ...structuredClone(DEF.defaults),
        col1Image: '/a.png',
        col1ImageFit: '',
        col1ImageFocusX: '',
        col1ImageFocusY: '',
      },
    },
    { type: 'image-slide', content: { image: '/a.png', fit: '', layout: '' } },
    {
      type: 'image-text-slide',
      content: {
        ...structuredClone(SLIDE_TYPES['image-text-slide'].defaults),
        images: [{ src: '/a.png' }],
        imageFit: '',
      },
    },
  ];
  for (const { type, content } of cases) {
    const errors = validateSlide({
      id: 'bf5b964b-1561-4451-a692-47adf5bf7bbb',
      type,
      content,
    });
    assert.deepEqual(errors, [], `${type} folded content validates`);
  }
});

test('validate: a bogus enum value is still rejected', () => {
  const errors = validateSlide({
    id: 'bf5b964b-1561-4451-a692-47adf5bf7bbb',
    type: 'content-columns-slide',
    content: { ...structuredClone(DEF.defaults), col1Image: '/a.png', col1ImageFit: 'stretch' },
  });
  assert.ok(
    errors.some((e) => e.includes('col1ImageFit')),
    'non-empty invalid enum value still errors'
  );
});
