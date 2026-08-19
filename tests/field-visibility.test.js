/**
 * The `visibleWhen` declaration (editor-behaviour-abstraction step 4): a field
 * that only means something while a sibling holds certain values declares the
 * condition; the generic form loop reads it. Malformed declarations must
 * degrade to VISIBLE — hiding a field on a parse error would orphan its data.
 *
 * Run with: node --test tests/field-visibility.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { isFieldVisible } from '../shared/slide-types/field-visibility.js';

const showValues = {
  key: 'showValues',
  visibleWhen: { field: 'chartType', in: ['bar'] },
};

test('visible while the driving field holds a listed value', () => {
  assert.equal(isFieldVisible(showValues, { chartType: 'bar' }), true);
  assert.equal(isFieldVisible(showValues, { chartType: 'pie' }), false);
  assert.equal(isFieldVisible(showValues, { chartType: 'line' }), false);
});

test('an unset driving field falls back to the type default', () => {
  assert.equal(isFieldVisible(showValues, {}, { chartType: 'bar' }), true);
  assert.equal(isFieldVisible(showValues, {}, { chartType: 'pie' }), false);
  // Empty string counts as unset — the '' convention for cleared fields.
  assert.equal(
    isFieldVisible(showValues, { chartType: '' }, { chartType: 'bar' }),
    true,
  );
});

test('no declaration means visible', () => {
  assert.equal(isFieldVisible({ key: 'title' }, { chartType: 'pie' }), true);
});

test('malformed declarations degrade to visible, never to hidden', () => {
  for (const visibleWhen of [
    null,
    'chartType=bar',
    {},
    { field: 'chartType' }, // no list
    { in: ['bar'] }, // no field
    { field: '', in: ['bar'] },
    { field: 'chartType', in: 'bar' }, // list is not an array
  ]) {
    assert.equal(
      isFieldVisible({ key: 'x', visibleWhen }, { chartType: 'pie' }),
      true,
      `expected visible for ${JSON.stringify(visibleWhen)}`,
    );
  }
});

test('values compare as strings (enum values may be declared as numbers)', () => {
  const f = { key: 'x', visibleWhen: { field: 'count', in: [2, '3'] } };
  assert.equal(isFieldVisible(f, { count: '2' }), true);
  assert.equal(isFieldVisible(f, { count: 3 }), true);
  assert.equal(isFieldVisible(f, { count: '4' }), false);
});
