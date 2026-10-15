/**
 * Tab order on the canvas (B704).
 *
 * Tab/Shift-Tab during an inline edit walks every editable field and every
 * ghost of the slide in schema order (client/views/editor/inline-edit/
 * tab-order.js): on a list-slide the title, its empty subheading's ghost,
 * then each item's title and text, to the last one without the mouse. The
 * browser half (the editor committing and opening the next stop) is driven
 * by hand; see docs/reference/wysiwyg-inline-editing.md.
 *
 * Run with: node --test tests/inline-tab-order.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import {
  schemaOrderKey,
  orderTabStops,
  nextTabStop,
} from '../client/views/editor/inline-edit/tab-order.js';

const LIST = SLIDE_TYPES['list-slide'];
const BLOCKS = SLIDE_TYPES['text-blocks-slide'];

/** A rendered field stop and a ghost stop, as the inline editor builds them. */
const field = (path) => ({ path, kind: 'field' });
const ghost = (path) => ({ path, kind: 'ghost' });

/** Walk Tab from `start` until it comes back, collecting the paths. */
function walk(ordered, start, backwards = false) {
  const seen = [start];
  let at = start;
  for (let i = 0; i < ordered.length; i++) {
    const next = nextTabStop(ordered, at, backwards);
    if (!next || next.path === start) break;
    seen.push(next.path);
    at = next.path;
  }
  return seen;
}

test('list-slide: Tab goes title → subheading ghost → every item, in order', () => {
  assert.ok(LIST, 'list-slide is registered');
  // DOM order of fields first, ghosts after (the overlay has no DOM place),
  // deliberately shuffled against the schema.
  const stops = [
    field('items.1.title'),
    field('title'),
    field('items.0.title'),
    field('items.2.title'),
    field('items.1.text'),
    ghost('items.2.text'),
    ghost('subheading'),
    ghost('items.0.text'),
  ];
  const ordered = orderTabStops(LIST, stops);
  assert.deepEqual(walk(ordered, 'title'), [
    'title',
    'subheading',
    'items.0.title',
    'items.0.text',
    'items.1.title',
    'items.1.text',
    'items.2.title',
    'items.2.text',
  ]);
});

test('Shift-Tab walks the same stops backwards, and both ends wrap', () => {
  const ordered = orderTabStops(LIST, [
    field('title'),
    field('items.0.title'),
    field('items.1.title'),
    ghost('subheading'),
  ]);
  assert.deepEqual(walk(ordered, 'items.1.title', true), [
    'items.1.title',
    'items.0.title',
    'subheading',
    'title',
  ]);
  assert.equal(nextTabStop(ordered, 'items.1.title').path, 'title');
  assert.equal(nextTabStop(ordered, 'title', true).path, 'items.1.title');
});

test('item 10 comes after item 9: indices compare as numbers', () => {
  const ordered = orderTabStops(LIST, [
    field('items.10.title'),
    field('items.9.title'),
    field('items.2.title'),
  ]);
  assert.deepEqual(
    ordered.map((s) => s.path),
    ['items.2.title', 'items.9.title', 'items.10.title'],
  );
});

test('a rendered field and a ghost for the same path count once, the field first', () => {
  const ordered = orderTabStops(LIST, [
    field('items.0.text'),
    ghost('items.0.text'),
  ]);
  assert.equal(ordered.length, 1);
  assert.equal(ordered[0].kind, 'field');
});

test('text-blocks: nested rows.N.blocks.M fields follow the nested schema', () => {
  assert.ok(BLOCKS, 'text-blocks-slide is registered');
  const ordered = orderTabStops(BLOCKS, [
    field('rows.1.title'),
    field('rows.0.blocks.1.body'),
    ghost('rows.0.blocks.1.title'),
    field('rows.0.blocks.0.body'),
    field('title'),
    field('rows.0.title'),
    field('rows.0.blocks.0.title'),
  ]);
  assert.deepEqual(
    ordered.map((s) => s.path),
    [
      'title',
      'rows.0.title',
      'rows.0.blocks.0.title',
      'rows.0.blocks.0.body',
      'rows.0.blocks.1.title',
      'rows.0.blocks.1.body',
      'rows.1.title',
    ],
  );
});

test('a field the schema does not know sorts last and keeps its given order', () => {
  assert.equal(schemaOrderKey(LIST, 'nope')[0], Infinity);
  const ordered = orderTabStops(LIST, [
    field('zz'),
    field('aa'),
    field('items.0.title'),
  ]);
  assert.deepEqual(
    ordered.map((s) => s.path),
    ['items.0.title', 'zz', 'aa'],
  );
});

test('one stop, or none, leaves Tab nowhere to go', () => {
  assert.equal(nextTabStop([], 'title'), null);
  assert.equal(nextTabStop([field('title')], 'title'), null);
  // A path that is not a stop starts at the edge.
  const two = [field('title'), field('items.0.title')];
  assert.equal(nextTabStop(two, 'gone').path, 'title');
  assert.equal(nextTabStop(two, 'gone', true).path, 'items.0.title');
});
