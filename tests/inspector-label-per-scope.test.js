/**
 * One label per scope in the inspector (D348, B724).
 *
 * A type that declares `layoutVariants` gets the inspector's Layout row above
 * its form. The row and the keeps below it are the controls an author sees
 * side by side, so two of them with the same name read as one choice offered
 * twice ("Layout" over "Layout" on the list slide), and a keep that writes a
 * key the Layout row's tiles also write is the same field with two homes
 * ("Text columns" under the text slide's one/two-column tiles). Both halves
 * are measured here over every core type with variants, in both Tier-1
 * locales, so a new type or a relabel cannot bring either back.
 *
 * The storage half pins what D348 does not change: the `layout` and `density`
 * keys, their option values and defaults on the two types it relabels.
 *
 * Run with: node --test tests/inspector-label-per-scope.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { getLayoutVariants } from '../shared/slide-types/layout-variants.js';
import { slideTypeInspectorKeeps } from '../shared/slide-types/inline-edit-companions.js';
import { DENSITY_VALUES } from '../shared/slide-types/helpers.js';

const LOCALES = ['en', 'nl'];
const MODULES = ['editor', 'slide-types'];

/** locale → merged key/value map of the modules the inspector reads. */
const DICTS = Object.fromEntries(
  LOCALES.map((lang) => [
    lang,
    Object.assign(
      {},
      ...MODULES.map((mod) =>
        JSON.parse(
          readFileSync(
            new URL(`../client/i18n/${lang}/${mod}.json`, import.meta.url),
            'utf8',
          ),
        ),
      ),
    ),
  ]),
);

const TYPES_WITH_VARIANTS = Object.entries(SLIDE_TYPES).filter(
  ([, def]) => getLayoutVariants(def).length > 0,
);

/** The fields the inspector renders below the Layout row for a type. */
function renderedKeeps(type, def) {
  const keeps = new Set(slideTypeInspectorKeeps(type, def) || []);
  return (def.fields || []).filter((f) => keeps.has(f.key) && !f.hidden);
}

/**
 * The values the Layout row's own tiles (not the cross-type ones) write, per
 * key. A keep whose every option is in here is a second home for a choice the
 * row already offers in full.
 */
function tileValues(def) {
  const out = new Map();
  for (const v of getLayoutVariants(def)) {
    if (v?.convertTo) continue;
    for (const [key, value] of Object.entries(v?.set || {})) {
      if (!out.has(key)) out.set(key, new Set());
      out.get(key).add(value);
    }
  }
  return out;
}

const optionValues = (f) =>
  (f.options || []).map((o) => (o && typeof o === 'object' ? o.value : o));

describe('inspector: one label per control (D348)', () => {
  it('there are types with a Layout row to measure', () => {
    assert.ok(TYPES_WITH_VARIANTS.length >= 5);
  });

  for (const lang of LOCALES) {
    it(`no inspector shows two controls with the same name (${lang})`, () => {
      const dict = DICTS[lang];
      const rowLabel = dict['editor.layoutSwitcher.chip'];
      assert.ok(rowLabel, 'the Layout row has a label');
      const clashes = [];
      for (const [type, def] of TYPES_WITH_VARIANTS) {
        const seen = new Map([[rowLabel.toLowerCase(), 'Layout row']]);
        for (const f of renderedKeeps(type, def)) {
          const label = String(dict[f.labelKey] ?? f.label ?? f.key);
          const prior = seen.get(label.toLowerCase());
          if (prior)
            clashes.push(`${type}: "${label}" on ${prior} and ${f.key}`);
          else seen.set(label.toLowerCase(), f.key);
        }
      }
      assert.deepEqual(clashes, []);
    });
  }

  it('no inspector keep repeats a choice the Layout row offers in full', () => {
    const doubled = [];
    for (const [type, def] of TYPES_WITH_VARIANTS) {
      const tiles = tileValues(def);
      for (const f of renderedKeeps(type, def)) {
        const reached = tiles.get(f.key);
        const opts = optionValues(f);
        if (!reached || !opts.length) continue;
        if (opts.every((v) => reached.has(v))) doubled.push(`${type}.${f.key}`);
      }
    }
    assert.deepEqual(doubled, []);
  });

  it('"Text size" names only the per-text S/M/L', () => {
    for (const lang of LOCALES) {
      const dict = DICTS[lang];
      const size = dict['editor.textStyle.size'];
      const others = Object.entries(dict)
        .filter(([k, v]) => v === size && k !== 'editor.textStyle.size')
        .map(([k]) => k);
      assert.deepEqual(others, [], `${lang}: "${size}" also on ${others}`);
      assert.notEqual(dict['editor.slideField.density.label'], size);
    }
  });
});

describe('storage of layout and density is unchanged (D348)', () => {
  const field = (type, key) =>
    SLIDE_TYPES[type].fields.find((f) => f.key === key);
  const values = (f) =>
    f.options.map((o) => (typeof o === 'object' ? o.value : o));

  it('content-slide keeps its layout enum and the tiles still write it', () => {
    const f = field('content-slide', 'layout');
    assert.equal(f.type, 'enum');
    assert.deepEqual(values(f), ['two-column', 'one-column']);
    const sets = getLayoutVariants(SLIDE_TYPES['content-slide'])
      .filter((v) => !v.convertTo)
      .map((v) => v.set);
    assert.deepEqual(sets, [
      { layout: 'one-column' },
      { layout: 'two-column' },
    ]);
  });

  it('list-slide keeps its layout enum', () => {
    const f = field('list-slide', 'layout');
    assert.equal(f.type, 'enum');
    assert.deepEqual(values(f), ['auto', 'one-column', 'two-column']);
  });

  it('density keeps its key and the shared vocabulary on both types', () => {
    for (const type of ['content-slide', 'list-slide']) {
      const f = field(type, 'density');
      assert.equal(f.type, 'enum');
      assert.equal(f.foldUnofferedTo, 'auto');
      for (const v of values(f)) assert.ok(DENSITY_VALUES.includes(v));
    }
    assert.deepEqual(values(field('content-slide', 'density')), [
      'auto',
      'compact',
    ]);
    assert.deepEqual(values(field('list-slide', 'density')), [
      'auto',
      'comfortable',
      'compact',
    ]);
  });
});
