import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import {
  getLayoutVariants,
  activeLayoutVariantId,
  applyLayoutVariant,
} from '../shared/slide-types/layout-variants.js';
import { getConvertibleSlideTypes } from '../shared/slide-types/convert.js';
import {
  IMAGE_SET_MAX_IMAGES,
  IMAGE_SET_MIN_IMAGES,
  imageSetCellCount,
  ensureImageSetImages,
} from '../shared/slide-types/types/image-set-slide/images.js';

/**
 * Image-set's layout catalogue and render contract. The type's one rule is that
 * the layout moves the set around, it never resizes it: the cell count is the
 * image count in every layout, clamped to the 2-3 the type declares. That is
 * what separates it from image-text, where the layout used to decide how many
 * images were read (D100).
 */

const DEF = SLIDE_TYPES['image-set-slide'];
const LAYOUTS = ['beside', 'top', 'bottom'];

const slide = (content = {}) => ({
  id: 'slide-1',
  type: 'image-set-slide',
  notes: '',
  content: { ...structuredClone(DEF.defaults), ...content },
});

// ---- Cell count: the layout never changes the size of the set -------------

test('imageSetCellCount: the image count clamped to the declared 2-3', () => {
  assert.equal(imageSetCellCount({}), IMAGE_SET_MIN_IMAGES);
  assert.equal(imageSetCellCount({ images: [{ src: '/a' }] }), 2);
  assert.equal(imageSetCellCount({ images: [{}, {}] }), 2);
  assert.equal(imageSetCellCount({ images: [{}, {}, {}] }), 3);
  assert.equal(
    imageSetCellCount({ images: [{}, {}, {}, {}] }),
    IMAGE_SET_MAX_IMAGES,
    'a fourth image is not a fourth cell',
  );
});

test('render: every layout renders clamp(images.length, 2, 3) frames', () => {
  for (const layout of LAYOUTS) {
    for (const [count, expected] of [
      [1, 2],
      [2, 2],
      [3, 3],
      [4, 3],
    ]) {
      const images = Array.from({ length: count }, (_, i) => ({
        src: `/img-${i}.png`,
      }));
      const html = DEF.renderHtml(slide({ layout, images }).content);
      assert.equal(
        (html.match(/class="frame/g) || []).length,
        expected,
        `${layout} with ${count} image(s) renders ${expected} frames`,
      );
      assert.match(html, new RegExp(`data-count="${expected}"`));
    }
  }
});

test('render: beside with three images renders three frames (the set is not a duo)', () => {
  // The layout that used to be called `duo` is a stack beside the text, not a
  // pair: three images stack, driven by data-count in CSS.
  const html = DEF.renderHtml(
    slide({
      layout: 'beside',
      images: [{ src: '/a' }, { src: '/b' }, { src: '/c' }],
    }).content,
  );
  assert.match(html, /is-layout-beside/);
  assert.match(html, /class="media is-multi" data-count="3"/);
  for (const idx of [0, 1, 2]) {
    assert.match(html, new RegExp(`data-inline-photo="${idx}"`));
  }
});

test('render: layout classes and the shared split skeleton', () => {
  assert.match(
    DEF.renderHtml(slide({ layout: 'beside' }).content),
    /is-layout-beside/,
  );
  assert.match(
    DEF.renderHtml(slide({ layout: 'top' }).content),
    /is-layout-top/,
  );
  assert.match(
    DEF.renderHtml(slide({ layout: 'bottom' }).content),
    /is-layout-bottom/,
  );
  // The inner container keeps `split is-left|is-right` in every layout so the
  // shared split CSS applies to `beside` and the mirror toggle keeps working.
  assert.match(
    DEF.renderHtml(slide({ layout: 'top', imageSide: 'right' }).content),
    /split is-right/,
  );
});

test('render: an unfilled cell renders the indexed placeholder', () => {
  const html = DEF.renderHtml(
    slide({ layout: 'top', images: [{ src: '/a' }] }).content,
  );
  assert.match(html, /image-placeholder is-empty" data-inline-photo="1"/);
});

test('render: per-image fit and focus land on their own frame', () => {
  const html = DEF.renderHtml(
    slide({
      layout: 'beside',
      images: [
        { src: '/a.png', fit: 'contain', focusX: 10, focusY: 20 },
        { src: '/b.png' },
      ],
    }).content,
  );
  assert.match(html, /frame is-fit-contain/);
  assert.match(html, /object-position:10% 20%/);
});

// ---- Text columns: an affordance of every layout of this type -------------

test('render: textColumns 2 adds is-text-cols-2 in every layout', () => {
  for (const layout of LAYOUTS) {
    const html = DEF.renderHtml(slide({ layout, textColumns: '2' }).content);
    assert.match(html, /is-text-cols-2/, `${layout} gets the class`);
  }
});

test('render: default and explicit 1 render without the class', () => {
  assert.ok(
    !DEF.renderHtml(slide({ layout: 'bottom' }).content).includes(
      'is-text-cols-2',
    ),
  );
  assert.ok(
    !DEF.renderHtml(
      slide({ layout: 'beside', textColumns: '1' }).content,
    ).includes('is-text-cols-2'),
  );
});

test('textColumns defaults to 1 in every language block', () => {
  assert.equal(DEF.defaults.textColumns, '1');
  assert.equal(DEF.defaultsByLang.nl.textColumns, '1');
  assert.equal(DEF.defaultsByLang['en-GB'].textColumns, '1');
});

test('layoutTextColumns is declared without a `when` (it applies everywhere)', () => {
  const d = DEF.layoutTextColumns;
  assert.ok(d, 'image-set declares the text-columns toggle');
  assert.equal(
    d.when,
    undefined,
    'no layout condition: every layout of this type offers two columns',
  );
  const field = DEF.fields.find((f) => f.key === d.key);
  assert.ok(field, `declared key "${d.key}" is a schema field`);
  const options = field.options.map((o) =>
    typeof o === 'string' ? o : o.value,
  );
  assert.equal(d.values.length, 2, 'exactly two values (a toggle)');
  for (const v of d.values) {
    assert.ok(options.includes(v), `${d.key}=${v} is a valid enum value`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d, 'JSON-safe');
});

// ---- Layout-variant declaration (switcher contract) ----------------------

test('layoutVariants: ids are unique and every set-value exists in the schema enums', () => {
  const variants = getLayoutVariants(DEF);
  const ids = variants.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length, 'variant ids are unique');
  // A cross-type tile's `set` applies to the TARGET type after conversion.
  for (const v of variants) {
    if (!v.set) continue;
    const def = v.convertTo ? SLIDE_TYPES[v.convertTo] : DEF;
    for (const [key, value] of Object.entries(v.set)) {
      const field = def.fields.find((f) => f.key === key);
      assert.ok(
        field,
        `${v.id}: set key "${key}" exists on ${v.convertTo || 'image-set-slide'}`,
      );
      const options = field.options.map((o) =>
        typeof o === 'string' ? o : o.value,
      );
      assert.ok(options.includes(value), `${v.id}: ${key}=${value} is valid`);
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(variants)), variants, 'JSON-safe');
});

test('layoutVariants: same-type tiles for the three layouts, cross-type for the rest', () => {
  const byId = new Map(getLayoutVariants(DEF).map((v) => [v.id, v]));
  for (const layout of LAYOUTS) {
    const tile = byId.get(layout);
    assert.ok(tile, `catalogue has ${layout}`);
    assert.equal(tile.convertTo, undefined, `${layout} stays in this type`);
    assert.equal(tile.set.layout, layout);
  }
  assert.equal(byId.get('split-half')?.convertTo, 'image-text-slide');
  assert.equal(byId.get('text')?.convertTo, 'content-slide');
});

test('layoutVariants: cross-type tiles are covered by the convert seam', () => {
  for (const v of getLayoutVariants(DEF)) {
    if (!v.convertTo) continue;
    assert.ok(
      getConvertibleSlideTypes(slide()).includes(v.convertTo),
      `${v.id}: seam supports image-set -> ${v.convertTo}`,
    );
  }
});

test('active variant follows the layout enum; defaults match the row above', () => {
  assert.equal(activeLayoutVariantId(slide(), DEF), 'top');
  assert.equal(
    activeLayoutVariantId(slide({ layout: 'beside' }), DEF),
    'beside',
  );
  assert.equal(
    activeLayoutVariantId(slide({ layout: 'bottom' }), DEF),
    'bottom',
  );
  // A remembered imageWidth belongs to `beside` only; it must not decide the
  // active tile on a row.
  assert.equal(
    activeLayoutVariantId(slide({ layout: 'top', imageWidth: 'wide' }), DEF),
    'top',
  );
});

test('applyLayoutVariant: switches layout, keeps the set, refuses cross-type', () => {
  const s = slide({
    title: 'Titel',
    images: [{ src: '/a.png' }, { src: '/b.png' }],
    imageSide: 'right',
  });
  const variants = getLayoutVariants(DEF);
  const beside = variants.find((v) => v.id === 'beside');
  assert.equal(applyLayoutVariant(s, beside), true);
  assert.equal(s.content.layout, 'beside');
  assert.equal(s.content.images[0].src, '/a.png', 'the set stays put');
  assert.equal(s.content.imageSide, 'right', 'mirroring stays orthogonal');
  assert.equal(applyLayoutVariant(s, beside), false, 'no-op when active');

  const crossType = variants.find((v) => v.convertTo);
  assert.equal(applyLayoutVariant(s, crossType), false);
  assert.equal(s.type, 'image-set-slide');
});

test('layoutMirror: image-set declares the imageSide flip, JSON-safe', () => {
  assert.deepEqual(DEF.layoutMirror, {
    key: 'imageSide',
    values: ['left', 'right'],
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(DEF.layoutMirror)),
    DEF.layoutMirror,
  );
});

// ---- normalizeContent: shape only ----------------------------------------

test('ensureImageSetImages: pads to the minimum, caps at the maximum, idempotent', () => {
  const content = { images: [{ src: '/a.png' }] };
  ensureImageSetImages(content);
  assert.equal(content.images.length, IMAGE_SET_MIN_IMAGES);
  assert.equal(content.images[0].src, '/a.png');
  assert.equal(content.images[1].src, '');
  const snapshot = structuredClone(content);
  ensureImageSetImages(content);
  assert.deepEqual(content, snapshot, 'idempotent');

  const long = {
    images: [{ src: '/a' }, { src: '/b' }, { src: '/c' }, { src: '/d' }],
  };
  ensureImageSetImages(long);
  assert.equal(long.images.length, IMAGE_SET_MAX_IMAGES);
  assert.equal(long.images[0].src, '/a', 'existing items untouched');
});

test('ensureImageSetImages: a junk entry becomes an empty ImageRef, not a hole', () => {
  // The inline media popover writes into images[idx] in place, so every
  // rendered cell needs a live object behind it.
  const content = { images: [null, 'nope'] };
  ensureImageSetImages(content);
  assert.deepEqual(content.images, [
    { src: '', alt: '' },
    { src: '', alt: '' },
  ]);
});

test('a stored density this type no longer offers renders at the default size', () => {
  const html = DEF.renderHtml({
    ...structuredClone(DEF.defaults),
    density: 'comfortable',
  });
  assert.ok(!html.includes('is-compact'));
});
