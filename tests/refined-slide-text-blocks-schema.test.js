/**
 * refined-slide Zod schema for text-blocks-slide: the array-canonical shape
 * must validate.
 *
 * Post-A0.4 the canonical text-blocks content is `rows[]` (the type's own
 * defaults are rows[]-only), and it carries up to 4 rows. The refine schema
 * used to require `row1Count` and know nothing of `rows[]`, so every
 * array-canonical slide — including each freshly-created one — failed
 * validation, which is what let a 4-row slide look invalid to the AI path.
 * These tests pin that both shapes pass and the numbered mirror stays optional.
 *
 * Run with: node --test tests/refined-slide-text-blocks-schema.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { validateSlideContent } from '../server/utils/ai/schemas/index.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';

const TYPE = 'text-blocks-slide';

function assertValid(content, label) {
  const { valid, issues } = validateSlideContent(TYPE, content);
  assert.ok(valid, `${label} should validate, got: ${JSON.stringify(issues)}`);
}

describe('refined-slide text-blocks schema accepts the array-canonical shape', () => {
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
      'rows[]-only slide'
    );
  });

  it("the type's own defaults (rows[]-only) validate", () => {
    // Guards the exact content every new slide starts from.
    assertValid(SLIDE_TYPES[TYPE].defaults, 'defaults');
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
    const { valid } = validateSlideContent(TYPE, { title: 'Too many', rows });
    assert.strictEqual(valid, false, '5 rows must not validate');
  });

  it('a legacy numbered slide still validates (mirror stays optional)', () => {
    assertValid(
      {
        title: 'Legacy numbered',
        row1Count: '2',
        row1Color: 'yellow',
        row1Block1Title: 'L1',
        row1Block1Body: 'Body 1',
        row1Block2Title: 'L2',
        row1Block2Body: 'Body 2',
        arrow1: 'down',
        row2Enabled: 'yes',
        row2Title: 'Second',
        row2Count: '1',
        row2Color: 'black',
        row2Block1Title: 'L3',
        row2Block1Body: 'Body 3',
      },
      'legacy numbered slide'
    );
  });
});
