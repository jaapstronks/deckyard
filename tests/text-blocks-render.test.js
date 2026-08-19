/**
 * text-blocks-slide rendering: the dual-read row/block model.
 *
 * Covers both content shapes:
 * - legacy numbered fields (row1Count, row1Block1Title, row2Enabled, ...)
 * - array-canonical rows[] (rows[i].blocks[j], now also the defaults shape)
 * and the inline-edit contract on top of them: array-mode slides emit
 * data-inline-item-index on rows and blocks (so the WYSIWYG can add/remove
 * them), legacy slides must not (their renderer reads the numbered fields).
 *
 * Run with: node --test tests/text-blocks-render.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';

import {
  renderSlideHtml,
  validateSlide,
} from '../shared/slide-types/presentation.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { validateSlideContentStructure } from '../server/utils/ai/validate-slide-structure.js';

function render(content) {
  return renderSlideHtml({ type: 'text-blocks-slide', content });
}

const LEGACY_CONTENT = {
  title: 'Legacy',
  row1Count: '2',
  row1Color: 'yellow',
  row1Block1Title: 'L1',
  row1Block1Body: 'Legacy body 1',
  row1Block2Title: 'L2',
  row1Block2Body: 'Legacy body 2',
  arrow1: 'down',
  row2Enabled: 'yes',
  row2Title: 'Second row',
  row2Count: '1',
  row2Color: 'black',
  row2Block1Title: 'L3',
  row2Block1Body: 'Legacy body 3',
};

const ARRAY_CONTENT = {
  title: 'Array',
  rows: [
    {
      title: '',
      color: 'yellow',
      arrow: 'down',
      blocks: [
        { title: 'A1', body: 'Array body 1' },
        { title: 'A2', body: 'Array body 2' },
      ],
    },
    {
      title: 'Second row',
      color: 'black',
      arrow: 'none',
      blocks: [{ title: 'A3', body: 'Array body 3' }],
    },
  ],
};

describe('text-blocks legacy numbered shape', () => {
  it('renders rows, blocks and the arrow from the numbered fields', () => {
    const html = render(LEGACY_CONTENT);
    assert.match(html, /data-rows="2"/);
    assert.match(html, /L1/);
    assert.match(html, /L3/);
    assert.match(html, /Second row/);
    assert.match(html, /text-blocks-arrow/);
  });

  it('emits legacy inline-field paths', () => {
    const html = render(LEGACY_CONTENT);
    assert.match(html, /data-inline-field="row1Block1Title"/);
    assert.match(html, /data-inline-field="row2Block1Body"/);
    assert.match(html, /data-inline-field="row2Title"/);
  });

  it('does NOT emit item indexes (no inline add/remove on legacy decks)', () => {
    const html = render(LEGACY_CONTENT);
    assert.doesNotMatch(html, /data-inline-item-index/);
  });

  it('validates', () => {
    const errors = validateSlide({
      id: crypto.randomUUID(),
      type: 'text-blocks-slide',
      content: LEGACY_CONTENT,
    });
    assert.deepEqual(errors, []);
  });
});

describe('text-blocks rows[] shape', () => {
  it('renders rows, blocks and the arrow from rows[]', () => {
    const html = render(ARRAY_CONTENT);
    assert.match(html, /data-rows="2"/);
    assert.match(html, /A1/);
    assert.match(html, /A3/);
    assert.match(html, /Second row/);
    assert.match(html, /text-blocks-arrow/);
  });

  it('emits rows.{i}... inline-field paths', () => {
    const html = render(ARRAY_CONTENT);
    assert.match(html, /data-inline-field="rows\.0\.blocks\.1\.title"/);
    assert.match(html, /data-inline-field="rows\.1\.blocks\.0\.body"/);
    assert.match(html, /data-inline-field="rows\.1\.title"/);
  });

  it('emits item indexes on rows and blocks (inline add/remove contract)', () => {
    const html = render(ARRAY_CONTENT);
    assert.match(
      html,
      /class="text-blocks-row" data-count="2" data-inline-item-index="0"/,
    );
    assert.match(
      html,
      /class="text-blocks-row" data-count="1" data-inline-item-index="1"/,
    );
    // Block indexes restart per row
    const blockIndexes = [
      ...html.matchAll(
        /text-block text-blocks-step[^"]*"[^>]*data-inline-item-index="(\d+)"/g,
      ),
    ].map((m) => m[1]);
    assert.deepEqual(blockIndexes, ['0', '1', '0']);
  });

  it('takes precedence over legacy fields when both are present', () => {
    const html = render({ ...LEGACY_CONTENT, ...ARRAY_CONTENT });
    assert.match(html, /A1/);
    assert.doesNotMatch(html, /L1/);
    assert.match(html, /data-inline-field="rows\.0\.blocks\.0\.title"/);
    assert.doesNotMatch(html, /data-inline-field="row1Block1Title"/);
  });

  it('validates', () => {
    const errors = validateSlide({
      id: crypto.randomUUID(),
      type: 'text-blocks-slide',
      content: ARRAY_CONTENT,
    });
    assert.deepEqual(errors, []);
  });
});

describe('text-blocks defaults', () => {
  it('defaults are array-canonical (one row, three blocks, no legacy fields)', () => {
    const def = SLIDE_TYPES['text-blocks-slide'];
    for (const defaults of [
      def.defaults,
      def.defaultsByLang['en-GB'],
      def.defaultsByLang.nl,
    ]) {
      assert.ok(Array.isArray(defaults.rows), 'rows must be an array');
      assert.equal(defaults.rows.length, 1);
      assert.equal(defaults.rows[0].blocks.length, 3);
      assert.equal(defaults.row1Count, undefined);
      assert.equal(defaults.row2Enabled, undefined);
    }
  });

  it('renders the defaults in array mode with item indexes', () => {
    const def = SLIDE_TYPES['text-blocks-slide'];
    const html = render(structuredClone(def.defaults));
    assert.match(html, /data-rows="1"/);
    assert.match(html, /Block 1/);
    assert.match(html, /data-inline-item-index="0"/);
    assert.match(html, /data-inline-field="rows\.0\.blocks\.2\.body"/);
  });

  it('schema itemDefaults for a new row carry starter blocks', () => {
    const def = SLIDE_TYPES['text-blocks-slide'];
    const rowsField = def.fields.find((f) => f.key === 'rows');
    assert.ok(Array.isArray(rowsField.itemDefaults.blocks));
    assert.equal(rowsField.itemDefaults.blocks.length, 3);
  });

  it('defaults validate', () => {
    const def = SLIDE_TYPES['text-blocks-slide'];
    const errors = validateSlide({
      id: crypto.randomUUID(),
      type: 'text-blocks-slide',
      content: structuredClone(def.defaults),
    });
    assert.deepEqual(errors, []);
  });
});

// A0.4: rows[] carries up to 4 rows (route (b) — the numbered mirror stays
// frozen at 3, so a 4th row exists only in the array shape).
const FOUR_ROW_CONTENT = {
  title: 'Four rows',
  rows: [
    {
      title: '',
      color: 'yellow',
      arrow: 'down',
      blocks: [{ title: 'R1', body: 'a' }],
    },
    {
      title: 'Row two',
      color: 'black',
      arrow: 'down',
      blocks: [{ title: 'R2', body: 'b' }],
    },
    {
      title: 'Row three',
      color: 'yellow',
      arrow: 'down',
      blocks: [{ title: 'R3', body: 'c' }],
    },
    {
      title: 'Row four',
      color: 'black',
      arrow: 'none',
      blocks: [{ title: 'R4', body: 'd' }],
    },
  ],
};

describe('text-blocks four rows (A0.4)', () => {
  it('renders four rows from rows[]', () => {
    const html = render(FOUR_ROW_CONTENT);
    assert.match(html, /data-rows="4"/);
    assert.match(html, /R4/);
    assert.match(html, /data-inline-field="rows\.3\.blocks\.0\.title"/);
  });

  it('a four-row slide validates', () => {
    const errors = validateSlide({
      id: crypto.randomUUID(),
      type: 'text-blocks-slide',
      content: FOUR_ROW_CONTENT,
    });
    assert.deepEqual(errors, []);
  });

  it('a fifth row is rejected (maxItems stays a real cap)', () => {
    const fiveRows = {
      title: 'Five rows',
      rows: [
        ...FOUR_ROW_CONTENT.rows,
        {
          title: 'Row five',
          color: 'yellow',
          arrow: 'none',
          blocks: [{ title: 'R5', body: 'e' }],
        },
      ],
    };
    const errors = validateSlide({
      id: crypto.randomUUID(),
      type: 'text-blocks-slide',
      content: fiveRows,
    });
    assert.ok(errors.length > 0, 'five rows should not validate');
    assert.match(errors.join(' '), /at most 4 items/);
  });

  it('passes AI structure validation via the rows[] branch', () => {
    // rows[]-canonical (no numbered mirror at all): the AI validator must read
    // the array directly rather than demanding row1Count/row1Block1Title.
    const issues = validateSlideContentStructure(
      'text-blocks-slide',
      FOUR_ROW_CONTENT,
    );
    assert.deepEqual(issues, []);
  });
});

describe('text-blocks legacy mirror stays frozen at 3 (A0.4)', () => {
  // Byte-for-byte guard: bumping the rows[] cap to 4 must not perturb how a
  // legacy numbered-only deck renders. Pinned by hash so any drift in the
  // legacy read path fails loudly. Regenerate only with a deliberate, reviewed
  // change to the legacy output.
  const LEGACY_3_ROW = {
    title: 'Roadmap',
    row1Count: '2',
    row1Color: 'yellow',
    arrow1: 'down',
    row1Block1Title: 'Now',
    row1Block1Body: 'Ship it',
    row1Block2Title: 'Next',
    row1Block2Body: 'Refine',
    row2Enabled: 'yes',
    row2Title: 'Phase two',
    row2Count: '1',
    row2Color: 'black',
    arrow2: 'down',
    row2Block1Title: 'Later',
    row2Block1Body: 'Scale',
    row3Enabled: 'yes',
    row3Title: 'Phase three',
    row3Count: '1',
    row3Color: 'yellow',
    row3Block1Title: 'Someday',
    row3Block1Body: 'Dream',
  };
  const LEGACY_3_ROW_SHA256 =
    '15f50455903ff774d41d4c30d8bc68aec10a8e712293c5eaf0c4f7bdc362843d';

  it('renders byte-for-byte identical to the frozen baseline', () => {
    const html = render(LEGACY_3_ROW);
    const digest = createHash('sha256').update(html).digest('hex');
    assert.equal(digest, LEGACY_3_ROW_SHA256);
    assert.match(html, /data-rows="3"/);
  });

  it('legacy read path never yields a fourth row (row4* is not vocabulary)', () => {
    // Even with stray row4* fields, resolveRows caps a numbered-only deck at 3.
    const html = render({
      ...LEGACY_3_ROW,
      row4Enabled: 'yes',
      row4Count: '1',
      row4Block1Title: 'Ghost',
      row4Block1Body: 'nope',
    });
    assert.match(html, /data-rows="3"/);
    assert.doesNotMatch(html, /Ghost/);
  });
});
