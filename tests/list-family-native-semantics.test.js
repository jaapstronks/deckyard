import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSlideHtml } from '../shared/slide-types/presentation.js';

/**
 * The list-family slides used role="list" on <div>s (ARIA reimplementing a
 * native control). They now emit native <ul>/<ol> + <li>. Guards that no
 * role="list"/"listitem" survives and that <li>s sit directly in a list.
 */

function render(type, content) {
  return renderSlideHtml({ id: 's', type, content }, {});
}

const CASES = [
  ['funnel-slide', { title: 'F', items: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] }, 'ol'],
  ['pyramid-slide', { title: 'P', levels: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] }, 'ol'],
  ['cycle-slide', { title: 'C', items: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] }, 'ol'],
];

for (const [type, content, tag] of CASES) {
  test(`${type} emits native <${tag}> with <li> items, no ARIA list roles`, () => {
    const html = render(type, content);
    assert.doesNotMatch(html, /role="list"/, 'no role="list"');
    assert.doesNotMatch(html, /role="listitem"/, 'no role="listitem"');
    assert.match(html, new RegExp(`<${tag}[ >]`), `has <${tag}>`);
    assert.equal((html.match(/<li[ >]/g) || []).length, 3, 'three <li> items');
  });
}

test('list-slide numbered variant renders <ol>', () => {
  const html = render('list-slide', {
    title: 'L',
    variant: 'numbers',
    items: [{ title: 'a' }, { title: 'b' }],
  });
  assert.doesNotMatch(html, /role="list(item)?"/);
  assert.match(html, /<ol class="lijst"/);
  assert.equal((html.match(/<li[ >]/g) || []).length, 2);
});

test('lijstje bullet variant renders <ul>', () => {
  const html = render('lijstje-slide', {
    title: 'LJ',
    variant: 'bullets',
    items: [{ title: 'a' }, { title: 'b' }],
  });
  assert.doesNotMatch(html, /role="list(item)?"/);
  assert.match(html, /<ul class="lijst"/);
});

test('two-column list wraps each column in its own <ul>/<ol> with direct <li> children', () => {
  // 8 items forces the two-column layout (> one-column cap).
  const items = Array.from({ length: 8 }, (_, i) => ({ title: `t${i}`, text: `x${i}` }));
  const html = render('list-slide', { title: 'L', variant: 'numbers', layout: 'two-column', items });
  // .lijst is a plain container, each .lijst-col is a native list
  assert.match(html, /<div class="lijst">/);
  assert.equal((html.match(/<ol class="lijst-col">/g) || []).length, 2);
  // every <li> sits directly inside a list element (no stray listitem role)
  assert.doesNotMatch(html, /role="list(item)?"/);
  assert.equal((html.match(/<li[ >]/g) || []).length, 8);
});
