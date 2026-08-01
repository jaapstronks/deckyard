/**
 * The closed field-editor vocabulary (editor-behaviour-abstraction step 4):
 * a field declares WHICH widget edits it (`editor: 'table-grid'`), the
 * resolver hands back only names the editor actually implements, and anything
 * else degrades to '' — the base widget for the field's type.
 *
 * Run with: node --test tests/field-editors.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIELD_EDITOR_VALUES,
  fieldEditor,
} from '../shared/slide-types/field-editors.js';

test('every vocabulary value resolves to itself', () => {
  for (const name of FIELD_EDITOR_VALUES) {
    assert.equal(fieldEditor({ key: 'x', editor: name }), name);
  }
});

test('unknown, empty and non-string declarations degrade to the base widget', () => {
  assert.equal(fieldEditor({ key: 'x', editor: 'holographic-3d' }), '');
  assert.equal(fieldEditor({ key: 'x', editor: '' }), '');
  assert.equal(fieldEditor({ key: 'x', editor: 42 }), '');
  assert.equal(fieldEditor({ key: 'x', editor: null }), '');
  assert.equal(fieldEditor({ key: 'x' }), '');
  assert.equal(fieldEditor(null), '');
});

test('whitespace is trimmed before matching', () => {
  assert.equal(fieldEditor({ key: 'x', editor: ' csv-grid ' }), 'csv-grid');
});

test('the vocabulary is frozen — a fork cannot widen it at runtime', () => {
  assert.ok(Object.isFrozen(FIELD_EDITOR_VALUES));
});

test('the registry declares only vocabulary names', async () => {
  // A declaration outside the closed set would silently degrade to the base
  // widget; that is the contract for FORK types, but a core type doing it is
  // a typo.
  const { SLIDE_TYPES } = await import('../shared/slide-types.js');
  for (const [type, def] of Object.entries(SLIDE_TYPES)) {
    const walk = (fields, path) => {
      for (const f of Array.isArray(fields) ? fields : []) {
        if (f?.editor !== undefined) {
          assert.ok(
            FIELD_EDITOR_VALUES.includes(f.editor),
            `${type}: ${path}${f.key} declares unknown editor "${f.editor}"`
          );
        }
        if (Array.isArray(f?.itemFields)) walk(f.itemFields, `${path}${f.key}.`);
      }
    };
    walk(def?.fields, '');
  }
});
