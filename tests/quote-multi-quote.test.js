import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types/index.js';
import { imageFieldKeysForType } from '../server/utils/html-utils.js';

/**
 * Quote slide: up to 3 quotes (1 primary + 2 extras) with alternating
 * alignment. The primary quote stays in the flat top-level fields so existing
 * single-quote decks (incl. duos with two portraits) render unchanged; extra
 * quotes live in a `quotes[]` items array.
 */

const def = SLIDE_TYPES['quote-slide'];

test('single quote: hero layout, no multi wrapper, morph roles present', () => {
  const html = def.renderHtml(
    { quote: 'A strong quote', authorName: 'Riley', authorTitle: 'CEO' },
    { id: 's1' }
  );
  assert.ok(!html.includes('is-multi'), 'no multi class for a single quote');
  assert.ok(!html.includes('quote-item'), 'no quote-item wrappers');
  assert.match(html, /data-morph-role="quote-text"/);
  assert.match(html, /data-morph-role="quote-author"/);
  assert.match(html, /data-inline-field="quote"/);
  assert.match(html, /data-inline-field="authorName"/);
  assert.match(html, /data-inline-field="authorTitle"/);
});

test('single quote: HTML in the quote text is escaped', () => {
  const html = def.renderHtml(
    { quote: 'x <b>bold</b> & y', authorName: 'A', authorTitle: 'T' },
    { id: 's1' }
  );
  assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt;'), 'tags escaped');
  assert.ok(!html.includes('<b>bold</b>'), 'no raw markup leaks');
});

test('backward compat: legacy duo keeps both portraits in the single layout', () => {
  const html = def.renderHtml(
    {
      quote: 'Q',
      authorName: 'A',
      authorTitle: 'T',
      authorImage1: '/uploads/a.jpg',
      authorImage2: '/uploads/b.jpg',
    },
    { id: 's2' }
  );
  assert.ok(!html.includes('is-multi'), 'still a single quote');
  const portraitItems = html.match(/class="quote-portrait"/g) || [];
  assert.equal(portraitItems.length, 2, 'both portraits rendered');
  assert.match(html, /data-inline-photo="1"/);
  assert.match(html, /data-inline-photo="2"/);
});

test('multi quote: primary + 2 extras -> is-multi, count 3, alternating items', () => {
  const html = def.renderHtml(
    {
      quote: 'Q1',
      authorName: 'A1',
      authorTitle: 'T1',
      quotes: [
        { quote: 'Q2', authorName: 'A2', authorTitle: 'T2' },
        { quote: 'Q3', authorName: 'A3', authorImage: '/uploads/c.jpg' },
      ],
    },
    { id: 's3' }
  );
  assert.match(html, /class="slide slide-quote is-multi"/);
  assert.match(html, /data-quote-count="3"/);
  assert.equal((html.match(/class="quote-item"/g) || []).length, 3);
  // Extra quotes wire dotted field paths for inline text editing.
  assert.match(html, /data-inline-field="quotes\.0\.quote"/);
  assert.match(html, /data-inline-field="quotes\.1\.quote"/);
  assert.match(html, /data-inline-field="quotes\.1\.authorName"/);
  // Multi mode drops per-slide morph roles (they must stay unique per slide).
  assert.ok(!html.includes('data-morph-role'), 'no morph roles in multi mode');
  // The extra portrait has no inline-photo slot (edited via the side form).
  assert.ok(!/data-inline-photo/.test(html.split('quotes.1.quote')[1] || ''),
    'extra portrait carries no inline-photo slot');
});

test('multi quote: exactly one extra -> count 2', () => {
  const html = def.renderHtml(
    { quote: 'Q1', authorName: 'A1', authorTitle: 'T1', quotes: [{ quote: 'Q2' }] },
    { id: 's3' }
  );
  assert.match(html, /data-quote-count="2"/);
  assert.equal((html.match(/class="quote-item"/g) || []).length, 2);
});

test('extra quotes without text are ignored (no multi layout)', () => {
  const html = def.renderHtml(
    {
      quote: 'Q',
      authorName: 'A',
      authorTitle: 'T',
      quotes: [{ quote: '   ' }, { authorName: 'orphan' }],
    },
    { id: 's4' }
  );
  assert.ok(!html.includes('is-multi'), 'blank extra quotes do not trigger multi');
});

test('only the first two extras render (max 3 total)', () => {
  const html = def.renderHtml(
    {
      quote: 'Q1',
      authorName: 'A1',
      authorTitle: 'T1',
      quotes: [{ quote: 'Q2' }, { quote: 'Q3' }, { quote: 'Q4' }],
    },
    { id: 's5' }
  );
  assert.match(html, /data-quote-count="3"/);
  assert.ok(html.includes('Q2') && html.includes('Q3'), 'first two extras render');
  assert.ok(!html.includes('Q4'), 'third extra is capped out');
});

test('schema exposes the quotes items field with an image subfield', () => {
  const quotesField = def.fields.find((f) => f.key === 'quotes');
  assert.equal(quotesField.type, 'items');
  assert.equal(quotesField.maxItems, 2);
  const imageSub = quotesField.itemFields.find((f) => f.key === 'authorImage');
  assert.equal(imageSub.type, 'image');
  // Primary portraits are still top-level image fields (export embeds them).
  const topLevelImages = imageFieldKeysForType('quote-slide');
  assert.ok(topLevelImages.includes('authorImage1'));
  assert.ok(topLevelImages.includes('authorImage2'));
});
