import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderSlideHtml,
  stripEditorOnlyAttrs,
} from '../shared/slide-types/presentation.js';

/**
 * Editor-only inline-edit hooks (data-inline-field / -item / -item-index) are
 * dead weight in non-editable output artifacts. renderSlideHtml drops them when
 * ctx.stripEditorAttrs is set, but keeps data-morph-role (morph engine) and the
 * tf-* text-formatting classes (re-anchored CSS keeps them working).
 */

/** A collection type, so the data-inline-item hooks are present to strip. */
const slide = {
  id: 's',
  type: 'list-slide',
  content: {
    title: 'T',
    variant: 'bullets',
    items: [{ title: 'a' }, { title: 'b' }],
  },
};

/**
 * A text style needs a field whose type offers it (D220): `list-slide` offers
 * none, `content-slide.body` offers alignment and size.
 */
const alignedSlide = {
  id: 's2',
  type: 'content-slide',
  content: {
    title: 'T',
    body: 'Body text',
    textStyles: { body: { align: 'center', size: 'lg' } },
  },
};

test('editor render keeps inline-edit hooks', () => {
  const html = renderSlideHtml(slide, {});
  assert.match(html, /data-inline-field/);
  assert.match(html, /data-inline-item/);
});

test('output render strips inline-edit hooks but keeps morph roles', () => {
  const html = renderSlideHtml(slide, { stripEditorAttrs: true });
  assert.doesNotMatch(html, /data-inline-field/);
  assert.doesNotMatch(html, /data-inline-item/);
  assert.doesNotMatch(html, /data-inline-item-index/);
  // morph role survives
  assert.match(html, /data-morph-role="title"/);
});

test('output render keeps the tf-* classes (CSS is re-anchored off the attribute)', () => {
  const html = renderSlideHtml(alignedSlide, { stripEditorAttrs: true });
  assert.doesNotMatch(html, /data-inline-field/);
  assert.match(html, /tf-align-center/);
  assert.match(html, /tf-size-lg/);
});

test('stripEditorOnlyAttrs leaves data-morph-role and other attrs intact', () => {
  const input =
    '<p class="x" data-morph-role="body" data-inline-field="body" data-inline-item="items" data-inline-item-index="2" dir="auto">hi</p>';
  const out = stripEditorOnlyAttrs(input);
  assert.equal(out, '<p class="x" data-morph-role="body" dir="auto">hi</p>');
});
