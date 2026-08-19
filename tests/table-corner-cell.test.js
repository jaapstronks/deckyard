/**
 * table-slide `cornerCell`: whether the top-left corner cell reads as the head
 * of the label column (default, historical) or as part of the header band.
 *
 * The corner variant is a small orthogonal field, not a fourth tableStyle: one
 * modifier class (`md-table--corner-header`) that composes with every style.
 * These tests pin the two invariants that matter:
 *  - old decks (no cornerCell) and an explicit 'label' render byte-for-byte as
 *    before — the modifier class never appears;
 *  - 'header' adds the modifier, and it composes with plain/soft/panel alike.
 * Plus the discoverability contract: the field reaches agents via the catalog.
 *
 * Run with: node --test tests/table-corner-cell.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import { resolveAgentSlideTypes } from '../server/utils/ai/slide-catalog/agent-catalog.js';

const CORNER_CLASS = 'md-table--corner-header';

function render(content) {
  return renderSlideHtml({ type: 'table-slide', content });
}

// A representative "old" deck: no cornerCell key at all.
const LEGACY_CONTENT = {
  title: 'Quarterly numbers',
  colCount: '3',
  headerRow: 'on',
  rows: [
    { c1: 'Metric', c2: 'Q1', c3: 'Q2' },
    { c1: 'Revenue', c2: '10', c3: '12' },
  ],
  tableStyle: 'soft',
};

describe('table-slide cornerCell', () => {
  it('a legacy deck (no cornerCell) renders without the corner modifier', () => {
    const html = render(LEGACY_CONTENT);
    assert.ok(
      !html.includes(CORNER_CLASS),
      'absent cornerCell must not fold the corner into the header',
    );
    // The exact class list is pinned so a future default flip is caught.
    assert.ok(html.includes('class="md-table md-table--soft"'));
  });

  it('an explicit cornerCell "label" is identical to a legacy deck', () => {
    const legacy = render(LEGACY_CONTENT);
    const explicit = render({ ...LEGACY_CONTENT, cornerCell: 'label' });
    assert.strictEqual(explicit, legacy);
  });

  it('cornerCell "header" adds the modifier class', () => {
    const html = render({ ...LEGACY_CONTENT, cornerCell: 'header' });
    assert.ok(html.includes(CORNER_CLASS));
    assert.ok(html.includes(`class="md-table md-table--soft ${CORNER_CLASS}"`));
  });

  it('the modifier composes with every table style', () => {
    for (const style of ['plain', 'panel', 'soft']) {
      const html = render({
        ...LEGACY_CONTENT,
        tableStyle: style,
        cornerCell: 'header',
      });
      assert.ok(
        html.includes(`md-table--${style} ${CORNER_CLASS}`),
        `corner modifier must apply on tableStyle "${style}"`,
      );
    }
  });

  it('an unknown cornerCell value falls back to the historical look', () => {
    const html = render({ ...LEGACY_CONTENT, cornerCell: 'nonsense' });
    assert.ok(!html.includes(CORNER_CLASS));
  });

  it('the field is discoverable in the agent catalog', () => {
    const table = resolveAgentSlideTypes({})['table-slide'];
    assert.ok(table, 'table-slide must reach agents');
    const field = table.schema.cornerCell;
    assert.ok(field, 'cornerCell must appear in the derived agent schema');
    assert.deepStrictEqual(field.options, ['label', 'header']);
    assert.ok(
      typeof field.description === 'string' && field.description.length > 0,
      'the agent needs help text to know what "header" does',
    );
  });
});
