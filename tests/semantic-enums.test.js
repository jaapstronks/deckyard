/**
 * `semantic: true` on an enum travels as `data-<key>` (D130b, D132; B292).
 *
 * Pinned here, on both surfaces the value reaches:
 *  1. the reader: on the `<section>` for a top-level field, on the `<li>` for
 *     an item field, never as document text;
 *  2. the canvas: on the root `.slide` element, injected from the declaration
 *     by `renderSlideHtml`, so no type repeats it in its own renderer;
 *  3. one resolution for both: a stored value outside the options is not a
 *     meaning, so the type's default stands in (as the canvas renders it), and
 *     an item without a value carries nothing;
 *  4. the attribute name is derived: camelCase keys become kebab-case, since
 *     HTML lower-cases attribute names;
 *  5. which core fields declare it: the four D130 names, and no enum it did
 *     not name is silently promoted.
 *
 * Run with: node --test tests/semantic-enums.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { initSanitizer } from '../shared/sanitize.js';
await initSanitizer();

const { SLIDE_TYPES, CORE_SLIDE_TYPE_DEFS } =
  await import('../shared/slide-types/registry.js');
const { renderSlideSectionHtml } =
  await import('../shared/slide-types/semantic-projection.js');
const { renderSlideHtml } =
  await import('../shared/slide-types/presentation.js');
const { semanticDataAttrName, semanticEnumAttrs } =
  await import('../shared/slide-types/semantic-enums.js');

const rootTag = (html) => html.match(/<div\b[^>]*\bclass="slide[\s"][^>]*>/)[0];

test('the reader marks the section with a top-level semantic enum, not as text', () => {
  const def = SLIDE_TYPES['callout-slide'];
  const html = renderSlideSectionHtml(
    {
      type: 'callout-slide',
      content: { variant: 'warning', body: 'Careful.' },
    },
    def,
  );
  assert.match(
    html,
    /<section id="slide-1" class="reader-slide" data-slide-type="callout-slide" data-variant="warning" /,
  );
  assert.ok(!/>warning</i.test(html), html);
});

test('the reader marks each item <li> with its own semantic enum', () => {
  const def = SLIDE_TYPES['matrix-slide'];
  const html = renderSlideSectionHtml(
    {
      type: 'matrix-slide',
      content: {
        title: 'M',
        cells: [
          { title: 'A', body: 'a', tone: 'positive' },
          { title: 'B', body: 'b', tone: 'bogus' },
          { title: 'C', body: 'c' },
        ],
      },
    },
    def,
  );
  assert.match(
    html,
    /<li class="reader-item" data-tone="positive"><h3 data-field="title">A</,
  );
  // No declared default per item: an unknown or unset tone carries nothing.
  assert.match(html, /<li class="reader-item"><h3 data-field="title">B</);
  assert.match(html, /<li class="reader-item"><h3 data-field="title">C</);
});

test('the canvas root carries the same attribute, from the declaration', () => {
  for (const [type, content, expected] of [
    ['callout-slide', { variant: 'tip', body: 'x' }, 'tip'],
    ['list-slide', { title: 'L', variant: 'numbers', items: [] }, 'numbers'],
    ['comparison-slide', { variant: 'pros-cons' }, 'pros-cons'],
  ]) {
    const root = rootTag(renderSlideHtml({ type, content }));
    assert.ok(root.includes(` data-variant="${expected}"`), `${type}: ${root}`);
  }
});

test('a value outside the options resolves to the type default on both surfaces', () => {
  const type = 'callout-slide';
  const def = SLIDE_TYPES[type];
  const slide = { type, content: { variant: 'shout', body: 'x' } };
  assert.ok(
    rootTag(renderSlideHtml(slide)).includes(' data-variant="insight"'),
    'canvas',
  );
  assert.match(renderSlideSectionHtml(slide, def), /data-variant="insight"/);
  // …which is also what the canvas renders the slide as.
  assert.match(renderSlideHtml(slide), /slide-callout--insight/);
});

test('an enum without the declaration stays off both surfaces', () => {
  const def = {
    fields: [
      { key: 'layout', type: 'enum', options: ['a', 'b'] },
      { key: 'asideVariant', type: 'enum', options: ['note'], semantic: true },
      {
        key: 'hiddenKind',
        type: 'enum',
        options: ['x'],
        semantic: true,
        visibleWhen: { field: 'layout', in: ['b'] },
      },
    ],
    defaults: { layout: 'a' },
  };
  assert.equal(
    semanticEnumAttrs(
      def.fields,
      { asideVariant: 'note', hiddenKind: 'x' },
      def.defaults,
    ),
    ' data-aside-variant="note"',
  );
  assert.equal(semanticDataAttrName('variant'), 'data-variant');
});

test('the core types declare exactly the D130 semantic enums', () => {
  const declared = [];
  const walk = (name, fields, prefix) => {
    for (const f of fields || []) {
      if (f?.semantic === true) declared.push(`${name}.${prefix}${f.key}`);
      if (Array.isArray(f?.itemFields))
        walk(name, f.itemFields, `${prefix}${f.key}[].`);
    }
  };
  for (const [name, def] of Object.entries(CORE_SLIDE_TYPE_DEFS))
    walk(name, def.fields, '');
  assert.deepEqual(declared.sort(), [
    'callout-slide.variant',
    'comparison-slide.variant',
    'list-slide.variant',
    'matrix-slide.cells[].tone',
  ]);
});
