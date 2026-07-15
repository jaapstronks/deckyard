/**
 * Tests for how icon-card-grid-slide renders its icons.
 *
 * The icon is a CSS mask tinted by the container `color` (theme token
 * --t-icon-card-grid-icon-fg), NOT an <img>. An <img>-loaded SVG is an
 * isolated document that ignores the host `color`, so its `currentColor`
 * followed the OS color scheme (black in light mode, white in dark) instead
 * of the theme. Rendering as a mask keeps the icon color deterministic.
 *
 * Run with: node --test tests/icon-card-grid-icon-render.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { renderSlideHtml } from '../shared/slide-types/presentation.js';

function render(cards, ctx = {}) {
  return renderSlideHtml(
    {
      type: 'icon-card-grid-slide',
      content: {
        title: 'Deck',
        cardCount: String(cards.length),
        items: cards,
      },
    },
    ctx
  );
}

describe('icon-card-grid icon rendering', () => {
  it('renders the icon as a mask span carrying the Lucide SVG url', () => {
    const html = render([{ icon: 'lightbulb', title: 'Insight', body: 'x' }], { mode: 'present' });
    assert.match(html, /<span class="icon-card-icon-img"/);
    assert.match(html, /--icg-icon-url:url\(\/client\/vendor\/lucide-icons\/lightbulb\.svg\)/);
  });

  it('does not render the icon as an <img> anymore', () => {
    const html = render([{ icon: 'target', title: 'Focus', body: 'x' }], { mode: 'present' });
    assert.doesNotMatch(html, /<img[^>]*class="icon-card-icon-img"/);
  });

  it('falls back to the placeholder div when no icon is set', () => {
    const html = render([{ title: 'No icon', body: 'x' }], { mode: 'present' });
    assert.match(html, /class="icon-card-icon-fallback"/);
    assert.doesNotMatch(html, /icon-card-icon-img/);
  });
});
