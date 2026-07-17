import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types/index.js';
import {
  getLayoutVariants,
  activeLayoutVariantId,
  applyLayoutVariant,
} from '../shared/slide-types/layout-variants.js';
import { getConvertibleSlideTypes } from '../shared/slide-types/convert.js';

/**
 * Image-text layout catalogue, phase 1: the width series (narrow/half/wide),
 * the corner layout, and the layout-variant declaration the toolbar switcher
 * renders. Render classes and the variant contract are pinned here; the
 * switcher UI itself is verified in the browser.
 */

const DEF = SLIDE_TYPES['image-text-slide'];

const slide = (content = {}) => ({
  id: 'slide-1',
  type: 'image-text-slide',
  notes: '',
  content: { ...structuredClone(DEF.defaults), ...content },
});

// ---- Render classes ------------------------------------------------------

test('render: default is a plain half split (no width/layout class)', () => {
  const html = DEF.renderHtml(slide().content);
  assert.ok(!html.includes('is-image-narrow'));
  assert.ok(!html.includes('is-image-wide'));
  assert.ok(!html.includes('is-layout-corner'));
});

test('render: imageWidth narrow/wide map to their classes', () => {
  assert.match(DEF.renderHtml(slide({ imageWidth: 'narrow' }).content), /is-image-narrow/);
  assert.match(DEF.renderHtml(slide({ imageWidth: 'wide' }).content), /is-image-wide/);
});

test('render: layout corner adds is-layout-corner and keeps the split DOM', () => {
  const html = DEF.renderHtml(slide({ layout: 'corner' }).content);
  assert.match(html, /is-layout-corner/);
  // Same DOM skeleton as split: media + copy inside .split, so inline-edit
  // descriptors, morph roles and the autofit runtime keep working.
  assert.match(html, /class="split /);
  assert.match(html, /class="media"/);
  assert.match(html, /class="copy"/);
  assert.match(html, /data-density="auto"/);
});

test('render: corner mirrors through imageSide like the splits', () => {
  const right = DEF.renderHtml(slide({ layout: 'corner', imageSide: 'right' }).content);
  assert.match(right, /split is-right/);
  const left = DEF.renderHtml(slide({ layout: 'corner', imageSide: 'left' }).content);
  assert.match(left, /split is-left/);
});

test('defaults declare the split layout in every language block', () => {
  assert.equal(DEF.defaults.layout, 'split');
  assert.equal(DEF.defaultsByLang.nl.layout, 'split');
  assert.equal(DEF.defaultsByLang['en-GB'].layout, 'split');
});

test('imageWidth enum carries the full width series', () => {
  const field = DEF.fields.find((f) => f.key === 'imageWidth');
  const values = field.options.map((o) => o.value);
  assert.deepEqual(values, ['half', 'narrow', 'wide']);
});

// ---- Layout-variant declaration (switcher contract) ----------------------

test('layoutVariants: ids are unique and every set-value exists in the schema enums', () => {
  const variants = getLayoutVariants(DEF);
  assert.ok(variants.length >= 5, 'the phase-1 catalogue has at least 5 tiles');
  const ids = variants.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length, 'variant ids are unique');

  const enumOptions = (key) => {
    const field = DEF.fields.find((f) => f.key === key);
    assert.ok(field, `set key "${key}" is a declared field`);
    return field.options.map((o) => (typeof o === 'string' ? o : o.value));
  };
  for (const v of variants) {
    if (!v.set) continue;
    for (const [key, value] of Object.entries(v.set)) {
      assert.ok(
        enumOptions(key).includes(value),
        `${v.id}: ${key}=${value} is a valid enum value`
      );
    }
  }
});

test('layoutVariants: cross-type tiles are covered by the convert seam', () => {
  for (const v of getLayoutVariants(DEF)) {
    if (!v.convertTo) continue;
    assert.ok(
      getConvertibleSlideTypes(slide()).includes(v.convertTo),
      `${v.id}: seam supports image-text -> ${v.convertTo}`
    );
  }
});

test('active variant: defaults match split-half; older slides without layout too', () => {
  assert.equal(activeLayoutVariantId(slide(), DEF), 'split-half');
  // Pre-phase-1 decks have no layout key at all - defaults fill the gap.
  const legacy = slide();
  delete legacy.content.layout;
  assert.equal(activeLayoutVariantId(legacy, DEF), 'split-half');
});

test('active variant: corner wins regardless of the remembered imageWidth', () => {
  assert.equal(
    activeLayoutVariantId(slide({ layout: 'corner', imageWidth: 'narrow' }), DEF),
    'corner'
  );
  assert.equal(activeLayoutVariantId(slide({ imageWidth: 'wide' }), DEF), 'split-wide');
  assert.equal(activeLayoutVariantId(slide({ imageWidth: 'narrow' }), DEF), 'split-narrow');
});

test('applyLayoutVariant: switches fields, keeps content, reports change', () => {
  const s = slide({ title: 'Titel', body: '- punt', image: '/x.png', imageSide: 'right' });
  const variants = getLayoutVariants(DEF);
  const corner = variants.find((v) => v.id === 'corner');

  assert.equal(applyLayoutVariant(s, corner), true);
  assert.equal(s.content.layout, 'corner');
  assert.equal(s.content.title, 'Titel', 'content stays put');
  assert.equal(s.content.body, '- punt');
  assert.equal(s.content.image, '/x.png');
  assert.equal(s.content.imageSide, 'right', 'mirroring stays orthogonal');
  assert.equal(activeLayoutVariantId(s, DEF), 'corner');

  // Round-trip back to the half split.
  const half = variants.find((v) => v.id === 'split-half');
  assert.equal(applyLayoutVariant(s, half), true);
  assert.equal(activeLayoutVariantId(s, DEF), 'split-half');
  assert.equal(s.content.image, '/x.png');

  // Applying the active variant again is a no-op (no dirty, no undo step).
  assert.equal(applyLayoutVariant(s, half), false);
});

test('applyLayoutVariant refuses cross-type variants (those go through the seam)', () => {
  const s = slide();
  const textTile = getLayoutVariants(DEF).find((v) => v.convertTo);
  assert.ok(textTile, 'the catalogue has a cross-type tile');
  assert.equal(applyLayoutVariant(s, textTile), false);
  assert.equal(s.type, 'image-text-slide');
});

test('layoutVariants declaration is JSON-safe (survives the /api/slide-types trip)', () => {
  const variants = getLayoutVariants(DEF);
  const roundTrip = JSON.parse(JSON.stringify(variants));
  assert.deepEqual(roundTrip, variants);
});

// ---- Phase 2: images[] + rows/duo ----------------------------------------

import {
  IMAGE_TEXT_MAX_IMAGES,
  imageTextImageItems,
  imageTextCellCount,
  ensureImageTextImages,
} from '../shared/slide-types/image-text-images.js';
import { convertSlideToType, getConversionLossyKeys } from '../shared/slide-types/convert.js';

test('imageTextImageItems: legacy flat image folds into item 0; images[] wins', () => {
  assert.deepEqual(imageTextImageItems({}), []);
  const legacy = imageTextImageItems({ image: '/x.png' });
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].src, '/x.png');
  const both = imageTextImageItems({ image: '/x.png', images: [{ src: '/a.png' }] });
  assert.equal(both.length, 1);
  assert.equal(both[0].src, '/a.png');
  // Sanitization: junk items become empty canonical items, capped at max.
  const junk = imageTextImageItems({ images: [null, { src: 42 }, {}, {}, {}] });
  assert.equal(junk.length, IMAGE_TEXT_MAX_IMAGES);
  assert.equal(junk[0].src, '');
});

test('imageTextCellCount: 1 for split/corner, 2 for duo, 2-3 for rows', () => {
  assert.equal(imageTextCellCount({ layout: 'split' }), 1);
  assert.equal(imageTextCellCount({ layout: 'corner' }), 1);
  assert.equal(imageTextCellCount({ layout: 'duo' }), 2);
  assert.equal(imageTextCellCount({ layout: 'row-top' }), 2);
  assert.equal(imageTextCellCount({ layout: 'row-top', images: [{}, {}, {}] }), 3);
  assert.equal(imageTextCellCount({ layout: 'row-bottom', image: '/x.png' }), 2);
});

test('ensureImageTextImages: migrates flat -> images[0], pads to cell count, idempotent', () => {
  const content = { image: '/x.png', layout: 'row-top', images: [] };
  ensureImageTextImages(content);
  assert.equal(content.image, '', 'flat image cleared after migration');
  assert.equal(content.images.length, 2, 'padded to the row minimum');
  assert.equal(content.images[0].src, '/x.png');
  assert.equal(content.images[1].src, '');
  const snapshot = JSON.parse(JSON.stringify(content));
  ensureImageTextImages(content);
  assert.deepEqual(JSON.parse(JSON.stringify(content)), snapshot, 'idempotent');
});

test('ensureImageTextImages: keeps extra items and caps at the maximum', () => {
  const content = { layout: 'split', images: [{ src: '/a' }, { src: '/b' }, { src: '/c' }, { src: '/d' }] };
  ensureImageTextImages(content);
  assert.equal(content.images.length, IMAGE_TEXT_MAX_IMAGES, 'capped at max');
  assert.equal(content.images[0].src, '/a', 'existing items untouched');
});

test('render: duo shows two frames with indexed inline-photo hooks', () => {
  const html = DEF.renderHtml(
    slide({ layout: 'duo', images: [{ src: '/a.png' }, { src: '/b.png' }] }).content
  );
  assert.match(html, /is-layout-duo/);
  assert.match(html, /class="media is-multi" data-count="2"/);
  assert.match(html, /data-inline-photo="0"/);
  assert.match(html, /data-inline-photo="1"/);
});

test('render: rows follow the image count and pad placeholders', () => {
  const three = DEF.renderHtml(
    slide({ layout: 'row-top', images: [{ src: '/a' }, { src: '/b' }, { src: '/c' }] }).content
  );
  assert.match(three, /is-layout-row-top/);
  assert.match(three, /data-count="3"/);
  const one = DEF.renderHtml(slide({ layout: 'row-bottom', images: [{ src: '/a' }] }).content);
  assert.match(one, /is-layout-row-bottom/);
  assert.match(one, /data-count="2"/);
  assert.match(one, /image-placeholder is-empty" data-inline-photo="1"/);
});

test('render: per-image fit and focus override the slide level', () => {
  const html = DEF.renderHtml(
    slide({
      layout: 'duo',
      images: [
        { src: '/a.png', fit: 'contain', focusX: 10, focusY: 20 },
        { src: '/b.png' },
      ],
    }).content
  );
  assert.match(html, /frame is-fit-contain/);
  assert.match(html, /object-position:10% 20%/);
});

test('render: legacy alt and focus keep working as item-0 fallbacks', () => {
  const html = DEF.renderHtml(
    slide({ image: '/x.png', alt: 'Legacy alt', focusX: 30, focusY: 40 }).content
  );
  assert.match(html, /alt="Legacy alt"/);
  assert.match(html, /object-position:30% 40%/);
  // Migrated shape without item alt still falls back to the slide-level alt.
  const migrated = DEF.renderHtml(
    slide({ images: [{ src: '/x.png' }], alt: 'Legacy alt' }).content
  );
  assert.match(migrated, /alt="Legacy alt"/);
});

test('layoutVariants: the phase-2 catalogue carries rows and duo', () => {
  const ids = getLayoutVariants(DEF).map((v) => v.id);
  for (const id of ['row-top', 'row-bottom', 'duo']) {
    assert.ok(ids.includes(id), `catalogue has ${id}`);
  }
});

test('active variant: rows and duo match on their layout value', () => {
  assert.equal(activeLayoutVariantId(slide({ layout: 'duo' }), DEF), 'duo');
  assert.equal(
    activeLayoutVariantId(slide({ layout: 'row-top', imageWidth: 'wide' }), DEF),
    'row-top'
  );
  assert.equal(activeLayoutVariantId(slide({ layout: 'row-bottom' }), DEF), 'row-bottom');
});

test('convert: image-slide -> image-text lands in canonical images[0]', () => {
  const src = {
    id: 's1',
    type: 'image-slide',
    content: {
      ...structuredClone(SLIDE_TYPES['image-slide'].defaults),
      image: '/photo.png',
      title: 'T',
    },
  };
  const next = convertSlideToType(src, 'image-text-slide', { lang: 'nl' });
  assert.equal(next.content.images.length, 1);
  assert.equal(next.content.images[0].src, '/photo.png');
  assert.equal(next.content.image, '', 'flat field stays empty');
});

test('convert: filled images[] warns as lossy towards content-slide', () => {
  const s = slide({ images: [{ src: '/a.png' }] });
  s.content.image = '';
  const lossy = getConversionLossyKeys(s, 'content-slide');
  assert.ok(lossy.includes('images'), 'images reported as lossy');
});

// ---- Phase 3: columns cross-over, content-slide series, mirror -----------

const CONTENT_DEF = SLIDE_TYPES['content-slide'];

const contentSlide = (content = {}) => ({
  id: 'slide-2',
  type: 'content-slide',
  notes: '',
  content: { ...structuredClone(CONTENT_DEF.defaults), ...content },
});

test('convert seam: image-text also reaches content-columns', () => {
  assert.ok(getConvertibleSlideTypes(slide()).includes('content-columns-slide'));
});

test('convert: image-text -> content-columns maps images and distributes bullets', () => {
  const s = slide({
    layout: 'row-top',
    images: [
      { src: '/a.png', alt: 'A' },
      { src: '/b.png' },
      { src: '/c.png', fit: 'contain' },
    ],
    title: 'Titel',
    body: '- Punt één\n- Punt twee\n- Punt drie',
  });
  const next = convertSlideToType(s, 'content-columns-slide', { lang: 'nl' });
  assert.equal(next.type, 'content-columns-slide');
  assert.equal(next.content.columnCount, '3');
  assert.equal(next.content.title, 'Titel');
  assert.equal(next.content.col1Image, '/a.png');
  assert.equal(next.content.col1Alt, 'A');
  assert.equal(next.content.col2Image, '/b.png');
  assert.equal(next.content.col3ImageFit, 'contain');
  assert.equal(next.content.col1Text, 'Punt één');
  assert.equal(next.content.col2Text, 'Punt twee');
  assert.equal(next.content.col3Text, 'Punt drie');
  assert.equal(next.content.col1Title, '', 'no placeholder column titles');
  assert.equal(next.content.col1BlockCount, '0');
});

test('convert: extra bullets collect in the last column as a list', () => {
  const s = slide({
    layout: 'duo',
    images: [{ src: '/a.png' }, { src: '/b.png' }],
    body: '- Een\n- Twee\n- Drie\n- Vier',
  });
  const next = convertSlideToType(s, 'content-columns-slide', { lang: 'nl' });
  // max(2 images, 4 bullets) clamps to the 3-column maximum.
  assert.equal(next.content.columnCount, '3');
  assert.equal(next.content.col1Text, 'Een');
  assert.equal(next.content.col2Text, 'Twee');
  assert.equal(next.content.col3Text, '- Drie\n- Vier');
  assert.equal(next.content.col3Image, '', 'no third image to place');
});

test('convert: a non-list body lands whole in column 1', () => {
  const s = slide({
    images: [{ src: '/a.png' }],
    body: 'Gewoon een verhaal.\nTweede regel.',
  });
  const next = convertSlideToType(s, 'content-columns-slide', { lang: 'nl' });
  assert.equal(next.content.columnCount, '2');
  assert.equal(next.content.col1Text, 'Gewoon een verhaal.\nTweede regel.');
  assert.equal(next.content.col2Text, '');
});

test('convert: legacy flat image converts via the item-0 fallbacks', () => {
  const s = slide({
    image: '/x.png',
    alt: 'Legacy alt',
    imageFit: 'contain',
    focusX: 30,
    focusY: 40,
    body: 'verhaal',
  });
  const next = convertSlideToType(s, 'content-columns-slide', { lang: 'nl' });
  assert.equal(next.content.col1Image, '/x.png');
  assert.equal(next.content.col1Alt, 'Legacy alt');
  assert.equal(next.content.col1ImageFit, 'contain');
  assert.equal(next.content.col1ImageFocusX, 30);
  assert.equal(next.content.col1ImageFocusY, 40);
});

test('convert: content-columns lossy check stays quiet on defaults, warns on caption', () => {
  const clean = slide({ images: [{ src: '/a.png' }] });
  assert.deepEqual(getConversionLossyKeys(clean, 'content-columns-slide'), []);
  const withCaption = slide({ caption: 'Bijschrift' });
  assert.ok(
    getConversionLossyKeys(withCaption, 'content-columns-slide').includes('caption')
  );
});

test('image-text catalogue: the columns tile crosses to content-columns', () => {
  const tile = getLayoutVariants(DEF).find((v) => v.id === 'columns');
  assert.ok(tile, 'catalogue has the columns tile');
  assert.equal(tile.convertTo, 'content-columns-slide');
});

test('content-slide layoutVariants: full series, valid sets, seam-covered, JSON-safe', () => {
  const variants = getLayoutVariants(CONTENT_DEF);
  const ids = variants.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length, 'variant ids are unique');
  for (const id of ['one-column', 'two-column', 'split-half', 'row-top', 'duo', 'corner']) {
    assert.ok(ids.includes(id), `series carries ${id}`);
  }
  // Sets of cross-type tiles apply to the *target* type after conversion, so
  // validate them against that schema; same-type sets against content-slide.
  for (const v of variants) {
    const def = v.convertTo ? SLIDE_TYPES[v.convertTo] : CONTENT_DEF;
    if (v.convertTo) {
      assert.ok(
        getConvertibleSlideTypes(contentSlide()).includes(v.convertTo),
        `${v.id}: seam supports content-slide -> ${v.convertTo}`
      );
    }
    for (const [key, value] of Object.entries(v.set || {})) {
      const field = def.fields.find((f) => f.key === key);
      assert.ok(field, `${v.id}: set key "${key}" exists on ${v.convertTo || 'content-slide'}`);
      const options = field.options.map((o) => (typeof o === 'string' ? o : o.value));
      assert.ok(options.includes(value), `${v.id}: ${key}=${value} is valid`);
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(variants)), variants, 'JSON-safe');
});

test('content-slide active variant follows the layout enum', () => {
  assert.equal(activeLayoutVariantId(contentSlide(), CONTENT_DEF), 'one-column');
  assert.equal(
    activeLayoutVariantId(contentSlide({ layout: 'two-column' }), CONTENT_DEF),
    'two-column'
  );
});

test('layoutMirror: image-text declares the imageSide flip, JSON-safe', () => {
  assert.deepEqual(DEF.layoutMirror, { key: 'imageSide', values: ['left', 'right'] });
  assert.deepEqual(JSON.parse(JSON.stringify(DEF.layoutMirror)), DEF.layoutMirror);
  assert.equal(CONTENT_DEF.layoutMirror, undefined, 'text slide has nothing to mirror');
});

// ---- Text columns (follow-up 2026-07-17): 2-col copy in rows/duo ----------

test('render: textColumns 2 adds is-text-cols-2 in the row and duo layouts', () => {
  for (const layout of ['row-top', 'row-bottom', 'duo']) {
    const html = DEF.renderHtml(slide({ layout, textColumns: '2' }).content);
    assert.match(html, /is-text-cols-2/, `${layout} gets the class`);
  }
});

test('render: textColumns 2 is inert outside rows/duo (no phantom columns)', () => {
  // A remembered '2' on a split or corner slide must not leak column styling
  // - the same model as imageSide: right on a row (the phase-3 bijvangst).
  for (const layout of ['split', 'corner']) {
    const html = DEF.renderHtml(slide({ layout, textColumns: '2' }).content);
    assert.ok(!html.includes('is-text-cols-2'), `${layout} stays single-column`);
  }
});

test('render: default and explicit 1 render without the class', () => {
  assert.ok(!DEF.renderHtml(slide({ layout: 'row-bottom' }).content).includes('is-text-cols-2'));
  assert.ok(
    !DEF.renderHtml(slide({ layout: 'duo', textColumns: '1' }).content).includes('is-text-cols-2')
  );
});

test('textColumns defaults to 1 in every language block', () => {
  assert.equal(DEF.defaults.textColumns, '1');
  assert.equal(DEF.defaultsByLang.nl.textColumns, '1');
  assert.equal(DEF.defaultsByLang['en-GB'].textColumns, '1');
});

test('layoutTextColumns declaration is consistent with the schema, JSON-safe', () => {
  const d = DEF.layoutTextColumns;
  assert.ok(d, 'image-text declares the text-columns toggle');
  const enumOptions = (key) => {
    const field = DEF.fields.find((f) => f.key === key);
    assert.ok(field, `declared key "${key}" is a schema field`);
    return field.options.map((o) => (typeof o === 'string' ? o : o.value));
  };
  assert.equal(d.values.length, 2, 'exactly two values (a toggle)');
  for (const v of d.values) {
    assert.ok(enumOptions(d.key).includes(v), `${d.key}=${v} is a valid enum value`);
  }
  for (const v of d.when.values) {
    assert.ok(enumOptions(d.when.key).includes(v), `when: ${d.when.key}=${v} is valid`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d, 'JSON-safe');
  assert.equal(CONTENT_DEF.layoutTextColumns, undefined, 'content-slide uses its layout enum instead');
});
