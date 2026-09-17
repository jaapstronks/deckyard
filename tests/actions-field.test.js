/**
 * An action's `url` is a `url` field (D131): a web link opens in a new tab
 * wherever the slide renders, a slide jump is a live link only where someone
 * listens (the presenter's delegated `data-card-nav*` handler), and elsewhere
 * the button stays as content, a placeholder link without `href`, the way a
 * card outside `present` mode draws no overlay. A value the validator refuses
 * (a bare domain) is no action at all: nothing is repaired.
 *
 * Run with: node --test tests/actions-field.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderActionsHtml } from '../shared/slide-types/actions-field.js';

const anchors = (html) => html.match(/<a\b[^>]*>[^<]*<\/a>/g) || [];
const attrs = (a) => a.replace(/\s+/g, ' ').trim();

test('a slide jump is a live link in present mode only', () => {
  const actions = [
    { label: 'Start', url: '#slide:abc', style: 'primary' },
    { label: 'Third', url: '#3' },
  ];
  const present = anchors(renderActionsHtml(actions, 'present')).map(attrs);
  assert.equal(present.length, 2);
  assert.match(present[0], /href="#" data-card-nav-id="abc"/);
  assert.match(present[1], /href="#" data-card-nav="3"/);

  for (const mode of ['thumb', 'edit', undefined]) {
    const out = anchors(renderActionsHtml(actions, mode)).map(attrs);
    assert.equal(out.length, 2, `mode ${mode}: the buttons stay`);
    for (const a of out) {
      assert.doesNotMatch(a, /href=/, `mode ${mode}: no dead href`);
      assert.doesNotMatch(a, /data-card-nav/, `mode ${mode}: no nav attr`);
      assert.match(a, /class="slide-action /);
    }
  }
});

test('a web link opens in a new tab in every mode', () => {
  for (const mode of ['present', 'thumb', undefined]) {
    const [a] = anchors(
      renderActionsHtml([{ label: 'Site', url: 'https://example.com' }], mode),
    ).map(attrs);
    assert.match(
      a,
      /href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer"/,
    );
  }
});

test('a bare domain or an empty label is no action; nothing is repaired', () => {
  const out = renderActionsHtml(
    [
      { label: 'Bare', url: 'example.com' },
      { label: 'Phone', url: 'tel:+31600000000' },
      { label: '', url: 'https://example.com' },
      { label: 'Kept', url: 'https://example.com' },
    ],
    'present',
  );
  const out2 = anchors(out).map(attrs);
  assert.equal(out2.length, 1);
  assert.match(out2[0], /Kept/);
  assert.doesNotMatch(out, /https:\/\/example\.com\/?"[^>]*>Bare/);
});
