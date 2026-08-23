/**
 * The `images` field renderer as an extension point (B126).
 *
 * The v7 → v8 sweep (#938) moved logo-wall to `items`, which left no core type
 * declaring `images` — and left `createIndexedAltSetter` writing `logo{N}Alt`
 * keys nothing declares any more. Because that setter only wrote a key already
 * present on the slide, the dead path was a *silent* no-op rather than a crash.
 *
 * `images` itself is not dead: it is a declared field type and one of the six
 * the custom-slide-type editor offers, so a custom type can declare it today.
 * These tests hold the finished shape — the renderer works for a custom type,
 * and the numbered-alt write path is gone and cannot quietly return.
 *
 * Run with: node --test tests/images-field-extension-point.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;

const { createFieldImages } =
  await import('../client/views/editor/fields/images/multiple-images.js');
const { FIELD_TYPES } = await import('../shared/slide-types/field-types.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');

const IMAGES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'client',
  'views',
  'editor',
  'fields',
  'images',
);

/**
 * Render the field for a one-field custom type, with a picker that yields
 * `picked` the moment the "Add from library…" button is clicked.
 * @param {{presets?: string[], content?: Object, picked?: Object}} opts
 */
function renderImagesField({ presets = [], content = {}, picked } = {}) {
  const slide = { id: 's1', type: 'custom-partners-slide', content };
  const field = { key: 'partners', type: 'images', label: 'Partners' };

  const openImagePicker = (opts) => {
    if (picked) opts.onPick(picked);
  };
  openImagePicker.providers = ['library'];

  let rerendered = 0;
  const renderer = createFieldImages({
    api: null,
    openImagePicker,
    readFileAsDataUrl: null,
    features: { enableUploads: false },
    pres: { id: 'p1', title: 'Deck', i18n: { active: 'nl' } },
    markDirty: () => {},
    scheduleUiRefresh: () => {},
    rerenderEditor: () => {
      rerendered += 1;
    },
  });

  const node = renderer(slide, field, presets, (arr) => {
    slide.content[field.key] = arr;
  });
  return { node, slide, rerendered: () => rerendered };
}

// ---------------------------------------------------------------------------
// The extension point is declared, so the renderer has a reason to exist.
// ---------------------------------------------------------------------------

test('`images` is a declared field type with no core declarant', () => {
  assert.ok(FIELD_TYPES.images, 'the field type is registered');
  assert.equal(FIELD_TYPES.images.valueKind, 'stringArray');

  const declarants = [];
  const walk = (type, fields) => {
    for (const f of Array.isArray(fields) ? fields : []) {
      if (f?.type === 'images') declarants.push(`${type}.${f.key}`);
      if (Array.isArray(f?.itemFields)) walk(type, f.itemFields);
    }
  };
  for (const [type, def] of Object.entries(SLIDE_TYPES))
    walk(type, def?.fields);
  assert.deepEqual(
    declarants,
    [],
    'no core type declares `images`; it is kept for custom types, and if a ' +
      'core type ever declares it again this test should say so out loud',
  );
});

// ---------------------------------------------------------------------------
// The dead write path — the literal "done when" of B126.
// ---------------------------------------------------------------------------

test('no numbered-alt write path survives in the images field folder', () => {
  const offenders = [];
  for (const name of fs.readdirSync(IMAGES_DIR)) {
    if (!name.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(IMAGES_DIR, name), 'utf8');
    // Comments explaining the removal are fine; a live `fieldPrefix` binding
    // or a `${...}${idx + 1}Alt` key template is not.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    if (/\bfieldPrefix\b/.test(code)) offenders.push(`${name}: fieldPrefix`);
    // A key template that interpolates an index and lands on `…Alt` — the
    // `logo{N}Alt` shape. `single-image.js` derives `${imageKey}Alt` from a
    // declared field key, which is a live path and deliberately not matched.
    if (/\$\{[^}]*\bidx\b[^}]*\}\s*Alt`/.test(code))
      offenders.push(`${name}: numbered alt key template`);
  }
  assert.deepEqual(offenders, [], 'dead indexed-alt write paths');
});

// This one passed before the fix too — the dead setter guarded on `key in
// slide.content`, which is exactly why it was silent. It pins the contract
// going forward: `images` is a URL array, so nothing else may land beside it.
test('picking an image writes the URL array and nothing else', () => {
  const { node, slide } = renderImagesField({
    content: { partners: [] },
    picked: {
      url: 'https://cdn.example/acme.png',
      alt: 'Acme logo',
      altByLang: { nl: 'Acme-logo' },
    },
  });
  const addBtn = Array.from(node.querySelectorAll('button')).find((b) =>
    b.textContent.includes('Add from library'),
  );
  assert.ok(addBtn, 'the library button renders when a provider is configured');
  addBtn.click();

  assert.deepEqual(slide.content.partners, ['https://cdn.example/acme.png']);
  assert.deepEqual(
    Object.keys(slide.content),
    ['partners'],
    'the picker writes no alt key — `images` has nowhere to put one',
  );
});

// ---------------------------------------------------------------------------
// Finished chrome: nothing logo-branded when there is no logo preset source.
// ---------------------------------------------------------------------------

const textOf = (node) => node.textContent || '';

test('a field without a preset source renders no preset section', () => {
  const { node } = renderImagesField({ content: { partners: [] } });
  assert.ok(
    !textOf(node).includes('Preset logos'),
    'an empty preset list renders no heading',
  );
  assert.ok(
    !node.querySelector('input[type="checkbox"]'),
    'and no preset checkboxes',
  );
});

test('presetSource: partnerlogos still renders its checkboxes', () => {
  const { node } = renderImagesField({
    presets: ['https://cdn.example/partner-a.svg'],
    content: { partners: [] },
  });
  assert.ok(textOf(node).includes('Preset logos'), 'the heading renders');
  assert.equal(node.querySelectorAll('input[type="checkbox"]').length, 1);
});
