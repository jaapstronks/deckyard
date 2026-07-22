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

const slide = {
  id: 's',
  type: 'lijstje-slide',
  content: {
    title: 'T',
    variant: 'bullets',
    items: [{ title: 'a' }, { title: 'b' }],
    textStyles: { title: { align: 'center', color: 'accent' } },
  },
};

test('editor render keeps inline-edit hooks', () => {
  const html = renderSlideHtml(slide, {});
  assert.match(html, /data-inline-field/);
  assert.match(html, /data-inline-item/);
});

test('output render strips inline-edit hooks but keeps morph + tf-* classes', () => {
  const html = renderSlideHtml(slide, { stripEditorAttrs: true });
  assert.doesNotMatch(html, /data-inline-field/);
  assert.doesNotMatch(html, /data-inline-item/);
  assert.doesNotMatch(html, /data-inline-item-index/);
  // morph role survives
  assert.match(html, /data-morph-role="title"/);
  // user text formatting survives (CSS is re-anchored off the attribute)
  assert.match(html, /class="heading tf-align-center tf-color-accent"/);
});

test('stripEditorOnlyAttrs leaves data-morph-role and other attrs intact', () => {
  const input =
    '<p class="x" data-morph-role="body" data-inline-field="body" data-inline-item="items" data-inline-item-index="2" dir="auto">hi</p>';
  const out = stripEditorOnlyAttrs(input);
  assert.equal(
    out,
    '<p class="x" data-morph-role="body" dir="auto">hi</p>',
  );
});
