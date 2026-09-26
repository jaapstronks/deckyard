/**
 * The derived content schema on text-blocks-slide: the deepest nesting any core
 * type declares, so it is where a derivation either walks `itemFields`
 * recursively or quietly stops one level short.
 *
 * Post-A0.4 the canonical text-blocks content is `rows[]` (the type's own
 * defaults are rows[]-only), carrying up to 4 rows, each with its own
 * `blocks[]`. A hand-written schema used to require `row1Count` and know
 * nothing of `rows[]`, so every array-canonical slide — including each freshly
 * created one — failed validation. Since D87 the schema is derived from
 * `fields[]`, which since B452 declares `rows[]` alone; these pin that the
 * derivation reads it, bound and all.
 *
 * Run with: node --test tests/content-schema-text-blocks.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { validateSlideContent } from '../server/utils/ai/schemas/index.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';

const TYPE = 'text-blocks-slide';
const DEF = SLIDE_TYPES[TYPE];

function assertValid(content, label) {
  const { valid, issues } = validateSlideContent(DEF, content);
  assert.ok(valid, `${label} should validate, got: ${JSON.stringify(issues)}`);
}

describe('the derived text-blocks schema accepts the array-canonical shape', () => {
  it('a rows[]-only slide (no numbered fields) validates', () => {
    assertValid(
      {
        title: 'Array canonical',
        rows: [
          {
            title: '',
            color: 'yellow',
            arrow: 'none',
            blocks: [
              { title: 'Block 1', body: 'Text' },
              { title: 'Block 2', body: 'Text' },
            ],
          },
        ],
      },
      'rows[]-only slide',
    );
  });

  it("the type's own defaults (rows[]-only) validate", () => {
    // Guards the exact content every new slide starts from.
    assertValid(DEF.defaults, 'defaults');
  });

  it('a 4-row slide validates (the array boundary is 4)', () => {
    const rows = Array.from({ length: 4 }, (_v, i) => ({
      title: `Row ${i + 1}`,
      color: i % 2 === 0 ? 'yellow' : 'black',
      arrow: 'none',
      blocks: [{ title: 'B', body: '' }],
    }));
    assertValid({ title: 'Four rows', rows }, '4-row slide');
  });

  it('a 5-row slide is rejected (over the array boundary)', () => {
    const rows = Array.from({ length: 5 }, () => ({
      color: 'yellow',
      blocks: [{ title: 'B' }],
    }));
    const { valid } = validateSlideContent(DEF, { title: 'Too many', rows });
    assert.strictEqual(valid, false, '5 rows must not validate');
  });

  it('a nested block field is bounded by its own declaration', () => {
    // `rows[].blocks[].title` declares its cap two levels down. A derivation
    // that stopped at the top level would accept anything here.
    const blockTitle = DEF.fields
      .find((f) => f.key === 'rows')
      .itemFields.find((f) => f.key === 'blocks')
      .itemFields.find((f) => f.key === 'title');
    assert.ok(blockTitle.maxLength > 0, 'the block title declares a maxLength');

    const { valid } = validateSlideContent(DEF, {
      rows: [{ blocks: [{ title: 'x'.repeat(blockTitle.maxLength + 1) }] }],
    });
    assert.strictEqual(
      valid,
      false,
      'an over-long block title must not validate',
    );
  });

  it('a numbered slide is refused, naming the keys (B452)', () => {
    // The numbered row{N}… shape is the v1 input of the v1 -> v2 fold, not a
    // field of the type: an agent that writes it is told, not folded.
    const { valid, issues } = validateSlideContent(DEF, {
      title: 'Numbered',
      row1Count: '1',
      row1Block1Title: 'L1',
    });
    assert.equal(valid, false);
    assert.deepEqual(issues[0].keys, ['row1Count', 'row1Block1Title']);
  });
});
