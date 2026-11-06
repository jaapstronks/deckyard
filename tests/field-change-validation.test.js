import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldChangeProblems,
  newFieldProblems,
  validateFieldChange,
} from '../shared/slide-types/field-change-validation.js';
import { validateFieldValue } from '../shared/slide-types/field-types.js';
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

test('a refusal inside a list carries its item index and sub-field as data', () => {
  const field = {
    key: 'rows',
    type: 'items',
    maxItems: 3,
    itemFields: [
      { key: 'link', type: 'url' },
      { key: 'cells', type: 'items', itemFields: [prose] },
    ],
  };
  const before = [{ link: 'https://example.com/', cells: [{ title: 'Kort' }] }];
  const after = [
    { link: 'javascript:alert(1)', cells: [{ title: 'Kort' }, { title: '' }] },
  ];
  assert.deepEqual(
    fieldChangeProblems(after, before, field).map((p) => p.path),
    [
      [0, 'link'],
      [0, 'cells', 1, 'title'],
    ],
  );
  assert.deepEqual(
    fieldChangeProblems([...after, {}, {}, {}], before, field)[0].path,
    [],
    'a refusal of the list itself has an empty path',
  );
  assert.deepEqual(
    fieldChangeProblems(after, before, field).flatMap((p) => p.errors),
    validateFieldChange(after, before, field),
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

test('a nested value gets the same outcome on a new item, an item of a new slide and a stored item', () => {
  const field = {
    key: 'rows',
    type: 'items',
    itemFields: [
      {
        key: 'blocks',
        type: 'items',
        maxItems: 2,
        itemFields: [
          { key: 'title', type: 'string', maxLength: 5 },
          { key: 'body', type: 'markdown', maxLength: 5 },
          { key: 'tone', type: 'enum', options: ['a', 'b'] },
        ],
      },
    ],
  };
  const stored = [{ blocks: [{ title: 'Ok' }] }];
  const cases = [
    { blocks: [{ title: 'Ok' }, { body: 'Te lange body' }] },
    { blocks: [{ title: 'Ok', tone: 'c' }] },
    { blocks: [{}, {}, {}] },
  ];
  for (const row of cases) {
    // The same row on index 0 (a stored neighbour) and on index 1 (new).
    const onStored = fieldChangeProblems([row], stored, field);
    const onNew = fieldChangeProblems([stored[0], row], stored, field);
    const ofNewSlide = newFieldProblems([row], field);
    const strip = (problems) =>
      problems.map(({ path, kind }) => [kind, ...path.slice(1)]).map(String);
    assert.ok(onStored.length, JSON.stringify(row));
    assert.deepEqual(strip(onNew), strip(onStored), JSON.stringify(row));
    assert.deepEqual(strip(ofNewSlide), strip(onStored), JSON.stringify(row));
    assert.deepEqual(
      newFieldProblems([row], field)
        .flatMap((p) => p.errors)
        .sort(),
      validateFieldValue([row], field).sort(),
      'the list validator refuses what the walk refuses',
    );
  }
});

test('a new slide with seven blocks in a row is refused like a stored one', () => {
  const rows = [
    { title: 'Rij', blocks: Array.from({ length: 7 }, () => ({ title: 'B' })) },
  ];
  const slide = {
    id: 's',
    type: 'text-blocks-slide',
    content: { title: 'T', rows },
  };
  const fresh = validateSlideFields(slide);
  assert.match(
    fresh[0]?.errors.join(' ') ?? '',
    /rows\[0\]\.blocks must have at most 6/,
  );
  assert.deepEqual(
    fresh[0].parts.map((p) => [p.kind, ...p.path]),
    [['list', 0, 'blocks']],
  );
  const previousSlide = {
    ...slide,
    content: { rows: [{ title: 'Rij', blocks: [] }] },
  };
  assert.deepEqual(
    validateSlideFields(slide, { previousSlide })[0].errors,
    fresh[0].errors,
  );
});
