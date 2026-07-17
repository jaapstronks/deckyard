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
