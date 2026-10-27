import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFieldChange } from '../shared/slide-types/field-change-validation.js';
import { validateSlideFields } from '../shared/slide-types/presentation.js';
const prose = { key: 'title', type: 'string', required: true, maxLength: 5 };

test('stored prose defects can be retained but newly changed defects are refused', () => {
  assert.deepEqual(
    validateFieldChange('Old long title', 'Old long title', prose),
    [],
  );
  assert.deepEqual(validateFieldChange('', '', prose), []);
  assert.match(
    validateFieldChange('New long title', 'Old long title', prose)[0],
    /max length/,
  );
  assert.match(validateFieldChange('', 'Valid', prose)[0], /required/);
  assert.match(validateFieldChange(123, 123, prose).join(' '), /string/);
});

test('retaining prose never exempts URLs, machine fields or broken collection structure', () => {
  for (const url of ['javascript:alert(1)', 'example.com'])
    assert.ok(
      validateFieldChange(url, url, { key: 'link', type: 'url' }).length,
    );
  assert.ok(
    validateFieldChange('Old long title', 'Old long title', {
      ...prose,
      presentational: true,
    }).length,
  );
  assert.ok(
    validateFieldChange('Old long title', 'Old long title', {
      ...prose,
      mediaRef: {},
    }).length,
  );
  const items = {
    key: 'items',
    type: 'items',
    minItems: 2,
    maxItems: 3,
    itemFields: [prose],
  };
  for (const value of ['not an array', [], [null], [{}, {}, {}, {}]])
    assert.ok(validateFieldChange(value, value, items).length);
});

test('each existing nested text is compared by its stored path, and new items are strict', () => {
  const field = {
    key: 'rows',
    type: 'items',
    itemFields: [{ key: 'cells', type: 'items', itemFields: [prose] }],
  };
  const before = [{ cells: [{ title: 'Stored long text' }] }];
  assert.deepEqual(validateFieldChange(before, before, field), []);
  const after = structuredClone(before);
  after[0].cells.push({ title: '' });
  assert.match(
    validateFieldChange(after, before, field)[0],
    /rows\[0\].cells\[1\].title is required/,
  );
  after[0].cells[1].title = 'New long text';
  assert.match(
    validateFieldChange(after, before, field)[0],
    /rows\[0\].cells\[1\].title exceeds/,
  );
});

test('a different slide id or type cannot claim another slide’s saved text exemption', () => {
  const slideTypes = { alpha: { fields: [prose] }, beta: { fields: [prose] } };
  const slide = {
    id: 'one',
    type: 'alpha',
    content: { title: 'Old long title' },
  };
  assert.ok(validateSlideFields(slide, { slideTypes }).length);
  assert.deepEqual(
    validateSlideFields(slide, { slideTypes, previousSlide: slide }),
    [],
  );
  for (const previousSlide of [
    { ...slide, id: 'two' },
    { ...slide, type: 'beta' },
  ])
    assert.ok(validateSlideFields(slide, { slideTypes, previousSlide }).length);
});

test('the registry decides type identity across the public id and its storage key', () => {
  const previousSlide = {
    id: 'same',
    type: 'title-slide',
    content: { title: 'A'.repeat(300) },
  };
  const slide = { ...previousSlide, type: 'eu.deckyard.slide.title' };
  assert.ok(validateSlideFields(slide).length);
  assert.deepEqual(validateSlideFields(slide, { previousSlide }), []);
});
