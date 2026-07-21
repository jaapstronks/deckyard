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

  it('prunes defaults and empty results (no no-op overrides stored)', () => {
    assert.deepEqual(normalizeTextStyles({ body: { align: 'left', color: 'default' } }), {});
    assert.deepEqual(normalizeTextStyles({ title: {} }), {});
  });

  it('drops unknown keys, values and non-objects', () => {
    assert.deepEqual(normalizeTextStyles({ body: { align: 'justify' } }), {});
    assert.deepEqual(normalizeTextStyles({ body: { color: 'rebeccapurple' } }), {});
    assert.deepEqual(normalizeTextStyles({ body: 'center' }), {});
    assert.deepEqual(normalizeTextStyles(null), {});
    assert.deepEqual(normalizeTextStyles('x'), {});
  });

  it('keeps one property when the other is default', () => {
    assert.deepEqual(normalizeTextStyles({ body: { align: 'right', color: 'default' } }), {
      body: { align: 'right' },
    });
  });
});

describe('textStyleClasses', () => {
  it('maps to tf-* classes', () => {
    assert.equal(textStyleClasses({ align: 'center', color: 'muted' }), 'tf-align-center tf-color-muted');
  });
  it('is empty for defaults', () => {
    assert.equal(textStyleClasses({ align: 'left', color: 'default' }), '');
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

  it('applies both classes together', () => {
    const html = '<p class="body" data-inline-field="body">x</p>';
    const out = injectTextStyles(html, {
      textStyles: { body: { align: 'center', color: 'inverse' } },
    });
    assert.match(out, /class="body tf-align-center tf-color-inverse"/);
  });
});
