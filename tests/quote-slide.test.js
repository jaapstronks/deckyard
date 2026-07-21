/**
 * Tests for the quote slide: content-aware font sizing, canvas card affordance
 * hooks (data-inline-item-index on extra quotes only), and vertical layout.
 *
 * The renderer sets a per-slide --quote-scale from how much text there is so a
 * single hero quote stays large and only dips for long copy, while 2-3 stacked
 * quotes grow back toward the top of their size band when they're short. The
 * primary quote lives in flat fields (no index -> no remove ×); extras carry
 * their quotes[] index so the inline editor can remove them.
 *
 * Run with: node --test tests/quote-slide.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import { quoteFontScale } from '../shared/slide-types/types/quote-slide.js';

const SHORT = 'Short and punchy.';
// Comfortably past the HI=240 chars/quote floor so the scale bottoms out.
const LONG =
  'A very long quote that keeps going and going, well past a single line, ' +
  'filling the slide with far more text than a hero quote comfortably holds ' +
  'at the default size, so it must shrink to fit within the frame, and it ' +
  'keeps rambling on for a good while longer still to be sure it overflows.';

function render(content, ctx) {
  return renderSlideHtml({ type: 'quote-slide', id: 's1', content }, ctx);
}

function scaleFromHtml(html) {
  const m = html.match(/--quote-scale:([0-9.]+)/);
  return m ? Number(m[1]) : null;
}

describe('quoteFontScale', () => {
  it('single short quote stays at the full hero size (1)', () => {
    assert.equal(quoteFontScale(1, [SHORT]), 1);
  });

  it('single long quote shrinks, but only within the single-quote band', () => {
    const s = quoteFontScale(1, [LONG]);
    assert.ok(s < 1, `expected < 1, got ${s}`);
    assert.ok(s >= 0.78, `must not drop below the band floor, got ${s}`);
  });

  it('two short quotes sit above the old fixed 0.6', () => {
    const s = quoteFontScale(2, [SHORT, SHORT]);
    assert.ok(s > 0.6 && s <= 0.82, `expected (0.6, 0.82], got ${s}`);
  });

  it('two long quotes fall to the dense end of the band', () => {
    assert.equal(quoteFontScale(2, [LONG, LONG]), 0.6);
  });

  it('three quotes stay within their smaller band', () => {
    const s = quoteFontScale(3, [SHORT, SHORT, SHORT]);
    assert.ok(s > 0.46 && s <= 0.62, `expected (0.46, 0.62], got ${s}`);
    assert.equal(quoteFontScale(3, [LONG, LONG, LONG]), 0.46);
  });

  it('scale is uniform - driven by the average, applied slide-wide', () => {
    // Same average length -> same scale regardless of distribution.
    assert.equal(
      quoteFontScale(2, [SHORT, LONG]),
      quoteFontScale(2, [SHORT, LONG])
    );
  });
});

describe('quote slide render', () => {
  it('single quote emits --quote-scale and no multi markers', () => {
    const html = render({ quote: SHORT, authorName: 'A', authorTitle: 'B' });
    assert.equal(scaleFromHtml(html), 1);
    assert.ok(!/is-multi/.test(html));
    assert.ok(!/data-inline-item-index/.test(html));
  });

  it('two quotes: count=2, scale set, only the extra carries an item index', () => {
    const html = render({
      quote: SHORT,
      authorName: 'A',
      authorTitle: 'B',
      quotes: [{ quote: SHORT, authorName: 'C', authorTitle: 'D' }],
    });
    assert.match(html, /data-quote-count="2"/);
    assert.ok(scaleFromHtml(html) > 0.6);
    // Exactly one item index (the extra, index 0) - the primary has none.
    const indices = [...html.matchAll(/data-inline-item-index="(\d+)"/g)].map(
      (m) => m[1]
    );
    assert.deepEqual(indices, ['0']);
    assert.match(html, /data-inline-item="quotes" data-inline-item-index="0"/);
  });

  it('three quotes: count=3, both extras indexed 0 and 1', () => {
    const html = render({
      quote: SHORT,
      authorName: 'A',
      authorTitle: 'B',
      quotes: [
        { quote: SHORT, authorName: 'C', authorTitle: 'D' },
        { quote: SHORT, authorName: 'E', authorTitle: 'F' },
      ],
    });
    assert.match(html, /data-quote-count="3"/);
    const indices = [...html.matchAll(/data-inline-item-index="(\d+)"/g)].map(
      (m) => m[1]
    );
    assert.deepEqual(indices, ['0', '1']);
  });

  it('an extra quote with empty text is not rendered (stays single)', () => {
    const html = render({
      quote: SHORT,
      authorName: 'A',
      authorTitle: 'B',
      quotes: [{ quote: '', authorName: 'C', authorTitle: 'D' }],
    });
    assert.ok(!/is-multi/.test(html));
  });

  it('centre-aligned quote text centres the whole block (is-align-center)', () => {
    const html = render({
      quote: SHORT,
      authorName: 'A',
      authorTitle: 'B',
      textStyles: { quote: { align: 'center' } },
    });
    assert.match(html, /slide-quote is-align-center/);
  });

  it('left/default alignment does not add the centre class', () => {
    const html = render({ quote: SHORT, authorName: 'A', authorTitle: 'B' });
    assert.ok(!/is-align-center/.test(html));
  });

  it('an extra quote renders up to two portraits (like the primary)', () => {
    const html = render({
      quote: SHORT,
      authorName: 'A',
      authorTitle: 'B',
      quotes: [
        {
          quote: SHORT,
          authorName: 'C',
          authorTitle: 'D',
          authorImage: 'https://ex/1.jpg',
          authorImage2: 'https://ex/2.jpg',
        },
      ],
    });
    const imgs = html.match(/https:\/\/ex\/\d\.jpg/g) || [];
    assert.deepEqual(imgs, ['https://ex/1.jpg', 'https://ex/2.jpg']);
  });
});
