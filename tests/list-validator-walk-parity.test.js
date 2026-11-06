// The list validator (`validateFieldValue` on an `items` field, i.e.
// `validateItems`) and the walk for a new value (`newFieldProblems`) must
// refuse the same things, for every list of every registered type, at every
// depth (DY-864). `docs/reference/collab-deck-doc.md` promises it; this test
// generates the comparison over the whole register, so a later type with a new
// sub-field type cannot pull the two apart without turning it red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import {
  FIELD_TYPES,
  enumOptionValues,
  validateFieldValue,
} from '../shared/slide-types/field-types.js';
import { newFieldProblems } from '../shared/slide-types/field-change-validation.js';

/** A value each field type accepts, so a mutation is the only defect. */
function validValue(field) {
  switch (field.type) {
    case 'number':
      return Number.isFinite(field.min) ? field.min : 1;
    case 'boolean':
      return true;
    case 'enum':
      return enumOptionValues(field).find((v) => v !== '') ?? '';
    case 'url':
      return 'https://example.org/a';
    case 'email':
      return 'a@example.org';
    case 'image':
      return 'https://example.org/a.png';
    case 'images':
      return ['https://example.org/a.png'];
    case 'color':
      return '#000000';
    case 'items':
      return validList(field);
    default:
      return 'a';
  }
}

function validItem(field) {
  return Object.fromEntries(
    (field.itemFields || []).map((f) => [f.key, validValue(f)]),
  );
}

function validList(field) {
  const count = Math.max(1, Number(field.minItems || 0) || 0);
  return Array.from({ length: count }, () => validItem(field));
}

/** A value of the wrong JSON type for this field type. */
function wrongType(field) {
  switch (field.type) {
    case 'number':
      return 'not a number';
    case 'boolean':
      return 'yes';
    case 'items':
    case 'images':
      return 'not a list';
    default:
      return 42;
  }
}

/**
 * The defective values of one sub-field: `{ label, value, refused }`, where
 * `refused` says the value must be refused, so the comparison is not
 * vacuously equal on two empty lists.
 */
function subFieldMutations(field) {
  const out = [{ label: 'wrong type', value: wrongType(field), refused: true }];
  if (field.maxLength) {
    out.push({
      label: 'too long',
      value: 'x'.repeat(field.maxLength + 1),
      // A truncating field shortens instead of refusing.
      refused: field.overflow !== 'truncate',
    });
  }
  if (field.type === 'enum') {
    out.push({ label: 'unknown option', value: '__nope__', refused: true });
  }
  if (field.required) {
    out.push({ label: 'missing', value: undefined, refused: true });
    out.push({
      label: 'empty',
      value: field.type === 'items' ? [] : '',
      refused: true,
    });
  }
  if (field.type === 'items') {
    for (const m of listMutations(field)) out.push(m);
  }
  return out;
}

/**
 * Every defective value of a list field: the list itself wrong, its count
 * outside its limits, an item that is not an object, and each sub-field of an
 * item with each of its defects, a nested list's own defects included. The
 * defective item sits in a list that is otherwise valid, first and last.
 */
function listMutations(field) {
  const out = [
    { label: 'not an array', value: 'not a list', refused: true },
    { label: 'item not an object', value: [null], refused: true },
  ];
  const min = Number(field.minItems || 0) || 0;
  const max = Number(field.maxItems || 0) || 0;
  if (min > 0) {
    out.push({
      label: `below minItems (${min})`,
      value: Array.from({ length: min - 1 }, () => validItem(field)),
      refused: true,
    });
  }
  if (max > 0) {
    out.push({
      label: `above maxItems (${max})`,
      value: Array.from({ length: max + 1 }, () => validItem(field)),
      refused: true,
    });
  }
  const base = validList(field);
  for (const sub of field.itemFields || []) {
    for (const m of subFieldMutations(sub)) {
      for (const index of new Set([0, base.length])) {
        const list = base.map((item) => ({ ...item }));
        const item = validItem(field);
        if (m.value === undefined) delete item[sub.key];
        else item[sub.key] = m.value;
        list[index] = item;
        if (max && list.length > max) continue;
        out.push({
          label: `[${index}].${sub.key}: ${m.label}`,
          value: list,
          refused: m.refused,
        });
      }
    }
  }
  return out;
}

/** Every list field of every registered type, with the type it belongs to. */
function registeredListFields() {
  const lists = [];
  for (const [typeName, type] of Object.entries(SLIDE_TYPES)) {
    for (const field of type.fields || []) {
      if (field.type === 'items') lists.push({ typeName, field });
    }
  }
  return lists;
}

const sorted = (errors) => [...errors].sort();

test('the register has lists to compare, a nested one included', () => {
  const lists = registeredListFields();
  assert.ok(lists.length > 0);
  assert.ok(
    lists.some(({ field }) =>
      (field.itemFields || []).some((f) => f.type === 'items'),
    ),
    'expected a list inside a list item (rows[].blocks[])',
  );
  // Every sub-field type the generator meets is a declared one: an unknown
  // type would make both sides silently skip it.
  const walk = (fields) => {
    for (const f of fields || []) {
      assert.ok(FIELD_TYPES[f.type], `unknown field type ${f.type}`);
      if (f.type === 'items') walk(f.itemFields);
    }
  };
  for (const { field } of lists) walk(field.itemFields);
});

for (const { typeName, field } of registeredListFields()) {
  test(`${typeName}.${field.key}: list validator and walk refuse the same`, () => {
    const cases = [
      { label: 'valid list', value: validList(field), refused: false },
      ...listMutations(field),
    ];
    for (const { label, value, refused } of cases) {
      const list = sorted(validateFieldValue(value, field));
      const walk = sorted(
        newFieldProblems(value, field).flatMap((p) => p.errors),
      );
      assert.deepEqual(walk, list, `${typeName}.${field.key} ${label}`);
      if (refused) {
        assert.ok(
          list.length > 0,
          `${typeName}.${field.key} ${label}: refused`,
        );
      } else if (label === 'valid list') {
        assert.deepEqual(list, [], `${typeName}.${field.key} valid list`);
      }
    }
  });
}
