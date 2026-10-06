import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import { imageFieldKeysForType } from '../server/utils/html-utils.js';

/**
 * Quote slide: one to three quotes, every one of them in `quotes[]` (D314).
 * One quote is the hero layout; two or three stack with alternating
 * alignment. Each quote carries its own byline and up to two portraits,
 * spelled `authorImage{n}` on every quote.
 */

const def = SLIDE_TYPES['quote-slide'];
const render = (quotes, id = 's1') => def.renderHtml({ quotes }, { id });

test('single quote: hero layout, no multi wrapper, morph roles present', () => {
  const html = render([
    { quote: 'A strong quote', authorName: 'Riley', authorTitle: 'CEO' },
  ]);
  assert.ok(!html.includes('is-multi'), 'no multi class for a single quote');
  assert.ok(!html.includes('quote-item'), 'no quote-item wrappers');
  assert.match(html, /data-morph-role="quote-text"/);
  assert.match(html, /data-morph-role="quote-author"/);
  assert.match(html, /data-inline-field="quotes\.0\.quote"/);
  assert.match(html, /data-inline-field="quotes\.0\.authorName"/);
  assert.match(html, /data-inline-field="quotes\.0\.authorTitle"/);
});

test('single quote: HTML in the quote text is escaped', () => {
  const html = render([
    { quote: 'x <b>bold</b> & y', authorName: 'A', authorTitle: 'T' },
  ]);
  assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt;'), 'tags escaped');
  assert.ok(!html.includes('<b>bold</b>'), 'no raw markup leaks');
});

test('a duo keeps both portraits, each on its own photo index', () => {
  const html = render([
    {
      quote: 'Q',
      authorName: 'A',
      authorTitle: 'T',
      authorImage1: '/uploads/a.jpg',
      authorImage2: '/uploads/b.jpg',
    },
  ]);
  assert.ok(!html.includes('is-multi'), 'still a single quote');
  const portraitItems = html.match(/class="quote-portrait"/g) || [];
  assert.equal(portraitItems.length, 2, 'both portraits rendered');
  assert.match(html, /data-inline-photo="0"/);
  assert.match(html, /data-inline-photo="1"/);
});

test('multi quote: three quotes -> is-multi, count 3, every one an item', () => {
  const html = render([
    { quote: 'Q1', authorName: 'A1', authorTitle: 'T1' },
    { quote: 'Q2', authorName: 'A2', authorTitle: 'T2' },
    { quote: 'Q3', authorName: 'A3', authorImage1: '/uploads/c.jpg' },
  ]);
  assert.match(html, /class="slide slide-quote is-multi"/);
  assert.match(html, /data-quote-count="3"/);
  assert.equal((html.match(/class="quote-item"/g) || []).length, 3);
  for (const i of [0, 1, 2])
    assert.match(html, new RegExp(`data-inline-item-index="${i}"`));
  assert.match(html, /data-inline-field="quotes\.2\.authorName"/);
  // Multi mode drops per-slide morph roles (they must stay unique per slide).
  assert.ok(!html.includes('data-morph-role'), 'no morph roles in multi mode');
  // Quote 3's first portrait is photo 4: item-major, two slots per quote.
  assert.match(html, /<div class="quote-portrait" data-inline-photo="4">/);
});

test('later quotes without text are not shown; the first always is', () => {
  const html = render([
    { quote: 'Q', authorName: 'A', authorTitle: 'T' },
    { quote: '   ' },
    { authorName: 'orphan' },
  ]);
  assert.ok(!html.includes('is-multi'), 'blank quotes do not trigger multi');
  const empty = render([{ quote: '' }, { quote: 'Second' }]);
  assert.match(empty, /data-quote-count="2"/);
});

test('at most three quotes render', () => {
  const html = render([
    { quote: 'Q1' },
    { quote: 'Q2' },
    { quote: 'Q3' },
    { quote: 'Q4' },
  ]);
  assert.match(html, /data-quote-count="3"/);
  assert.ok(!html.includes('Q4'), 'the fourth is capped out');
});

test('schema: one quotes list of one to three, one portrait spelling', () => {
  const keys = def.fields.map((f) => f.key);
  for (const flat of ['quote', 'authorName', 'authorTitle', 'authorImage1'])
    assert.ok(
      !keys.includes(flat),
      `${flat} is an item field, not the slide's`,
    );
  const quotesField = def.fields.find((f) => f.key === 'quotes');
  assert.equal(quotesField.type, 'items');
  assert.equal(quotesField.minItems, 1);
  assert.equal(quotesField.maxItems, 3);
  assert.deepEqual(
    quotesField.itemFields.filter((f) => f.type === 'image').map((f) => f.key),
    ['authorImage1', 'authorImage2'],
  );
  assert.ok(!imageFieldKeysForType('quote-slide').includes('authorImage1'));
});
