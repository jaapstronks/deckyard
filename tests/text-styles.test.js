/**
 * Per-field text styling (editing-surfaces text phase, step 3): normalize +
 * prune, class mapping, and the render post-pass that injects tf-* classes
 * into the matching data-inline-field element.
 *
 * Run with: node --test tests/text-styles.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTextStyles,
  textStyleClasses,
  injectTextStyles,
} from '../shared/slide-types/text-styles.js';

describe('normalizeTextStyles', () => {
  it('keeps known non-default values', () => {
    assert.deepEqual(
      normalizeTextStyles({ body: { align: 'center', color: 'accent' } }),
      { body: { align: 'center', color: 'accent' } }
    );
  });

  it('keeps a non-default size', () => {
    assert.deepEqual(normalizeTextStyles({ body: { size: 'lg' } }), { body: { size: 'lg' } });
    assert.deepEqual(normalizeTextStyles({ body: { size: 'sm' } }), { body: { size: 'sm' } });
  });

  it('prunes defaults and empty results (no no-op overrides stored)', () => {
    assert.deepEqual(normalizeTextStyles({ body: { align: 'left', color: 'default' } }), {});
    assert.deepEqual(normalizeTextStyles({ body: { size: 'md' } }), {});
    assert.deepEqual(
      normalizeTextStyles({ body: { align: 'left', color: 'default', size: 'md' } }),
      {}
    );
    assert.deepEqual(normalizeTextStyles({ title: {} }), {});
  });

  it('drops unknown keys, values and non-objects', () => {
    assert.deepEqual(normalizeTextStyles({ body: { align: 'justify' } }), {});
    assert.deepEqual(normalizeTextStyles({ body: { color: 'rebeccapurple' } }), {});
    // 'inverse' was removed from the vocabulary; it now prunes like any unknown value.
    assert.deepEqual(normalizeTextStyles({ body: { color: 'inverse' } }), {});
    assert.deepEqual(normalizeTextStyles({ body: { size: 'xl' } }), {});
    assert.deepEqual(normalizeTextStyles({ body: 'center' }), {});
    assert.deepEqual(normalizeTextStyles(null), {});
    assert.deepEqual(normalizeTextStyles('x'), {});
  });

  it('keeps theme brand swatch colours (brand-1/2/3)', () => {
    assert.deepEqual(normalizeTextStyles({ body: { color: 'brand-1' } }), {
      body: { color: 'brand-1' },
    });
    assert.deepEqual(normalizeTextStyles({ title: { color: 'brand-3' } }), {
      title: { color: 'brand-3' },
    });
    // A slot outside the fixed set is still unknown and pruned.
    assert.deepEqual(normalizeTextStyles({ body: { color: 'brand-4' } }), {});
  });

  it('keeps one property when the others are default', () => {
    assert.deepEqual(normalizeTextStyles({ body: { align: 'right', color: 'default' } }), {
      body: { align: 'right' },
    });
    assert.deepEqual(
      normalizeTextStyles({ body: { align: 'left', color: 'default', size: 'lg' } }),
      { body: { size: 'lg' } }
    );
  });

  it('keeps all three properties together', () => {
    assert.deepEqual(
      normalizeTextStyles({ body: { align: 'center', color: 'accent', size: 'lg' } }),
      { body: { align: 'center', color: 'accent', size: 'lg' } }
    );
  });
});

describe('textStyleClasses', () => {
  it('maps to tf-* classes', () => {
    assert.equal(textStyleClasses({ align: 'center', color: 'muted' }), 'tf-align-center tf-color-muted');
  });
  it('includes tf-size-* for a non-default size', () => {
    assert.equal(textStyleClasses({ size: 'lg' }), 'tf-size-lg');
    assert.equal(
      textStyleClasses({ align: 'center', color: 'accent', size: 'sm' }),
      'tf-align-center tf-color-accent tf-size-sm'
    );
  });
  it('maps a theme brand swatch to tf-color-brand-*', () => {
    assert.equal(textStyleClasses({ color: 'brand-1' }), 'tf-color-brand-1');
    assert.equal(textStyleClasses({ color: 'brand-2' }), 'tf-color-brand-2');
  });
  it('is empty for defaults', () => {
    assert.equal(textStyleClasses({ align: 'left', color: 'default', size: 'md' }), '');
    assert.equal(textStyleClasses({}), '');
  });
});

describe('injectTextStyles', () => {
  it('merges classes into an existing class attribute', () => {
    const html = '<p class="body" data-inline-field="body" dir="auto">Hi</p>';
    const out = injectTextStyles(html, { textStyles: { body: { align: 'center' } } });
    assert.equal(out, '<p class="body tf-align-center" data-inline-field="body" dir="auto">Hi</p>');
  });

  it('adds a class attribute when the element has none', () => {
    const html = '<div data-inline-field="title">T</div>';
    const out = injectTextStyles(html, { textStyles: { title: { color: 'accent' } } });
    assert.equal(out, '<div class="tf-color-accent" data-inline-field="title">T</div>');
  });

  it('only touches the matching field, not similarly-named ones', () => {
    const html =
      '<div data-inline-field="card1" class="a">1</div>' +
      '<div data-inline-field="card1Body" class="b">1b</div>';
    const out = injectTextStyles(html, { textStyles: { card1: { align: 'right' } } });
    assert.match(out, /data-inline-field="card1" class="a tf-align-right"/);
    assert.doesNotMatch(out, /card1Body[^>]*tf-align-right/);
  });

  it('does not match a value that only appears in another attribute', () => {
    const html = '<p class="x" data-morph-role="body" data-inline-field="subheading">S</p>';
    const out = injectTextStyles(html, { textStyles: { body: { align: 'center' } } });
    assert.equal(out, html); // field "body" is not present as data-inline-field
  });

  it('is a no-op for empty / default-only styles', () => {
    const html = '<p data-inline-field="body">x</p>';
    assert.equal(injectTextStyles(html, {}), html);
    assert.equal(injectTextStyles(html, { textStyles: { body: { align: 'left' } } }), html);
  });

  it('applies all classes together', () => {
    const html = '<p class="body" data-inline-field="body">x</p>';
    const out = injectTextStyles(html, {
      textStyles: { body: { align: 'center', color: 'muted', size: 'lg' } },
    });
    assert.match(out, /class="body tf-align-center tf-color-muted tf-size-lg"/);
  });

  it('injects a size-only override', () => {
    const html = '<p data-inline-field="body">x</p>';
    const out = injectTextStyles(html, { textStyles: { body: { size: 'sm' } } });
    assert.equal(out, '<p class="tf-size-sm" data-inline-field="body">x</p>');
  });
});

describe('injectTextStyles — role-gated alignment', () => {
  // A list-slide-shaped schema: item text/title carry role:'list-item'.
  const listFields = [
    { key: 'title', type: 'string' },
    {
      key: 'items',
      type: 'items',
      itemFields: [
        { key: 'title', type: 'string', role: 'list-item' },
        { key: 'text', type: 'string', role: 'list-item' },
      ],
    },
  ];

  it('drops the align class on a list-item field but keeps colour/size', () => {
    const html = '<div data-inline-field="items.0.text">x</div>';
    const out = injectTextStyles(
      html,
      { textStyles: { 'items.0.text': { align: 'center', color: 'accent', size: 'lg' } } },
      listFields
    );
    assert.doesNotMatch(out, /tf-align-center/);
    assert.match(out, /tf-color-accent/);
    assert.match(out, /tf-size-lg/);
  });

  it('keeps the align class on a default (non-list) field', () => {
    const html = '<div data-inline-field="title">T</div>';
    const out = injectTextStyles(html, { textStyles: { title: { align: 'center' } } }, listFields);
    assert.match(out, /tf-align-center/);
  });

  it('allows alignment when no fields schema is passed (back-compat)', () => {
    const html = '<div data-inline-field="items.0.text">x</div>';
    const out = injectTextStyles(html, { textStyles: { 'items.0.text': { align: 'center' } } });
    assert.match(out, /tf-align-center/);
  });

  it('drops an align value the field role does not allow (quote: no right)', () => {
    const quoteFields = [{ key: 'quote', type: 'string', role: 'quote' }];
    const html = '<blockquote data-inline-field="quote">q</blockquote>';
    const right = injectTextStyles(html, { textStyles: { quote: { align: 'right' } } }, quoteFields);
    assert.doesNotMatch(right, /tf-align-right/);
    // centre is allowed for a quote and still emits
    const centre = injectTextStyles(html, { textStyles: { quote: { align: 'center' } } }, quoteFields);
    assert.match(centre, /tf-align-center/);
  });
});
