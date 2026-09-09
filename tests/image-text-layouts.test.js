import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import {
  getLayoutVariants,
  activeLayoutVariantId,
  applyLayoutVariant,
} from '../shared/slide-types/layout-variants.js';
import { getConvertibleSlideTypes } from '../shared/slide-types/convert.js';

/**
 * Image-text's layout catalogue: the width series (narrow/half/wide), the
 * corner layout, and the layout-variant declaration the toolbar switcher
 * renders. Render classes and the variant contract are pinned here; the
 * switcher UI itself is verified in the browser.
 *
 * image-text is a singleton: one image beside text. The plural tiles in its
 * catalogue are cross-type - they convert to image-set-slide, whose own
 * catalogue is pinned in tests/image-set-layouts.test.js.
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
  assert.match(
    DEF.renderHtml(slide({ imageWidth: 'narrow' }).content),
    /is-image-narrow/,
  );
  assert.match(
    DEF.renderHtml(slide({ imageWidth: 'wide' }).content),
    /is-image-wide/,
  );
});

test('render: layout corner adds is-layout-corner and keeps the split DOM', () => {
  const html = DEF.renderHtml(slide({ layout: 'corner' }).content);
  assert.match(html, /is-layout-corner/);
  // Same DOM skeleton as split: media + copy inside .split, so inline-edit
  // descriptors and morph roles keep working.
  assert.match(html, /class="split /);
  assert.match(html, /class="media"/);
  assert.match(html, /class="copy"/);
});

test('render: corner mirrors through imageSide like the splits', () => {
  const right = DEF.renderHtml(
    slide({ layout: 'corner', imageSide: 'right' }).content,
  );
  assert.match(right, /split is-right/);
  const left = DEF.renderHtml(
    slide({ layout: 'corner', imageSide: 'left' }).content,
  );
  assert.match(left, /split is-left/);
});

test('render: one frame in every layout, and never the multi-cell media', () => {
  // The singleton contract in the emitted HTML: a set of images is a different
  // type, so nothing here may grow a second frame or the is-multi container the
  // multi-cell CSS keys off.
  for (const layout of ['split', 'corner']) {
    const html = DEF.renderHtml(slide({ layout, image: '/a.png' }).content);
    assert.equal(
      (html.match(/class="frame/g) || []).length,
      1,
      `${layout} renders exactly one frame`,
    );
    assert.ok(!html.includes('is-multi'), `${layout} media is not is-multi`);
    assert.ok(!html.includes('data-count='), `${layout} carries no data-count`);
    assert.match(html, /data-inline-photo="0"/);
    assert.ok(
      !html.includes('data-inline-photo="1"'),
      `${layout} has no second inline-photo hook`,
    );
  }
});

test('defaults declare the split layout in every language block', () => {
  assert.equal(DEF.defaults.layout, 'split');
  assert.equal(DEF.defaultsByLang.nl.layout, 'split');
  assert.equal(DEF.defaultsByLang['en-GB'].layout, 'split');
});

test('layout enum offers split and corner only', () => {
  const field = DEF.fields.find((f) => f.key === 'layout');
  const values = field.options.map((o) =>
    typeof o === 'string' ? o : o.value,
  );
  assert.deepEqual(values, ['split', 'corner']);
});

test('imageWidth enum carries the full width series', () => {
  const field = DEF.fields.find((f) => f.key === 'imageWidth');
  const values = field.options.map((o) => o.value);
  assert.deepEqual(values, ['half', 'narrow', 'wide']);
});

// ---- Layout-variant declaration (switcher contract) ----------------------

test('layoutVariants: ids are unique and every set-value exists in the schema enums', () => {
  const variants = getLayoutVariants(DEF);
  assert.ok(variants.length >= 5, 'the catalogue has at least 5 tiles');
  const ids = variants.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length, 'variant ids are unique');

  // A cross-type tile's `set` applies to the TARGET type after the conversion,
  // so it is validated against that schema - not against image-text's.
  for (const v of variants) {
    if (!v.set) continue;
    const def = v.convertTo ? SLIDE_TYPES[v.convertTo] : DEF;
    for (const [key, value] of Object.entries(v.set)) {
      const field = def.fields.find((f) => f.key === key);
      assert.ok(
        field,
        `${v.id}: set key "${key}" exists on ${v.convertTo || 'image-text-slide'}`,
      );
      const options = field.options.map((o) =>
        typeof o === 'string' ? o : o.value,
      );
      assert.ok(options.includes(value), `${v.id}: ${key}=${value} is valid`);
    }
  }
});

test('layoutVariants: the plural tiles are cross-type, pointing at image-set', () => {
  // A second and third image is a different contract, so these tiles convert
  // instead of growing this type (D100).
  const byId = new Map(getLayoutVariants(DEF).map((v) => [v.id, v]));
  for (const [id, layout] of [
    ['beside', 'beside'],
    ['top', 'top'],
    ['bottom', 'bottom'],
  ]) {
    const tile = byId.get(id);
    assert.ok(tile, `catalogue has ${id}`);
    assert.equal(tile.convertTo, 'image-set-slide');
    assert.equal(tile.set.layout, layout);
  }
  assert.equal(byId.get('text').convertTo, 'content-slide');
});

test('layoutVariants: cross-type tiles are covered by the convert seam', () => {
  for (const v of getLayoutVariants(DEF)) {
    if (!v.convertTo) continue;
    assert.ok(
      getConvertibleSlideTypes(slide()).includes(v.convertTo),
      `${v.id}: seam supports image-text -> ${v.convertTo}`,
    );
  }
});

test('active variant: defaults match split-half; older slides without layout too', () => {
  assert.equal(activeLayoutVariantId(slide(), DEF), 'split-half');
  // Pre-catalogue decks have no layout key at all - defaults fill the gap.
  const legacy = slide();
  delete legacy.content.layout;
  assert.equal(activeLayoutVariantId(legacy, DEF), 'split-half');
});

test('active variant: corner wins regardless of the remembered imageWidth', () => {
  assert.equal(
    activeLayoutVariantId(
      slide({ layout: 'corner', imageWidth: 'narrow' }),
      DEF,
    ),
    'corner',
  );
  assert.equal(
    activeLayoutVariantId(slide({ imageWidth: 'wide' }), DEF),
    'split-wide',
  );
  assert.equal(
    activeLayoutVariantId(slide({ imageWidth: 'narrow' }), DEF),
    'split-narrow',
  );
});

test('applyLayoutVariant: switches fields, keeps content, reports change', () => {
  const s = slide({
    title: 'Titel',
    body: '- punt',
    image: '/x.png',
    imageSide: 'right',
  });
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

test('image-text declares no text-columns toggle', () => {
  // The copy column of a singleton is half a slide at most; two columns in it
  // is an image-set affordance (its catalogue declares layoutTextColumns).
  assert.equal(DEF.layoutTextColumns, undefined);
  assert.equal(
    DEF.fields.find((f) => f.key === 'textColumns'),
    undefined,
  );
});

// ---- The content-slide series and the mirror -----------------------------

const CONTENT_DEF = SLIDE_TYPES['content-slide'];

const contentSlide = (content = {}) => ({
  id: 'slide-2',
  type: 'content-slide',
  notes: '',
  content: { ...structuredClone(CONTENT_DEF.defaults), ...content },
});

test('content-slide layoutVariants: full series, valid sets, seam-covered, JSON-safe', () => {
  const variants = getLayoutVariants(CONTENT_DEF);
  const ids = variants.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length, 'variant ids are unique');
  for (const id of [
    'one-column',
    'two-column',
    'split-half',
    'top',
    'beside',
    'corner',
  ]) {
    assert.ok(ids.includes(id), `series carries ${id}`);
  }
  // Sets of cross-type tiles apply to the *target* type after conversion, so
  // validate them against that schema; same-type sets against content-slide.
  for (const v of variants) {
    const def = v.convertTo ? SLIDE_TYPES[v.convertTo] : CONTENT_DEF;
    if (v.convertTo) {
      assert.ok(
        getConvertibleSlideTypes(contentSlide()).includes(v.convertTo),
        `${v.id}: seam supports content-slide -> ${v.convertTo}`,
      );
    }
    for (const [key, value] of Object.entries(v.set || {})) {
      const field = def.fields.find((f) => f.key === key);
      assert.ok(
        field,
        `${v.id}: set key "${key}" exists on ${v.convertTo || 'content-slide'}`,
      );
      const options = field.options.map((o) =>
        typeof o === 'string' ? o : o.value,
      );
      assert.ok(options.includes(value), `${v.id}: ${key}=${value} is valid`);
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(variants)), variants, 'JSON-safe');
});

test('content-slide plural tiles convert to image-set, the single-image ones to image-text', () => {
  const byId = new Map(getLayoutVariants(CONTENT_DEF).map((v) => [v.id, v]));
  for (const id of ['top', 'bottom', 'beside']) {
    assert.equal(byId.get(id)?.convertTo, 'image-set-slide', `${id} -> set`);
  }
  for (const id of ['split-narrow', 'split-half', 'split-wide']) {
    assert.equal(byId.get(id)?.convertTo, 'image-text-slide', `${id} -> text`);
  }
});

test('content-slide active variant follows the layout enum', () => {
  assert.equal(
    activeLayoutVariantId(contentSlide(), CONTENT_DEF),
    'one-column',
  );
  assert.equal(
    activeLayoutVariantId(contentSlide({ layout: 'two-column' }), CONTENT_DEF),
    'two-column',
  );
});

test('layoutMirror: image-text declares the imageSide flip, JSON-safe', () => {
  assert.deepEqual(DEF.layoutMirror, {
    key: 'imageSide',
    values: ['left', 'right'],
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(DEF.layoutMirror)),
    DEF.layoutMirror,
  );
  assert.equal(
    CONTENT_DEF.layoutMirror,
    undefined,
    'text slide has nothing to mirror',
  );
});

test('a stored density this type no longer offers renders at the default size', () => {
  // The shrink layer took 'comfortable' with it (#932) and the field stopped
  // offering it; renderHtml has no branch for it, so a not-yet-migrated deck
  // renders at the default size rather than compact. The fold that converges
  // the stored value lives in one place now — tests/density-vocabulary.test.js.
  const html = DEF.renderHtml({
    ...structuredClone(DEF.defaults),
    density: 'comfortable',
  });
  assert.ok(!html.includes('is-compact'));
});
