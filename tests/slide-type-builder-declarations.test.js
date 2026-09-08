/**
 * A DB slide type carries the three A2 declarations (B237, D84).
 *
 * `itemLabelField`, `foldUnofferedTo` and `mediaRef` describe what a field
 * *means* — which sub-field heads an item, where a retired option's stored
 * value lands, that a string references media the document cannot embed. The
 * projection has honoured all three on any field since A2.1–A2.3, and the
 * shared walk has checked them since B231; the only thing keeping them out of a
 * database type was the builder: no control wrote one, and the whitelist on the
 * way to storage dropped one that arrived by any other route.
 *
 * Pinned here:
 *  1. each declaration has a control, in the row of the type that may carry it,
 *     and the choices it offers are the ones the walk would accept;
 *  2. a definition carrying all three survives a round-trip through the editor
 *     and the storage rules unchanged;
 *  3. changing a row's type drops what that type cannot carry, so the contract
 *     never refuses a Save over something no longer on screen.
 *
 * Run with: node --test tests/slide-type-builder-declarations.test.js
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

const { createFieldListEditor } =
  await import('../client/views/settings/slide-type-editor/field-editor.js');
const { validateCustomFieldDefinitions } =
  await import('../shared/slide-types/custom-field-definitions.js');

/** Mount the field list editor and report the last array it handed back. */
function mount(fields) {
  const seen = { fields: null };
  const editor = createFieldListEditor({
    fields,
    onChange: (next) => {
      seen.fields = next;
    },
  });
  document.body.append(editor.el);
  return { el: editor.el, seen };
}

/** The rows of one field's own body — not those of a nested item editor. */
function ownRows(row) {
  return [...row.querySelectorAll('.field-list-field-row')].filter(
    (r) => r.closest('.field-list-item') === row,
  );
}

/** The control in this field's row whose label reads `text`. */
function control(row, text) {
  const found = ownRows(row).find((r) =>
    r.querySelector('label')?.textContent.includes(text),
  );
  return found?.querySelector('select, input, textarea') || null;
}

const rows = (el) =>
  [...el.querySelectorAll('.field-list-item')].filter(
    (r) => r.parentElement === el,
  );

const choices = (select) => [...select.options].map((o) => o.value);

const fire = (node, type) =>
  node.dispatchEvent(new dom.window.Event(type, { bubbles: true }));

test('an items row offers its readable string sub-fields as the item heading', () => {
  const view = mount([
    {
      key: 'rows',
      type: 'items',
      label: 'Rows',
      itemFields: [
        { key: 'value', type: 'string', label: 'Value' },
        { key: 'title', type: 'string', label: 'Title' },
        { key: 'photo', type: 'image', label: 'Photo' },
      ],
    },
  ]);
  const select = control(rows(view.el)[0], 'Heading of an item');
  assert.ok(select, 'the control is in the items row');
  assert.deepEqual(
    choices(select),
    ['', 'value', 'title'],
    'the walk’s own headable keys, plus falling back to the first text',
  );
  assert.equal(select.value, '', 'undeclared means the default, not a guess');

  select.value = 'title';
  fire(select, 'change');
  assert.equal(view.seen.fields[0].itemLabelField, 'title');

  select.value = '';
  fire(select, 'change');
  assert.equal(
    'itemLabelField' in view.seen.fields[0],
    false,
    'choosing the default removes the declaration rather than storing an empty one',
  );
});

test('the item-heading choices follow the sub-fields as they are edited', () => {
  const view = mount([
    {
      key: 'rows',
      type: 'items',
      label: 'Rows',
      itemFields: [{ key: 'value', type: 'string', label: 'Value' }],
    },
  ]);
  const row = rows(view.el)[0];
  const select = control(row, 'Heading of an item');
  assert.deepEqual(choices(select), ['', 'value']);

  // Add a sub-field through the nested editor's own button.
  const nested = row.querySelector('.field-list-nested .field-list-editor');
  nested.querySelector('button.btn-secondary').click();
  assert.deepEqual(
    choices(control(row, 'Heading of an item')),
    ['', 'value', 'field2'],
    'the new sub-field is offered without a re-render of the row',
  );
});

test('an enum row offers its own options as the fold target', () => {
  const view = mount([
    {
      key: 'density',
      type: 'enum',
      label: 'Density',
      options: ['auto', 'compact', 'comfortable'],
    },
  ]);
  const row = rows(view.el)[0];
  const select = control(row, 'A retired value becomes');
  assert.ok(select, 'the control is in the enum row');
  assert.deepEqual(choices(select), ['', 'auto', 'compact', 'comfortable']);

  select.value = 'auto';
  fire(select, 'change');
  assert.equal(view.seen.fields[0].foldUnofferedTo, 'auto');

  // Retiring an option is exactly what the textarea above does.
  const options = row.querySelector('textarea');
  options.value = 'auto\ncompact';
  fire(options, 'input');
  assert.deepEqual(
    choices(control(row, 'A retired value becomes')),
    ['', 'auto', 'compact'],
    'the retired option leaves the choices it can no longer be folded into',
  );
});

test('a string row toggles into a media reference, with a label and a sibling link', () => {
  const view = mount([
    { key: 'source', type: 'string', label: 'Source' },
    { key: 'watchUrl', type: 'string', label: 'Watch URL' },
    { key: 'poster', type: 'image', label: 'Poster' },
  ]);
  const row = rows(view.el)[0];
  const toggle = control(row, 'References media');
  assert.ok(toggle, 'the toggle is in the string row');
  assert.equal(
    control(row, 'Name of the stand-in'),
    null,
    'folded away until on',
  );

  toggle.checked = true;
  fire(toggle, 'change');
  assert.deepEqual(view.seen.fields[0].mediaRef, {});

  const open = rows(view.el)[0];
  const label = control(open, 'Name of the stand-in');
  label.value = 'Video';
  fire(label, 'input');
  assert.equal(view.seen.fields[0].mediaRef.label, 'Video');

  const link = control(open, 'Link the stand-in to');
  assert.deepEqual(
    choices(link),
    ['', 'watchUrl'],
    'the string siblings at this level, and not the field itself or an image',
  );
  link.value = 'watchUrl';
  fire(link, 'change');
  assert.equal(view.seen.fields[0].mediaRef.linkKey, 'watchUrl');

  const off = control(rows(view.el)[0], 'References media');
  off.checked = false;
  fire(off, 'change');
  assert.equal('mediaRef' in view.seen.fields[0], false);
});

test('a definition carrying all three survives a round-trip unchanged', () => {
  const stored = validateCustomFieldDefinitions([
    {
      key: 'source',
      type: 'string',
      label: 'Source',
      mediaRef: { label: 'Video', linkKey: 'watchUrl' },
    },
    { key: 'watchUrl', type: 'string', label: 'Watch URL' },
    {
      key: 'density',
      type: 'enum',
      label: 'Density',
      options: ['auto', 'compact'],
      foldUnofferedTo: 'auto',
    },
    {
      key: 'rows',
      type: 'items',
      label: 'Rows',
      itemLabelField: 'title',
      itemFields: [
        { key: 'value', type: 'string', label: 'Value' },
        { key: 'title', type: 'string', label: 'Title' },
      ],
    },
  ]);
  assert.equal(stored.ok, true);

  // Open it in the builder and touch one unrelated control, the way an author
  // editing an existing type would.
  const view = mount(stored.fields);
  const help = control(rows(view.el)[1], 'Help text');
  help.value = 'Where the video lives';
  fire(help, 'input');

  const posted = validateCustomFieldDefinitions(view.seen.fields);
  assert.equal(posted.ok, true, 'the builder does not post what it read back');
  assert.deepEqual(posted.fields[0].mediaRef, {
    label: 'Video',
    linkKey: 'watchUrl',
  });
  assert.equal(posted.fields[2].foldUnofferedTo, 'auto');
  assert.equal(posted.fields[3].itemLabelField, 'title');
});

test('changing a row’s type drops what the new type cannot carry', () => {
  // Otherwise the contract refuses a Save over a `maxLength` the string row
  // wrote and the enum row has no control to clear.
  const view = mount([
    { key: 'a', type: 'string', label: 'A', maxLength: 40, mediaRef: {} },
  ]);
  const type = control(rows(view.el)[0], 'Type');
  type.value = 'enum';
  fire(type, 'change');

  assert.deepEqual(Object.keys(view.seen.fields[0]), ['key', 'type', 'label']);
  const row = rows(view.el)[0];
  assert.equal(control(row, 'References media'), null);
  assert.ok(
    control(row, 'A retired value becomes'),
    'and the enum controls arrive',
  );
});
