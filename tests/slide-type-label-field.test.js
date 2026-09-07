/**
 * labelField — the declared slide-list label driver (A7.13 done-gate pass) —
 * and its per-items mirror `itemLabelField` (D81, A2.1).
 *
 * The editor resolves a slide's list label as labelField → title → type
 * label, with no per-type branches; that only holds if every declaration
 * names a field the type actually carries. A typo'd or stale labelField
 * would degrade silently to the title fallback, which is exactly the kind
 * of quiet drift this pins.
 *
 * `itemLabelField` earns the same pin for the same reason: naming a sub-field
 * the item does not carry degrades silently to the first-readable-string
 * default, which is exactly the projection the declaration exists to correct.
 *
 * `mediaRef` (D82, A2.2) is the third: it is what keeps a reference — a video
 * source that may be a bare provider id — out of the reader as text, and a
 * half-declared one degrades just as quietly (an unnamed medium, an ignored
 * author link).
 *
 * Run with: node --test tests/slide-type-label-field.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';

test('every declared labelField names a field on its own type', () => {
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    if (def.labelField === undefined) continue;
    assert.equal(
      typeof def.labelField,
      'string',
      `${name}: labelField must be a string`,
    );
    const keys = (def.fields || []).map((f) => f.key);
    assert.ok(
      keys.includes(def.labelField),
      `${name}: labelField '${def.labelField}' is not one of its fields (${keys.join(', ')})`,
    );
  }
});

test('every declared itemLabelField names a readable string sub-field', () => {
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    for (const field of def.fields || []) {
      if (field?.type !== 'items') continue;
      if (field.itemLabelField === undefined) continue;
      assert.equal(
        typeof field.itemLabelField,
        'string',
        `${name}.${field.key}: itemLabelField must be a string`,
      );
      // Readable, not merely present: a hidden or presentational sub-field is
      // never a heading, so declaring one is the same silent no-op as a typo.
      const headable = (field.itemFields || [])
        .filter((f) => f?.type === 'string' && !f.hidden && !f.presentational)
        .map((f) => f.key);
      assert.ok(
        headable.includes(field.itemLabelField),
        `${name}.${field.key}: itemLabelField '${field.itemLabelField}' is not ` +
          `a readable string sub-field (${headable.join(', ') || 'none'})`,
      );
    }
  }
});

test('every declared mediaRef is complete and names its own siblings', () => {
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    const keys = (def.fields || []).map((f) => f.key);
    for (const field of def.fields || []) {
      const ref = field?.mediaRef;
      if (ref === undefined) continue;
      assert.ok(
        ref && typeof ref === 'object' && !Array.isArray(ref),
        `${name}.${field.key}: mediaRef must be an object`,
      );
      assert.equal(
        field.type,
        'string',
        `${name}.${field.key}: mediaRef belongs on a string reference`,
      );
      assert.ok(
        typeof ref.label === 'string' && ref.label.trim(),
        `${name}.${field.key}: mediaRef needs a label — without it the reader ` +
          `calls the medium "Media"`,
      );
      if (ref.linkKey === undefined) continue;
      assert.ok(
        keys.includes(ref.linkKey),
        `${name}.${field.key}: mediaRef.linkKey '${ref.linkKey}' is not one ` +
          `of its fields (${keys.join(', ')})`,
      );
    }
  }
});
