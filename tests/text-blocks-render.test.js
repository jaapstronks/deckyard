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

import { renderSlideHtml, validateSlide } from '../shared/slide-types/presentation.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';

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
    assert.match(html, /class="text-blocks-row" data-count="2" data-inline-item-index="0"/);
    assert.match(html, /class="text-blocks-row" data-count="1" data-inline-item-index="1"/);
    // Block indexes restart per row
    const blockIndexes = [...html.matchAll(/text-block text-blocks-step[^"]*"[^>]*data-inline-item-index="(\d+)"/g)]
      .map((m) => m[1]);
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
