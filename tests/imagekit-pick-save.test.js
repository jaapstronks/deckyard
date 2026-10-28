/**
 * An ImageKit pick leaves a slide savable (DY-770).
 *
 * Strict validation (D359) refuses a top-level content key the type does not
 * declare. The image field and "Choose image" used to write the pick's
 * provider id as `content.imagekitFileId`, which no type declares, so the
 * next save of any slide with a picked ImageKit image was refused with
 * `unknown_field`. Nothing reads that id (the image is copied into the
 * install's own media on pick), so no write path stores it any more.
 *
 * Each case drives the real write path with a pick carrying a `providerId`,
 * then validates the slide the way `save-presentation.js` does: the real
 * registry, with the stored slide as `previousSlide`.
 *
 * Run with: node --test tests/imagekit-pick-save.test.js
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

const { createFieldImage } =
  await import('../client/views/editor/fields/images/single-image.js');
const { pickMissingPicture } =
  await import('../client/views/editor/media/pick-missing-picture.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { assertValidSlideFields } =
  await import('../server/services/slide-field-validation.js');

/** What the ImageKit adapter hands a call site after copy-on-pick. */
const PICK = Object.freeze({
  url: '/uploads/media/copied.jpg',
  alt: 'A picked picture',
  providerId: 'ik-file-123',
});

const PRES = { id: 'p1', title: 'Deck', i18n: { active: 'en' } };

/** A picker seam that yields `PICK` the moment it is opened. */
function stubPicker() {
  const openImagePicker = (opts) => opts.onPick({ ...PICK });
  openImagePicker.providers = ['imagekit'];
  return openImagePicker;
}

/** A slide of `type` with the type's defaults, as a new slide is stored. */
function storedSlide(type) {
  const def = SLIDE_TYPES[type];
  return {
    id: `s-${type}`,
    type,
    content: structuredClone(def?.defaults || {}),
  };
}

/** Validate `slide` as the deck save does, against `stored`. */
function assertSavable(slide, stored) {
  assert.doesNotThrow(
    () =>
      assertValidSlideFields(slide, SLIDE_TYPES, {
        lang: 'en',
        previousSlide: stored,
      }),
    `${slide.type} refuses its save after an ImageKit pick`,
  );
}

/**
 * Every core type with a top-level image field the side form draws with
 * `createFieldImage`, and that field. A `presetSource: 'backgrounds'` field
 * (the shared `slideBgImage`) goes to `title-bg-image.js` instead, which
 * stores the URL only (`render-field.js`).
 */
const IMAGE_FIELDS = Object.entries(SLIDE_TYPES).flatMap(([type, def]) =>
  (Array.isArray(def?.fields) ? def.fields : [])
    .filter(
      (field) =>
        field?.type === 'image' && field.presetSource !== 'backgrounds',
    )
    .map((field) => ({ type, field })),
);

test('image-slide and image-text-slide carry an image field', () => {
  const types = new Set(IMAGE_FIELDS.map(({ type }) => type));
  assert.ok(types.has('image-slide'));
  assert.ok(types.has('image-text-slide'));
});

for (const { type, field } of IMAGE_FIELDS) {
  test(`image field ${type}.${field.key}: pick, then save`, () => {
    const stored = storedSlide(type);
    const slide = structuredClone(stored);
    const fieldImage = createFieldImage({
      openImagePicker: stubPicker(),
      pres: PRES,
      normalizeLang: (lang) => lang,
      markDirty: () => {},
      scheduleUiRefresh: () => {},
      rerenderEditor: () => {},
    });
    const node = fieldImage(slide, field, (url) => {
      slide.content[field.key] = url;
    });
    document.body.replaceChildren(node);
    node.querySelector('button').click();

    assert.equal(slide.content[field.key], PICK.url);
    assert.equal(Object.hasOwn(slide.content, 'imagekitFileId'), false);
    assertSavable(slide, stored);
  });
}

for (const type of ['image-slide', 'image-text-slide']) {
  test(`Choose image on an incomplete ${type}: pick, then save`, () => {
    const stored = storedSlide(type);
    const field = SLIDE_TYPES[type].fields.find((f) => f.type === 'image');
    stored.content[field.key] = '';
    const slide = structuredClone(stored);
    let picked = 0;
    pickMissingPicture({
      openImagePicker: stubPicker(),
      slide,
      slideTypes: SLIDE_TYPES,
      pres: PRES,
      onPicked: () => {
        picked += 1;
      },
    });

    assert.equal(picked, 1, 'the slide lacked its essential picture');
    assert.equal(slide.content[field.key], PICK.url);
    assert.equal(Object.hasOwn(slide.content, 'imagekitFileId'), false);
    assertSavable(slide, stored);
  });
}
