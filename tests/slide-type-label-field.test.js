/**
 * labelField — the declared slide-list label driver (A7.13 done-gate pass).
 *
 * The editor resolves a slide's list label as labelField → title → type
 * label, with no per-type branches; that only holds if every declaration
 * names a field the type actually carries. A typo'd or stale labelField
 * would degrade silently to the title fallback, which is exactly the kind
 * of quiet drift this pins.
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
      `${name}: labelField must be a string`
    );
    const keys = (def.fields || []).map((f) => f.key);
    assert.ok(
      keys.includes(def.labelField),
      `${name}: labelField '${def.labelField}' is not one of its fields (${keys.join(', ')})`
    );
  }
});
