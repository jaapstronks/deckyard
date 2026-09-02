/**
 * A refused save reaches the screen, and says which field (B200).
 *
 * The slide-type builder let you add an `items` field, offered no sub-field
 * editor once the row collapsed itself, and posted the definition anyway. The
 * API answered `400 Invalid field definitions.`; the only account of that was a
 * 5-second toast in the far corner naming no field, so Save looked like it did
 * nothing at all.
 *
 * Pinned here:
 *  1. the rules the API applies live in one shared module, so the builder can
 *     run them before the POST and locate the offending row;
 *  2. an API refusal — any reason, not just this one — lands in the editor's own
 *     error region rather than being swallowed;
 *  3. the row a problem names is opened and marked, so the message sits next to
 *     the control that has to change.
 *
 * Run with: node --test tests/slide-type-editor-save-refusal.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/settings',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;

// jsdom has no layout, so scrollIntoView is absent on elements.
dom.window.Element.prototype.scrollIntoView = function scrollIntoView() {};

const { validateCustomFieldDefinitions, describeFieldProblem } =
  await import('../shared/slide-types/custom-field-definitions.js');
const { createSlideTypeEditor } =
  await import('../client/views/settings/slide-type-editor/index.js');

/** A definition the builder would post: valid except for the fields under test. */
function definition(fields) {
  return { label: 'Repro', slug: 'repro', fields };
}

/** Mount an editor for `slideType` and hand back its DOM plus the save button. */
function mount({ slideType, onSave }) {
  const editor = createSlideTypeEditor({
    slideType,
    coreTypes: {},
    onSave,
    onCancel: () => {},
  });
  document.body.append(editor.el);
  return {
    el: editor.el,
    save: () =>
      editor.el.querySelector('.slide-type-editor-header .btn-primary'),
    error: () => editor.el.querySelector('.slide-type-editor-error'),
  };
}

test('the shared rules refuse an items field with no item fields, and locate it', () => {
  const result = validateCustomFieldDefinitions([
    { key: 'title', type: 'string', label: 'Title' },
    { key: 'rows', type: 'items', label: 'Rows' },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.problem.reason, 'items_without_item_fields');
  assert.equal(result.problem.index, 1);
  assert.equal(result.problem.itemIndex, null);
  const message = describeFieldProblem(result.problem);
  assert.match(message, /"Rows"/);
  assert.match(message, /item fields/);
});

test('a problem inside itemFields is re-anchored on the parent row', () => {
  const result = validateCustomFieldDefinitions([
    {
      key: 'rows',
      type: 'items',
      label: 'Rows',
      itemFields: [
        { key: 'name', type: 'string', label: 'Name' },
        { key: 'kind', type: 'enum', label: 'Kind', options: [] },
      ],
    },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.problem.reason, 'enum_without_options');
  assert.equal(result.problem.index, 0, 'the top-level row to open');
  assert.equal(result.problem.itemIndex, 1, 'the sub-row inside it');
  assert.match(describeFieldProblem(result.problem), /"Rows" › "Kind"/);
});

test('a valid definition normalizes and drops stray properties', () => {
  const result = validateCustomFieldDefinitions([
    { key: 'title', type: 'string', label: 'Title', bogus: 1, required: true },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fields, [
    { key: 'title', type: 'string', label: 'Title', required: true },
  ]);
});

test('Save does not post a definition the API would refuse, and names the field', async () => {
  let posted = 0;
  const view = mount({
    slideType: definition([
      { key: 'title', type: 'string', label: 'Title' },
      { key: 'rows', type: 'items', label: 'Rows' },
    ]),
    onSave: async () => {
      posted += 1;
    },
  });

  view.save().click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(posted, 0, 'the round-trip is not spent on a known refusal');
  assert.equal(view.error().hidden, false, 'the refusal is on screen');
  assert.match(view.error().textContent, /"Rows"/);

  const row = view.el.querySelector('.field-list-item.is-invalid');
  assert.ok(row, 'the offending row is marked');
  assert.equal(row.open, true, 'and opened, so the message is not hidden');
  assert.match(
    row.querySelector('.field-list-item-error').textContent,
    /item fields/,
  );
});

test('an API refusal reaches the screen instead of being swallowed', async () => {
  // Any reason, not only a field one: the editor is the surface that failed.
  const err = new Error('A slide type with this slug already exists.');
  err.statusCode = 400;
  err.code = 'slug_exists';

  const view = mount({
    slideType: definition([{ key: 'title', type: 'string', label: 'Title' }]),
    onSave: async () => {
      throw err;
    },
  });

  view.save().click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(view.error().hidden, false);
  assert.equal(view.error().textContent, err.message);
  assert.equal(view.save().disabled, false, 'and the form is usable again');
});

test('the next attempt starts from a clean slate', async () => {
  let posted = 0;
  const view = mount({
    slideType: definition([{ key: 'rows', type: 'items', label: 'Rows' }]),
    onSave: async () => {
      posted += 1;
    },
  });

  view.save().click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(view.error().hidden, false);

  // Give the repeater an item field the way the sub-editor does, then retry.
  const addButtons = view.el.querySelectorAll('.field-list-nested .btn');
  addButtons[addButtons.length - 1].click();
  view.save().click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(posted, 1, 'the corrected definition is posted');
  assert.equal(view.error().hidden, true, 'and the refusal is gone');
  assert.equal(view.el.querySelector('.field-list-item.is-invalid'), null);
});
