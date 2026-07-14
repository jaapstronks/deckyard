/**
 * Tests for list-slide layout + text-size (density) resolution.
 *
 * The renderer must guarantee text never spills off the slide: one column is
 * used only while the items fit at the chosen text size, otherwise it falls
 * back to two columns (which ~doubles capacity). An explicit 'two-column' is
 * always honored; a very long list drops 'large' -> normal so even two columns
 * fit. Per-size one-column caps: large 3, normal 4, compact 5.
 *
 * 'auto' prefers large: short lists (≤6 items, no long sentences per bullet)
 * upgrade to 'comfortable'; long/wordy lists keep the default fit.
 *
 * Run with: node --test tests/list-slide-layout.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { renderSlideHtml } from '../shared/slide-types/presentation.js';

function render({ n, density, layout, text = 'Short line' } = {}) {
  const items = Array.from({ length: n }, (_, i) => ({
    title: `Item ${i + 1}`,
    text,
  }));
  return renderSlideHtml({
    type: 'list-slide',
    content: { title: 'List', variant: 'numbers', density, layout, items },
  });
}

// Long enough to keep 'auto' at the default sizing (no large upgrade).
const LONG_TEXT =
  'A full sentence of real body copy that keeps going for quite a while, well past the upgrade cutoff.';

const isTwoCol = (html) => /\bis-two-col\b/.test(html) && !/\bis-one-col\b/.test(html);
const isOneCol = (html) => /\bis-one-col\b/.test(html) && !/\bis-two-col\b/.test(html);

describe('list-slide layout resolution', () => {
  it('large: one column up to the cap (3), two columns beyond', () => {
    assert.ok(isOneCol(render({ n: 3, density: 'comfortable', layout: 'auto' })));
    assert.ok(isTwoCol(render({ n: 4, density: 'comfortable', layout: 'auto' })));
  });

  it('auto with short items upgrades to large (cap 3, two columns beyond)', () => {
    const three = render({ n: 3, density: 'auto', layout: 'auto' });
    assert.ok(/\bis-comfortable\b/.test(three), 'short auto lists render large');
    assert.ok(isOneCol(three));
    const four = render({ n: 4, density: 'auto', layout: 'auto' });
    assert.ok(/\bis-comfortable\b/.test(four));
    assert.ok(isTwoCol(four));
  });

  it('auto with wordy items keeps the default sizing (cap 4)', () => {
    const four = render({ n: 4, density: 'auto', layout: 'auto', text: LONG_TEXT });
    assert.ok(!/\bis-comfortable\b/.test(four), 'long sentences stay default size');
    assert.ok(isOneCol(four));
    assert.ok(isTwoCol(render({ n: 5, density: 'auto', layout: 'auto', text: LONG_TEXT })));
  });

  it('auto with many items (>6) keeps the default sizing', () => {
    const seven = render({ n: 7, density: 'auto', layout: 'auto' });
    assert.ok(!/\bis-comfortable\b/.test(seven));
    assert.ok(isTwoCol(seven));
  });

  it('compact: one column up to the cap (5), two columns beyond', () => {
    assert.ok(isOneCol(render({ n: 5, density: 'compact', layout: 'auto' })));
    assert.ok(isTwoCol(render({ n: 6, density: 'compact', layout: 'auto' })));
  });

  it('explicit two-column is always honored, even with few items', () => {
    assert.ok(isTwoCol(render({ n: 2, density: 'auto', layout: 'two-column' })));
  });

  it('explicit one-column falls back to two columns when it would overflow', () => {
    assert.ok(isOneCol(render({ n: 3, density: 'auto', layout: 'one-column' })));
    assert.ok(isTwoCol(render({ n: 5, density: 'auto', layout: 'one-column' })));
  });

  it('legacy/unset layout is protected too (no overflow)', () => {
    assert.ok(isOneCol(render({ n: 4, density: 'auto', layout: undefined, text: LONG_TEXT })));
    assert.ok(isTwoCol(render({ n: 5, density: 'auto', layout: undefined })));
  });

  it('very long large lists drop to normal size so two columns fit', () => {
    const html = render({ n: 7, density: 'comfortable', layout: 'auto' });
    assert.ok(isTwoCol(html), 'should be two columns');
    assert.ok(!/\bis-comfortable\b/.test(html), 'large should step down past 6 items');
  });

  it('large is kept for lists within its range', () => {
    assert.ok(/\bis-comfortable\b/.test(render({ n: 6, density: 'comfortable', layout: 'auto' })));
  });
});
