/**
 * Tests for the icon-card-grid "tiles" layout markup.
 *
 * Tiles used to prefix each title with a number ("1. Insight"). The number
 * lived *inside* the inline-editable <h3>, so inline editing a tile title
 * picked the prefix up as part of the title text. Numbering was dropped, and
 * with it the only reason for the .icon-card-num span.
 *
 * Run with: node --test tests/icon-card-grid-tiles.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { renderSlideHtml } from '../shared/slide-types/presentation.js';

function render(content, ctx = {}) {
  return renderSlideHtml({ type: 'icon-card-grid-slide', content }, ctx);
}

const items = (n) =>
  Array.from({ length: n }, (_, i) => ({
    icon: 'target',
    title: `Card ${i + 1}`,
    body: `Body ${i + 1}.`,
  }));

describe('icon-card-grid tiles layout', () => {
  it('renders no number prefix in either layout', () => {
    for (const layout of ['tiles', 'cards']) {
      const html = render({ title: 'Deck', layout, items: items(4) });
      assert.doesNotMatch(html, /icon-card-num/, `${layout} still emits a number span`);
    }
  });

  it('keeps the title element free of anything but the title text', () => {
    const html = render({ title: 'Deck', layout: 'tiles', items: items(3) });
    const titles = [...html.matchAll(/<h3 class="icon-card-title"[^>]*>([\s\S]*?)<\/h3>/g)].map(
      (m) => m[1].trim()
    );
    assert.deepEqual(titles.slice(0, 3), ['Card 1', 'Card 2', 'Card 3']);
  });

  it('renders the body text for tiles (it is shown under the title)', () => {
    const html = render({ title: 'Deck', layout: 'tiles', items: items(2) });
    assert.match(html, /Body 1\./);
    assert.match(html, /Body 2\./);
  });

  it('tags the grid with the layout and card count the CSS sizes tiles from', () => {
    const html = render({ title: 'Deck', layout: 'tiles', items: items(5) });
    assert.match(html, /class="icon-card-grid" data-layout="tiles" data-card-count="5"/);
  });
});
