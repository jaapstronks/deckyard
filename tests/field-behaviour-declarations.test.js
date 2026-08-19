/**
 * A7.15 PR B: the generic field loop stops naming slide types.
 *
 * `client/views/editor/editor-form/render-field.js` is the module that must not
 * know a type — it renders whatever `fields[]` declares. Two per-type branches
 * outlived every other per-type form: which types auto-fit a heavily cropped
 * image, and which get the markdown heading button. Both were on the list PR
 * #451's rename missed. They are field declarations now
 * (shared/slide-types/field-behaviour.js), and the editor header's AI-convert
 * menu reads the one map in shared/slide-types/convert.js instead of a second
 * hand-written copy.
 *
 * This file pins the behaviour those branches had, so the move is provably
 * equivalent — including the one place the two old branches disagreed, which is
 * called out by name below.
 *
 * Run with: node --test tests/field-behaviour-declarations.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  SLIDE_TYPES,
  CUSTOM_SLIDE_TYPE_NAMES,
} from '../shared/slide-types/registry.js';
import {
  AI_CONVERT_PAIRS,
  getAiConvertibleSlideTypes,
} from '../shared/slide-types/convert.js';
import {
  applyAutoContainFit,
  fieldAutoFit,
  fieldToolbars,
} from '../shared/slide-types/field-behaviour.js';
import { getConversionPrompt } from '../server/utils/openai/convert-slide.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_TYPE_NAMES = Object.keys(SLIDE_TYPES).filter(
  (name) => !CUSTOM_SLIDE_TYPE_NAMES.includes(name),
);

/** Every `fields[]` entry of every registered type, with its owner. */
function allFields() {
  const out = [];
  for (const [type, def] of Object.entries(SLIDE_TYPES)) {
    for (const field of def?.fields || []) out.push({ type, field });
  }
  return out;
}

test('the heading button is declared, and only where it was', () => {
  const declaring = allFields()
    .filter(({ field }) => fieldToolbars(field).includes('heading'))
    .map(({ type, field }) => `${type}.${field.key}`)
    .sort();
  // Exactly the pair the old `slide.type === 'content-slide' || …` branch let
  // through. Every other markdown field renders the toolbar without it.
  assert.deepEqual(declaring, ['content-slide.body', 'image-text-slide.body']);
});

test('fieldToolbars ignores what it does not know', () => {
  assert.deepEqual(fieldToolbars({}), []);
  assert.deepEqual(fieldToolbars({ toolbar: 'heading' }), []);
  assert.deepEqual(fieldToolbars({ toolbar: ['heading', 'nope'] }), [
    'heading',
  ]);
});

test('auto-fit is declared, and only where it was', () => {
  const declaring = allFields()
    .filter(({ field }) => fieldAutoFit(field))
    .map(({ type, field }) => `${type}.${field.key}`)
    .sort();
  assert.deepEqual(declaring, ['image-slide.image', 'image-text-slide.image']);
});

test('fieldAutoFit refuses a declaration it cannot act on', () => {
  assert.equal(fieldAutoFit({}), null);
  assert.equal(fieldAutoFit({ autoFit: {} }), null);
  assert.equal(fieldAutoFit({ autoFit: { fit: '' } }), null);
  assert.deepEqual(fieldAutoFit({ autoFit: { fit: 'fit', item: 'images' } }), {
    fit: 'fit',
  });
});

test('image-slide: contain unless the author already chose a fit', () => {
  const decl = fieldAutoFit(
    SLIDE_TYPES['image-slide'].fields.find((f) => f.key === 'image'),
  );

  const fresh = { image: 'x.png' };
  assert.equal(applyAutoContainFit(fresh, decl), true);
  assert.equal(fresh.fit, 'contain');

  // The old branch's `explicit` guard, value by value.
  for (const content of [
    { fit: 'cover' },
    { fit: 'contain' },
    { layout: 'centered' },
    { layout: 'bleed' },
  ]) {
    const before = structuredClone(content);
    assert.equal(applyAutoContainFit(content, decl), false);
    assert.deepEqual(content, before);
  }

  // `full` is the old default: not a choice, so auto-fit still applies.
  const legacyDefault = { layout: 'full' };
  assert.equal(applyAutoContainFit(legacyDefault, decl), true);
  assert.equal(legacyDefault.fit, 'contain');
});

test('image-text: the fit lands on the first ImageRef, or the legacy sink', () => {
  const decl = fieldAutoFit(
    SLIDE_TYPES['image-text-slide'].fields.find((f) => f.key === 'image'),
  );

  const migrated = { images: [{ src: 'a.png' }] };
  assert.equal(applyAutoContainFit(migrated, decl), true);
  assert.equal(migrated.images[0].fit, 'contain');

  // Fired from the legacy flat `image` field before the migration into
  // images[]: write the slide-level sink, which the next edit folds in.
  const preMigration = { image: 'a.png' };
  assert.equal(applyAutoContainFit(preMigration, decl), true);
  assert.equal(preMigration.imageFit, 'contain');

  const chosen = { images: [{ src: 'a.png', fit: 'contain' }] };
  assert.equal(applyAutoContainFit(chosen, decl), false);
});

test('an explicit cover is respected on both types — the one behaviour change', () => {
  // The two old branches disagreed here: image-slide treated `cover` as the
  // author's choice and left it alone, image-text treated it as unchosen and
  // overrode it. Two rules for one question is the defect; respecting the
  // author is the rule that survived the consolidation.
  const imageText = fieldAutoFit(
    SLIDE_TYPES['image-text-slide'].fields.find((f) => f.key === 'image'),
  );
  const onItem = { images: [{ src: 'a.png', fit: 'cover' }] };
  assert.equal(applyAutoContainFit(onItem, imageText), false);
  assert.equal(onItem.images[0].fit, 'cover');

  const onSlide = { images: [{ src: 'a.png' }], imageFit: 'cover' };
  assert.equal(applyAutoContainFit(onSlide, imageText), false);
});

test('the AI convert pairs have one source, and the menu holds no names', () => {
  // The map the editor menu used to carry, restated from the source of truth.
  assert.deepEqual(getAiConvertibleSlideTypes({ type: 'content-slide' }), [
    'list-slide',
    'icon-card-grid-slide',
    'text-blocks-slide',
    'kpi-metrics-slide',
  ]);
  assert.deepEqual(getAiConvertibleSlideTypes('kpi-metrics-slide'), [
    'content-slide',
    'list-slide',
  ]);
  assert.deepEqual(getAiConvertibleSlideTypes({ type: 'title-slide' }), []);
  assert.deepEqual(getAiConvertibleSlideTypes({ type: 'not-a-type' }), []);
});

test('every declared AI pair has a prompt on the server', () => {
  for (const [fromType, targets] of Object.entries(AI_CONVERT_PAIRS)) {
    assert.ok(SLIDE_TYPES[fromType], `${fromType} is not registered`);
    for (const toType of targets) {
      assert.ok(
        SLIDE_TYPES[toType],
        `${fromType} -> ${toType}: not registered`,
      );
      assert.ok(
        getConversionPrompt(fromType, toType, 'nl'),
        `${fromType} -> ${toType} is offered but has no conversion prompt`,
      );
    }
  }
});

test('neither editor module names a slide type any more', () => {
  // The point of the whole PR, asserted on the source: a rename of any type
  // now has nothing to visit in these two files. (The three-name threshold of
  // tests/slide-type-name-branching.test.js is coarser; this is exact.)
  for (const file of [
    'client/views/editor/editor-form/render-field.js',
    'client/views/editor/editor-form/header-actions.js',
  ]) {
    const src = readFileSync(resolve(ROOT, file), 'utf8');
    const named = CORE_TYPE_NAMES.filter((name) =>
      new RegExp(`(['"\`])${name}\\1`).test(src),
    );
    // follow-invite-slide is the documented single-type exception in
    // header-actions: a slide the app maintains itself may not be saved to the
    // slide library. Not a table — no future type can be missing from it.
    const allowed = new Set(['follow-invite-slide']);
    assert.deepEqual(
      named.filter((n) => !allowed.has(n)),
      [],
      `${file} still names ${named.join(', ')}`,
    );
  }
});
