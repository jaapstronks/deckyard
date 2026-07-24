/**
 * Tests for the card-stack-slide migration from flat numbered fields
 * (card1Title / card1Label / card1Body + cardCount) to the canonical items[]
 * model. Covers the dual-read renderer, the semantic projection via the real
 * def (no longer via the repeatingGroups bridge), the schema-version fold, and
 * the card-stack <-> icon-card-grid conversions.
 *
 * Run with: node --test tests/card-stack-migration.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { initSanitizer } from '../shared/sanitize.js';
await initSanitizer();

import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import {
  resolveCardStack,
  resolveCardStackItems,
} from '../shared/slide-types/types/card-stack-slide.js';
import { migratePresentation, CURRENT_SCHEMA_VERSION } from '../shared/slide-types/schema-version.js';
import { convertSlideToType } from '../shared/slide-types/convert.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { renderSlideBodySemanticHtml } from '../shared/slide-types/semantic-projection.js';

const render = (content, ctx = {}) => renderSlideHtml({ type: 'card-stack-slide', content }, ctx);

describe('card-stack renderer: items[] vs legacy numbered', () => {
  it('prefers items[] and emits items.N.* inline paths', () => {
    const html = render({
      title: 'Deck',
      cardCount: '4', // stale mirror — items[] wins
      items: [
        { title: 'Alpha', body: '- one' },
        { title: 'Beta', body: '- two' },
      ],
    });
    assert.ok(/data-card-count="2"/.test(html), html);
    assert.ok(/data-inline-field="items\.0\.title"/.test(html), html);
    assert.ok(/data-inline-field="items\.1\.body"/.test(html), html);
    assert.ok(/Alpha/.test(html) && /Beta/.test(html), html);
    // No numbered inline paths when items[] is the source.
    assert.ok(!/data-inline-field="card1Title"/.test(html), html);
  });

  it('ignores trailing blank items[] entries', () => {
    const html = render({
      title: 'Deck',
      items: [{ title: 'Alpha', body: 'a' }, {}, {}],
    });
    assert.ok(/data-card-count="1"/.test(html), html);
  });

  it('falls back to legacy numbered fields (Title, then deprecated Label)', () => {
    const html = render({
      title: 'Deck',
      cardCount: '2',
      card1Title: 'FromTitle',
      card2Label: 'FromLabel',
      card2Body: 'b',
    });
    assert.ok(/data-card-count="2"/.test(html), html);
    assert.ok(/FromTitle/.test(html) && /FromLabel/.test(html), html);
    // Legacy source → numbered inline paths.
    assert.ok(/data-inline-field="card1Title"/.test(html), html);
  });
});

describe('card-stack resolvers', () => {
  it('resolveCardStackItems folds numbered fields, bounded by cardCount', () => {
    const items = resolveCardStackItems({
      cardCount: '2',
      card1Title: 'One',
      card1Body: 'a',
      card2Title: 'Two',
      card2Body: 'b',
      card3Title: 'LEAK', // beyond cardCount → dropped
    });
    assert.deepEqual(items, [
      { title: 'One', body: 'a' },
      { title: 'Two', body: 'b' },
    ]);
  });

  it('resolveCardStack counts items[] by filled length, not stale cardCount', () => {
    const { useItems, count } = resolveCardStack({
      cardCount: '5',
      items: [{ title: 'a', body: '' }, { title: 'b', body: '' }],
    });
    assert.equal(useItems, true);
    assert.equal(count, 2);
  });
});

describe('card-stack semantic projection (real def, items[])', () => {
  const def = SLIDE_TYPES['card-stack-slide'];

  it('projects items[] as an unordered list of grouped cards', () => {
    const html = renderSlideBodySemanticHtml(
      { content: { title: 'T', items: [{ title: 'One', body: 'first' }, { title: 'Two', body: 'second' }] } },
      def,
      { headingKey: 'title', headingText: 'T' }
    );
    assert.ok(/<ul class="reader-items">/.test(html), html);
    assert.ok(/<li class="reader-item"><h3>One<\/h3>/.test(html), html);
    assert.ok(/first/.test(html) && /second/.test(html), html);
  });

  it('does not double-project the hidden numbered mirror', () => {
    const html = renderSlideBodySemanticHtml(
      {
        content: {
          title: 'T',
          items: [{ title: 'One', body: 'first' }],
          card1Title: 'One',
          card1Body: 'first',
          cardCount: '1',
        },
      },
      def,
      { headingKey: 'title', headingText: 'T' }
    );
    // "One" appears once (in the projected item), not again from the numbered mirror.
    assert.equal((html.match(/<h3>One<\/h3>/g) || []).length, 1, html);
  });

  it('the def no longer declares the repeatingGroups bridge', () => {
    assert.ok(!def.repeatingGroups, 'card-stack should not declare repeatingGroups');
  });
});

describe('schema-version v2 -> v3: card-stack fold', () => {
  it('folds legacy numbered fields into items[] non-destructively', () => {
    const deck = {
      id: 'd1',
      schemaVersion: 2,
      title: 'CS',
      slides: [
        {
          id: 's1',
          type: 'card-stack-slide',
          content: {
            title: 'Stack',
            cardCount: '2',
            card1Title: 'A',
            card1Body: 'aa',
            card2Label: 'B', // deprecated label mirror
            card2Body: 'bb',
          },
        },
      ],
    };
    const migrated = migratePresentation(deck);
    const c = migrated.slides[0].content;
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(c.items, [
      { title: 'A', body: 'aa' },
      { title: 'B', body: 'bb' },
    ]);
    // Legacy keys survive (non-destructive fold).
    assert.equal(c.card1Title, 'A');
  });

  it('leaves a card-stack that already has items[] untouched', () => {
    const items = [{ title: 'X', body: 'x' }];
    const deck = {
      id: 'd2',
      schemaVersion: 2,
      title: 'CS',
      slides: [{ id: 's1', type: 'card-stack-slide', content: { title: 'T', items } }],
    };
    const migrated = migratePresentation(deck);
    assert.deepEqual(migrated.slides[0].content.items, items);
  });
});

describe('card-stack <-> icon-card-grid conversion writes items[]', () => {
  it('card-stack -> icon-card-grid carries cards into items[]', () => {
    const slide = {
      type: 'card-stack-slide',
      content: { title: 'T', items: [{ title: 'A', body: 'aa' }, { title: 'B', body: 'bb' }] },
    };
    const out = convertSlideToType(slide, 'icon-card-grid-slide');
    assert.equal(out.type, 'icon-card-grid-slide');
    assert.equal(out.content.items.length, 2);
    assert.equal(out.content.items[0].title, 'A');
    assert.equal(out.content.items[1].body, 'bb');
  });

  it('icon-card-grid -> card-stack carries cards into items[]', () => {
    const slide = {
      type: 'icon-card-grid-slide',
      content: { title: 'T', items: [{ icon: 'x', title: 'A', body: 'aa' }] },
    };
    const out = convertSlideToType(slide, 'card-stack-slide');
    assert.equal(out.type, 'card-stack-slide');
    assert.deepEqual(out.content.items, [{ title: 'A', body: 'aa' }]);
    // The converted content renders A, not the card-stack default placeholder.
    const html = renderSlideHtml(out, {});
    assert.ok(/>\s*A\s*</.test(html), html);
    assert.ok(!/What we're building/.test(html), html);
  });
});
