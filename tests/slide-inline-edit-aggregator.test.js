/**
 * The inline-edit aggregator is derived, not hand-maintained.
 *
 * `shared/slide-types/inline-edit.js` is the one static import list the editor
 * uses to reach a slide type's on-canvas editing descriptor. Deckyard has no
 * bundler, so a browser consumer cannot scan a directory — the list has to
 * exist. Hand-maintained it would be a second registration list next to
 * `registry.js`, drifting the moment a type is added or removed, which is the
 * exact duplication track A7.1 exists to remove. Same shape as the authoring
 * aggregator; unlike that one a descriptor legitimately holds functions
 * (cropMode, addPlacement, ensure), so there is no "plain data" gate here.
 *
 * Gates: byte-identical to the generator's output, every committed entry points
 * at a real type directory, and the consumer map stays wired to this one. See
 * scripts/generate-slide-inline-edit-aggregator.js.
 *
 * Run with: node --test tests/slide-inline-edit-aggregator.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  AGGREGATOR_PATH,
  REPO_ROOT,
  TYPES_DIR,
  buildAggregator,
  identifierFor,
  typesWithInlineEdit,
} from '../scripts/generate-slide-inline-edit-aggregator.js';
import { SLIDE_TYPE_INLINE_EDIT } from '../shared/slide-types/inline-edit.js';
import { INLINE_DESCRIPTORS } from '../client/views/editor/inline-edit/descriptors.js';
import { CORE_SLIDE_TYPE_NAMES } from '../shared/slide-types/registry.js';

test('the committed aggregator is byte-identical to the generated output', () => {
  const actual = fs.readFileSync(path.join(REPO_ROOT, AGGREGATOR_PATH), 'utf8');
  assert.equal(
    actual,
    buildAggregator(),
    `${AGGREGATOR_PATH} is out of date — run \`npm run gen:slide-inline-edit\``
  );
});

test('every type directory with an inline-edit.js is in the aggregator', () => {
  // The forward direction: a type that grows a descriptor but never reaches the
  // aggregator has no on-canvas editing, silently.
  assert.deepEqual(Object.keys(SLIDE_TYPE_INLINE_EDIT).sort(), typesWithInlineEdit());
});

test('the descriptor consumer is derived from the aggregator', () => {
  // descriptors.js no longer holds the map; it spreads the aggregator. If that
  // wiring is dropped the companion-coverage matrix would go quietly empty.
  assert.deepEqual(
    Object.keys(INLINE_DESCRIPTORS).sort(),
    Object.keys(SLIDE_TYPE_INLINE_EDIT).sort()
  );
  for (const name of Object.keys(SLIDE_TYPE_INLINE_EDIT)) {
    assert.equal(
      INLINE_DESCRIPTORS[name],
      SLIDE_TYPE_INLINE_EDIT[name],
      `INLINE_DESCRIPTORS["${name}"] is not the aggregator's descriptor`
    );
  }
});

test('every aggregator entry names a real core type', () => {
  const core = new Set(CORE_SLIDE_TYPE_NAMES);
  for (const name of Object.keys(SLIDE_TYPE_INLINE_EDIT)) {
    assert.ok(
      core.has(name),
      `the aggregator has "${name}" but it is not a registered core type — ` +
        'a leftover directory after a type was retired'
    );
    assert.ok(
      fs.existsSync(path.join(TYPES_DIR, name, 'inline-edit.js')),
      `the aggregator imports types/${name}/inline-edit.js, which does not exist`
    );
  }
});

test('a directory name maps to exactly one import identifier', () => {
  // The mapping is mechanical (kebab → camel + "InlineEdit"); a collision would
  // emit a file that does not parse, so assert it before it can happen.
  const ids = typesWithInlineEdit().map(identifierFor);
  assert.equal(new Set(ids).size, ids.length, `duplicate import identifiers: ${ids}`);
});
