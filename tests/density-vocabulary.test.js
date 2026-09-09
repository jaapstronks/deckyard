/**
 * One density vocabulary across the three types that have a `density` field,
 * and one place a stored value they no longer offer folds (A2.3, from #932).
 *
 * Three things are pinned here, and they are the three halves of the same
 * claim:
 *
 *  1. The vocabulary is one set, declared once. Each type offers the SUBSET it
 *     renders — `list-slide` all three, the other two without `comfortable`,
 *     which they have no branch for — and the values, order and i18n keys come
 *     from `DENSITY_OPTIONS` rather than from three hand-written copies.
 *  2. `comfortable` earns its place in that set. It is not a synonym for
 *     `auto`: measured across item count x content shape x column preference,
 *     36 of 126 shapes resolve differently under it (see below).
 *  3. A stored value a type does not offer folds to `auto` in ONE place — the
 *     generic `foldUnofferedEnums`, reached both by the editor's
 *     `normalizeSlideContent` and by the migration funnel, so a deck heals
 *     whether or not anyone opens it.
 *
 * Run with: node --test tests/density-vocabulary.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types.js';
import {
  DENSITY_OPTIONS,
  DENSITY_VALUES,
  densityField,
} from '../shared/slide-types/helpers.js';
import {
  foldUnofferedEnums,
  normalizeSlideContent,
} from '../shared/slide-types/normalize-content.js';
import {
  CURRENT_SCHEMA_VERSION,
  migratePresentation,
} from '../shared/slide-types/schema-version.js';
import { resolveListLayout } from '../shared/slide-types/types/list-slide.js';
import { enumOptionValues } from '../shared/slide-types/field-types.js';
import { validateSlideTypeDefinition } from '../shared/slide-types/validate-definition.js';

/** What each type offers, and why that subset and not another. */
const OFFERED = {
  // Renders all three: SIZE_ORDER + the measured capacity table.
  'list-slide': ['auto', 'comfortable', 'compact'],
  // `renderHtml` branches on 'compact' only; anything else is the default size.
  'content-slide': ['auto', 'compact'],
  'image-text-slide': ['auto', 'compact'],
  'image-set-slide': ['auto', 'compact'],
};

const densityFieldOf = (name) =>
  (SLIDE_TYPES[name]?.fields || []).find((f) => f?.key === 'density');

// ---- 1. One set, subset per type -----------------------------------------

test('every type with a density field offers a subset of the one vocabulary', () => {
  for (const [name, expected] of Object.entries(OFFERED)) {
    const field = densityFieldOf(name);
    assert.ok(field, `${name} declares a density field`);
    assert.deepEqual(
      enumOptionValues(field),
      expected,
      `${name} offers exactly the stands it renders, in canonical order`,
    );
    assert.equal(
      field.foldUnofferedTo,
      'auto',
      `${name} folds a value it does not offer to auto`,
    );
  }
});

test('no other registered type has grown a second density vocabulary', () => {
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    const field = (def?.fields || []).find((f) => f?.key === 'density');
    if (!field) continue;
    assert.ok(
      Object.prototype.hasOwnProperty.call(OFFERED, name),
      `${name} declares a density field but is not in the vocabulary above — ` +
        `add it there (and to DENSITY_OPTIONS if it needs a new stand)`,
    );
  }
});

test('the options come from the shared vocabulary, keys and all', () => {
  for (const [name, expected] of Object.entries(OFFERED)) {
    const field = densityFieldOf(name);
    for (const value of expected) {
      const opt = (field.options || []).find((o) => o?.value === value);
      assert.deepEqual(
        { label: opt.label, labelKey: opt.labelKey },
        {
          label: DENSITY_OPTIONS[value].label,
          labelKey: DENSITY_OPTIONS[value].labelKey,
        },
        `${name}.density '${value}' is the shared option, not a copy of it`,
      );
    }
  }
});

test('densityField orders by the vocabulary, not by the caller', () => {
  const field = densityField(['compact', 'auto']);
  assert.deepEqual(enumOptionValues(field), ['auto', 'compact']);
  assert.deepEqual([...DENSITY_VALUES], ['auto', 'comfortable', 'compact']);
});

// ---- 2. `comfortable` is a distinct stand, not a synonym for auto ---------

test('comfortable resolves differently from auto on the type that renders it', () => {
  const WORDY =
    'A full sentence of real body copy that keeps going for quite a while, ' +
    'well past the wrap point.';
  const content = ({ n, density, layout, text }) => ({
    title: 'List',
    subheading: '',
    variant: 'numbers',
    density,
    layout,
    items: Array.from({ length: n }, (_, i) => ({
      title: `Item ${i + 1}`,
      text,
    })),
  });
  const shape = (r) =>
    `${r.size}/${r.twoCol ? '2col' : '1col'}/${r.steppedDownFrom || '-'}`;

  // The divergence has a shape worth naming, not just a count: `auto` holds the
  // column preference and takes the largest size that fits THERE, so a wordy
  // four-item list settles at the default size in one column. `comfortable`
  // outranks that preference and moves to two columns to stay large.
  const auto = resolveListLayout(
    content({ n: 4, density: 'auto', layout: 'one-column', text: WORDY }),
  );
  const large = resolveListLayout(
    content({
      n: 4,
      density: 'comfortable',
      layout: 'one-column',
      text: WORDY,
    }),
  );
  assert.deepEqual(
    [shape(auto), shape(large)],
    ['normal/1col/-', 'comfortable/2col/-'],
    'an explicit size outranks the column preference',
  );

  // And when no column count can hold it, it steps down and says so — the one
  // thing `auto` can never report, because `auto` asked for nothing.
  const stepped = resolveListLayout(
    content({ n: 8, density: 'comfortable', layout: 'auto', text: WORDY }),
  );
  assert.equal(stepped.steppedDownFrom, 'comfortable');
  assert.equal(
    resolveListLayout(
      content({ n: 8, density: 'auto', layout: 'auto', text: WORDY }),
    ).steppedDownFrom,
    null,
  );
});

// ---- 3. One fold place ----------------------------------------------------

const slideOf = (type, patch) => ({
  id: `slide-${type}`,
  type,
  content: { ...structuredClone(SLIDE_TYPES[type].defaults), ...patch },
});

test('a stored value the type does not offer folds to auto, once, everywhere', () => {
  for (const name of ['content-slide', 'image-text-slide']) {
    const def = SLIDE_TYPES[name];
    const content = slideOf(name, { density: 'comfortable' }).content;
    normalizeSlideContent(name, def, content);
    assert.equal(content.density, 'auto', `${name} folds to auto`);
    // Idempotent.
    normalizeSlideContent(name, def, content);
    assert.equal(content.density, 'auto');
    // An offered value is left exactly as stored.
    const compact = slideOf(name, { density: 'compact' }).content;
    normalizeSlideContent(name, def, compact);
    assert.equal(compact.density, 'compact');
  }
});

test('the type that offers comfortable keeps it', () => {
  const content = slideOf('list-slide', { density: 'comfortable' }).content;
  normalizeSlideContent('list-slide', SLIDE_TYPES['list-slide'], content);
  assert.equal(content.density, 'comfortable');
});

test('no type carries a hand-written density fold', () => {
  // The retired value converges in one place — the declared `foldUnofferedTo`.
  // content-slide and image-text-slide have nothing left to normalize at all,
  // so their hook is gone; image-set-slide keeps one for the shape of its
  // images[], and it must not spell the retired density value out itself.
  for (const name of ['content-slide', 'image-text-slide']) {
    assert.equal(SLIDE_TYPES[name].normalizeContent, undefined, name);
  }
  const src = SLIDE_TYPES['image-set-slide'].normalizeContent;
  assert.equal(typeof src, 'function');
  assert.ok(
    !String(src).includes('density'),
    'image-set-slide does not touch density in its hook',
  );
  // And demonstrably so: a stored value the type does not offer survives the
  // hook untouched, to be folded by the declaration instead.
  const content = { density: 'comfortable', images: [{ src: '/a.png' }] };
  src(content);
  assert.equal(content.density, 'comfortable');
});

test('the fold is opt-in: a field that declares nothing keeps its value', () => {
  const def = {
    fields: [
      { key: 'a', type: 'enum', options: ['x', 'y'] },
      { key: 'b', type: 'enum', options: ['x', 'y'], foldUnofferedTo: 'x' },
    ],
  };
  const content = { a: 'retired', b: 'retired' };
  foldUnofferedEnums(def, content);
  assert.deepEqual(content, { a: 'retired', b: 'x' });
});

test('foldUnofferedEnums is safe on the shapes it is handed in the wild', () => {
  const def = SLIDE_TYPES['content-slide'];
  assert.equal(foldUnofferedEnums(def, null), null);
  assert.equal(foldUnofferedEnums(def, undefined), undefined);
  assert.deepEqual(foldUnofferedEnums(undefined, { density: 'x' }), {
    density: 'x',
  });
  // Absent and cleared both mean "no value"; neither is an unoffered option.
  const empty = { density: '' };
  foldUnofferedEnums(def, empty);
  assert.equal(empty.density, '');
  const absent = {};
  foldUnofferedEnums(def, absent);
  assert.ok(!Object.prototype.hasOwnProperty.call(absent, 'density'));
});

test('a fold target the field does not offer is skipped, not made worse', () => {
  const def = {
    fields: [
      { key: 'a', type: 'enum', options: ['x', 'y'], foldUnofferedTo: 'z' },
    ],
  };
  const content = { a: 'retired' };
  foldUnofferedEnums(def, content);
  assert.equal(content.a, 'retired');
});

// ---- The funnel runs the same fold ---------------------------------------

test('the funnel folds a stored deck, including its translations', () => {
  const pres = {
    schemaVersion: 13,
    slides: [slideOf('content-slide', { density: 'comfortable' })],
    i18n: {
      versions: {
        nl: {
          slides: [slideOf('image-text-slide', { density: 'comfortable' })],
        },
      },
    },
  };
  const migrated = migratePresentation(pres);
  assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(migrated.slides[0].content.density, 'auto');
  assert.equal(
    migrated.i18n.versions.nl.slides[0].content.density,
    'auto',
    'a translated version is part of the deck the step migrates (#1040)',
  );
});

test('the funnel leaves list-slide and unregistered types alone', () => {
  const foreign = {
    id: 'x',
    type: 'some.fork.type',
    content: { density: 'comfortable' },
  };
  const pres = {
    schemaVersion: 13,
    slides: [slideOf('list-slide', { density: 'comfortable' }), foreign],
  };
  const migrated = migratePresentation(pres);
  assert.equal(migrated.slides[0].content.density, 'comfortable');
  assert.equal(
    migrated.slides[1].content.density,
    'comfortable',
    'nothing here knows what a foreign type offers',
  );
});

test('the funnel step is idempotent', () => {
  const once = migratePresentation({
    schemaVersion: 13,
    slides: [slideOf('content-slide', { density: 'comfortable' })],
  });
  const twice = migratePresentation(structuredClone(once));
  assert.deepEqual(twice, once);
});

// ---- The declaration is validated ----------------------------------------

test('validation warns when foldUnofferedTo names something the field lacks', () => {
  const base = {
    label: 'Probe',
    renderHtml: () => '<div class="slide slide-probe"></div>',
  };
  const warningsFor = (field) =>
    validateSlideTypeDefinition({ ...base, fields: [field] }, 'probe-slide')
      .warnings;

  const good = warningsFor({
    key: 'density',
    type: 'enum',
    options: ['auto', 'compact'],
    foldUnofferedTo: 'auto',
  });
  assert.ok(!good.some((w) => w.includes('foldUnofferedTo')));

  const unoffered = warningsFor({
    key: 'density',
    type: 'enum',
    options: ['auto', 'compact'],
    foldUnofferedTo: 'comfortable',
  });
  assert.ok(unoffered.some((w) => w.includes('foldUnofferedTo')));

  const wrongType = warningsFor({
    key: 'title',
    type: 'string',
    foldUnofferedTo: 'auto',
  });
  assert.ok(wrongType.some((w) => w.includes('foldUnofferedTo')));
});
