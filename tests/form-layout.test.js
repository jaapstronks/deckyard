/**
 * Form-layout declarations: the `formLayout` hint that replaced the four
 * layout-only slide forms (step 2 of the editor-behaviour-abstraction brief).
 *
 * Two halves. The model — a closed vocabulary, unknown values degrading to the
 * default, runs grouped without ever losing or reordering a field. And the
 * adoption — the four types that used to carry a hand-written form declare the
 * pairing those forms encoded, and none of them is in the router table any more.
 *
 * Run with: node --test tests/form-layout.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FORM_LAYOUT_VALUES,
  fieldFormLayout,
  fieldFormRows,
} from '../shared/slide-types/form-layout.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';

/** Flatten rows back to keys — the invariant every case below leans on. */
const flat = (rows) => rows.flatMap((r) => r.keys);

describe('the hint vocabulary is closed and degrades', () => {
  it('reads a declared value', () => {
    assert.equal(fieldFormLayout({ key: 'a', formLayout: 'pair' }), 'pair');
    assert.equal(fieldFormLayout({ key: 'a', formLayout: '  pair  ' }), 'pair');
  });

  it('an undeclared field has no hint', () => {
    assert.equal(fieldFormLayout({ key: 'a' }), '');
    assert.equal(fieldFormLayout(null), '');
  });

  it('an unknown value degrades to the default instead of breaking', () => {
    // Seam rule 5: a fork may not land a hint the editor has no rendering for.
    assert.equal(fieldFormLayout({ key: 'a', formLayout: 'two-thirds' }), '');
    assert.equal(fieldFormLayout({ key: 'a', formLayout: 42 }), '');
    assert.deepEqual(
      fieldFormRows([{ key: 'a', formLayout: 'two-thirds' }, { key: 'b', formLayout: 'two-thirds' }]),
      [{ pair: false, keys: ['a'] }, { pair: false, keys: ['b'] }]
    );
  });

  it('every declared value is one the vocabulary lists', () => {
    for (const value of FORM_LAYOUT_VALUES) {
      assert.equal(fieldFormLayout({ key: 'a', formLayout: value }), value);
    }
  });
});

describe('fields group into rows without losing or reordering any', () => {
  it('an undeclared type is one field per row', () => {
    assert.deepEqual(
      fieldFormRows([{ key: 'a' }, { key: 'b' }, { key: 'c' }]),
      [
        { pair: false, keys: ['a'] },
        { pair: false, keys: ['b'] },
        { pair: false, keys: ['c'] },
      ]
    );
  });

  it('a run of consecutive pairs becomes one row', () => {
    const rows = fieldFormRows([
      { key: 'title' },
      { key: 'variant', formLayout: 'pair' },
      { key: 'layout', formLayout: 'pair' },
      { key: 'items' },
    ]);
    assert.deepEqual(rows, [
      { pair: false, keys: ['title'] },
      { pair: true, keys: ['variant', 'layout'] },
      { pair: false, keys: ['items'] },
    ]);
  });

  it('two runs separated by a plain field stay two rows', () => {
    const rows = fieldFormRows([
      { key: 'a', formLayout: 'pair' },
      { key: 'b', formLayout: 'pair' },
      { key: 'gap' },
      { key: 'c', formLayout: 'pair' },
      { key: 'd', formLayout: 'pair' },
    ]);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0].keys, ['a', 'b']);
    assert.deepEqual(rows[2].keys, ['c', 'd']);
  });

  it('a run of three is one row (the name says pair, the rule says run)', () => {
    const rows = fieldFormRows([
      { key: 'a', formLayout: 'pair' },
      { key: 'b', formLayout: 'pair' },
      { key: 'c', formLayout: 'pair' },
    ]);
    assert.deepEqual(rows, [{ pair: true, keys: ['a', 'b', 'c'] }]);
  });

  it('junk input is total, not throwing', () => {
    assert.deepEqual(fieldFormRows(null), []);
    assert.deepEqual(fieldFormRows(undefined), []);
    assert.deepEqual(fieldFormRows([null, { label: 'no key' }, { key: '' }]), []);
  });

  it('flattening any real type reproduces its field order exactly', () => {
    for (const [type, def] of Object.entries(SLIDE_TYPES)) {
      const keys = (def.fields || []).map((f) => f.key);
      assert.deepEqual(flat(fieldFormRows(def.fields)), keys, `${type} field order`);
    }
  });
});

describe('the four retired forms are declarations now', () => {
  const pairsOf = (type) =>
    fieldFormRows(SLIDE_TYPES[type].fields)
      .filter((r) => r.pair)
      .map((r) => r.keys);

  it('title-slide pairs background colour with the logo corner', () => {
    assert.deepEqual(pairsOf('title-slide'), [['background', 'logoCorner']]);
  });

  it('list-slide pairs style with layout', () => {
    assert.deepEqual(pairsOf('list-slide'), [['variant', 'layout']]);
  });

  it('kpi-metrics-slide pairs accent with the count-up toggle', () => {
    assert.deepEqual(pairsOf('kpi-metrics-slide'), [['accent', 'countUp']]);
  });

  it('content-slide needs no declaration at all', () => {
    // Its form was pure schema order: the lone one-field grid it wrapped the
    // layout enum in became vestigial when .field-grid went flex-wrap, so
    // "every field on its own line" is already the right answer.
    assert.deepEqual(pairsOf('content-slide'), []);
  });

  it('none of the four is in the router table any more', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../client/views/editor/editor-form/slide-form-router.js', import.meta.url),
      'utf8'
    );
    const table = src.slice(src.indexOf('const SLIDE_FORMS'), src.indexOf(']);'));
    for (const type of ['title-slide', 'content-slide', 'list-slide', 'kpi-metrics-slide']) {
      assert.ok(!table.includes(`'${type}'`), `${type} should render generically`);
    }
  });
});

describe('no type declares a pair with nobody to pair with', () => {
  it('every paired run has at least two members', () => {
    // Rendering a lone `pair` is harmless — it degrades to a one-field row —
    // but in a definition it means the partner was renamed, moved or deleted
    // and the hint was left behind. That is the drift worth catching, and the
    // run merging makes it the only shape a broken pair can take.
    const lonely = [];
    for (const [type, def] of Object.entries(SLIDE_TYPES)) {
      for (const row of fieldFormRows(def.fields)) {
        if (row.pair && row.keys.length < 2) lonely.push(`${type}: ${row.keys[0]}`);
      }
    }
    assert.deepEqual(lonely, [], `these fields pair with nothing:\n${lonely.join('\n')}`);
  });
});
