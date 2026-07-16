import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types/index.js';

/**
 * Empty-slot media affordances (editor-UI track, phase 1c): empty image slots
 * must be clickable in the editor canvas so a FIRST image can be added from
 * the slide, without leaking editor placeholders into present/export renders.
 */

test('content-columns: empty column renders a clickable placeholder in edit mode only', () => {
  const def = SLIDE_TYPES['content-columns-slide'];
  const content = { title: 'T', columnCount: 2 };

  const editHtml = def.renderHtml(content, {}, { mode: 'edit' });
  const editPlaceholders = editHtml.match(/cc-image-placeholder/g) || [];
  assert.ok(editPlaceholders.length >= 2, 'each empty column gets a placeholder in edit mode');
  assert.match(editHtml, /cc-image-placeholder[^>]*data-inline-photo="1"/s);

  for (const ctx of [undefined, {}, { mode: 'present' }, { mode: 'thumb' }]) {
    const html = def.renderHtml(content, {}, ctx);
    assert.ok(!html.includes('cc-image-placeholder'), `no placeholder in mode ${ctx?.mode}`);
  }
});

test('content-columns: a filled column renders the image, not the placeholder', () => {
  const def = SLIDE_TYPES['content-columns-slide'];
  const content = { title: 'T', columnCount: 2, col1Image: '/x.png', col1Alt: 'x' };
  const html = def.renderHtml(content, {}, { mode: 'edit' });
  assert.match(html, /<img src="\/x\.png"/);
  // column 1 filled: its cc-image is not a placeholder; column 2 still empty
  assert.ok(!/cc-image-placeholder[^>]*data-inline-photo="1"/s.test(html));
  assert.match(html, /cc-image-placeholder[^>]*data-inline-photo="2"/s);
});

test('image-text: empty placeholder and filled image both carry data-inline-photo', () => {
  const def = SLIDE_TYPES['image-text-slide'];

  const empty = def.renderHtml({ title: 'T', body: 'b' });
  assert.match(empty, /image-placeholder is-empty[^>]*data-inline-photo="0"/s);

  const filled = def.renderHtml({ title: 'T', body: 'b', image: '/y.png', alt: 'y' });
  assert.match(filled, /<img[^>]*data-inline-photo="0"/s);
  assert.ok(!filled.includes('image-placeholder'));
});
