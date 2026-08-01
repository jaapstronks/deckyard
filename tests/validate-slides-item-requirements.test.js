/**
 * SLIDE_ITEM_REQUIREMENTS is derived, its membership is not.
 *
 * The item-count table the AI validators enforce used to write its numbers out
 * by hand next to the definitions that already declared them. Since 2026-08-01
 * the numbers come from `fields[].minItems`/`maxItems` on the definition and
 * only the membership (which types get the strict check at all) stays a
 * hand-written judgement — a type that is absent takes the default branch, and
 * 19 other types declare item constraints without being listed.
 *
 * This file pins both halves: the derived values match the definitions
 * verbatim, and the membership is exactly the three types the behaviour was
 * written for. Growing the membership is a deliberate act that edits this test.
 *
 * Run with: node --test tests/validate-slides-item-requirements.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { SLIDE_ITEM_REQUIREMENTS } from '../server/utils/ai/validate-slides/constants.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';

describe('SLIDE_ITEM_REQUIREMENTS derivation', () => {
  it('keeps the membership at the three types the judgement was made for', () => {
    assert.deepStrictEqual(
      Object.keys(SLIDE_ITEM_REQUIREMENTS).sort(),
      ['kpi-metrics-slide', 'list-slide', 'timeline-slide']
    );
  });

  it('reads every value off the definition, verbatim', () => {
    for (const [type, req] of Object.entries(SLIDE_ITEM_REQUIREMENTS)) {
      const field = (SLIDE_TYPES[type]?.fields || []).find((f) => f.key === req.field);
      assert.ok(field, `${type}: field "${req.field}" not on the definition`);
      assert.strictEqual(req.min, field.minItems, `${type}: min diverges from minItems`);
      assert.strictEqual(req.max, field.maxItems, `${type}: max diverges from maxItems`);
    }
  });

  it('still carries the exact numbers the validators shipped with', () => {
    // The pre-derivation table, written out once more on purpose: if a
    // definition edit silently changes what the AI pipeline enforces, this is
    // the test that says so instead of the behaviour just drifting along.
    assert.deepStrictEqual(SLIDE_ITEM_REQUIREMENTS, {
      'list-slide': { field: 'items', min: 2, max: 8 },
      'timeline-slide': { field: 'items', min: 2, max: 10 },
      'kpi-metrics-slide': { field: 'metrics', min: 1, max: 4 },
    });
  });
});
