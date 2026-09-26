/**
 * text-blocks-slide rendering: the rows[]/blocks[] model and the inline-edit
 * contract on top of it (data-inline-item-index on rows and blocks, so the
 * WYSIWYG can add/remove them). The numbered row{N}… fields of v1 decks are
 * folded by the v1 -> v2 step and read by nothing else (B452); the renderer
 * draws nothing from them.
 *
 * Run with: node --test tests/text-blocks-render.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  renderSlideHtml,
  validateSlide,
} from '../shared/slide-types/presentation.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { validateSlideContentStructure } from '../server/utils/ai/validate-slide-structure.js';

function render(content) {
  return renderSlideHtml({ type: 'text-blocks-slide', content });
}

const NUMBERED_CONTENT = {
  title: 'Numbered',
  row1Count: '1',
  row1Block1Title: 'L1',
  row1Block1Body: 'Legacy body 1',
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
    const issues = validateSlideContentStructure(
      'text-blocks-slide',
      FOUR_ROW_CONTENT,
    );
    assert.deepEqual(issues, []);
  });
});

describe('text-blocks row headings (B299)', () => {
  it('the first row draws its heading like every other row', () => {
    const html = render({
      ...ARRAY_CONTENT,
      rows: [
        { ...ARRAY_CONTENT.rows[0], title: 'First row' },
        ARRAY_CONTENT.rows[1],
      ],
    });
    assert.match(
      html,
      /<h3 class="text-blocks-row-title text-blocks-step" data-inline-field="rows\.0\.title" dir="auto">First row<\/h3>/,
    );
    assert.match(
      html,
      /data-inline-field="rows\.1\.title" dir="auto">Second row</,
    );
  });

  it('a row without a heading draws none', () => {
    assert.doesNotMatch(
      render(ARRAY_CONTENT),
      /data-inline-field="rows\.0\.title"/,
    );
  });
});

describe('an empty rows[] is the canonical empty state (B435)', () => {
  it('draws no rows', () => {
    const html = render({ title: 'Empty', rows: [] });
    assert.match(html, /data-rows="0"/);
    assert.doesNotMatch(html, /class="text-block /);
  });
});

describe('the numbered row{N}… fields are read by nothing but the fold (B452)', () => {
  it('the renderer draws no rows from them', () => {
    const html = render(NUMBERED_CONTENT);
    assert.match(html, /data-rows="0"/);
    assert.doesNotMatch(html, /Legacy body 1/);
    assert.doesNotMatch(html, /data-inline-field="row1/);
  });

  it('the AI structure check asks for rows[]', () => {
    assert.deepEqual(
      validateSlideContentStructure('text-blocks-slide', NUMBERED_CONTENT),
      ['Missing rows[]'],
    );
  });

  it('the type declares no numbered field', () => {
    const keys = SLIDE_TYPES['text-blocks-slide'].fields.map((f) => f.key);
    assert.deepEqual(
      keys.filter((k) => /^(row|arrow)\d/.test(k)),
      [],
    );
  });
});
