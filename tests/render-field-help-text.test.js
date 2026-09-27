/**
 * A field's declared `helpText` reaches the inspector, whatever its type (B303).
 *
 * The markdown branch of the field renderer always passed the generic
 * "Supports paragraphs, lists…" hint and never read `field.helpText`, so the
 * first markdown field that declared one (the video transcript: "Not shown on
 * the slide…") said nothing in the inspector about where its text goes. The
 * rule pinned here: a declaration wins; a type-specific hint is only the
 * fallback for a field that declares nothing.
 *
 * Run with: node --test tests/render-field-help-text.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/p1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;

const { createRenderField } =
  await import('../client/views/editor/editor-form/render-field.js');
const { createFieldRenderers } =
  await import('../client/views/editor/fields.js');

const GENERIC_MARKDOWN_HINT =
  'Supports paragraphs, lists, bold/italic, links, code, math, and markdown tables.';

function renderMarkdownField(field) {
  const slide = { id: 's1', type: 'video-slide', content: {}, notes: '' };
  const renderField = createRenderField({
    pres: { slides: [slide] },
    slide,
    def: { fields: [field], defaults: {} },
    fieldRenderers: createFieldRenderers(),
  });
  return renderField(field);
}

test('a markdown field that declares helpText shows it in the inspector', () => {
  const el = renderMarkdownField({
    key: 'transcript',
    label: 'Transcript',
    type: 'markdown',
    helpText: 'Not shown on the slide.',
  });
  assert.match(el.textContent, /Not shown on the slide\./);
  assert.doesNotMatch(el.textContent, /Supports paragraphs/);
});

test('a markdown field without helpText keeps the generic markdown hint', () => {
  const el = renderMarkdownField({
    key: 'body',
    label: 'Body',
    type: 'markdown',
  });
  assert.ok(el.textContent.includes(GENERIC_MARKDOWN_HINT));
});
