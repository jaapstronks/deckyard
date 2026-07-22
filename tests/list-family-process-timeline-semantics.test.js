import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSlideHtml } from '../shared/slide-types/presentation.js';

/**
 * process-slide and timeline-slide used role="list" on <div>s. They now emit
 * native <ol> + <li>. Their decorative interleaved elements (process arrows,
 * the timeline track) become aria-hidden <li>s so the <ol> stays valid
 * (only <li> children) while AT still announces just the real items.
 */

function render(type, content) {
  return renderSlideHtml({ id: 's', type, content }, {});
}

test('process-slide emits <ol>; arrows are aria-hidden <li>s, no ARIA list roles', () => {
  const html = render('process-slide', {
    title: 'P',
    items: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
  });
  assert.doesNotMatch(html, /role="list(item)?"/);
  assert.match(html, /<ol class="process-container"/);
  assert.match(html, /<li class="process-step"/);
  assert.match(html, /<li class="process-arrow" aria-hidden="true"><\/li>/);
});

test('timeline-slide emits <ol>; the track is an aria-hidden <li>, no ARIA list roles', () => {
  const html = render('timeline-slide', {
    items: [
      { title: 'a', date: '2020' },
      { title: 'b', date: '2021' },
      { title: 'c', date: '2022' },
    ],
  });
  assert.doesNotMatch(html, /role="list(item)?"/);
  assert.match(html, /<ol class="timeline-container"/);
  assert.match(html, /<li class="timeline-track" aria-hidden="true"><\/li>/);
  // three real items
  assert.equal((html.match(/<li class="timeline-item/g) || []).length, 3);
});
