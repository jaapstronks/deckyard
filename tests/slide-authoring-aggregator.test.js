/**
 * The authoring aggregator is derived, not hand-maintained.
 *
 * `shared/slide-types/authoring.js` is the one static import list the editor
 * uses to reach a slide type's author-facing companions. Deckyard has no
 * bundler, so a browser consumer cannot scan a directory — the list has to
 * exist. Hand-maintained it would be a second registration list next to
 * `registry.js`, drifting the moment a type is added or removed, which is the
 * exact duplication track A7.1 exists to remove.
 *
 * So it is a build product of the filesystem, and these are the gates:
 * byte-identical to the generator's output, and every committed entry pointing
 * at a real type directory. See scripts/generate-slide-authoring-aggregator.js.
 *
 * Run with: node --test tests/slide-authoring-aggregator.test.js
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
  typesWithAuthoring,
} from '../scripts/generate-slide-authoring-aggregator.js';
import { SLIDE_TYPE_AUTHORING } from '../shared/slide-types/authoring.js';
import { CORE_SLIDE_TYPE_NAMES } from '../shared/slide-types/registry.js';

test('the committed aggregator is byte-identical to the generated output', () => {
  const actual = fs.readFileSync(path.join(REPO_ROOT, AGGREGATOR_PATH), 'utf8');
  assert.equal(
    actual,
    buildAggregator(),
    `${AGGREGATOR_PATH} is out of date — run \`npm run gen:slide-authoring\``
  );
});

test('every type directory with an authoring.js is in the aggregator', () => {
  // The forward direction: a type that grows a companion but never reaches the
  // aggregator is invisible to every editor surface, silently.
  assert.deepEqual(Object.keys(SLIDE_TYPE_AUTHORING).sort(), typesWithAuthoring());
});

test('every aggregator entry names a real core type', () => {
  const core = new Set(CORE_SLIDE_TYPE_NAMES);
  for (const name of Object.keys(SLIDE_TYPE_AUTHORING)) {
    assert.ok(
      core.has(name),
      `the aggregator has "${name}" but it is not a registered core type — ` +
        'a leftover directory after a type was retired'
    );
    assert.ok(
      fs.existsSync(path.join(TYPES_DIR, name, 'authoring.js')),
      `the aggregator imports types/${name}/authoring.js, which does not exist`
    );
  }
});

test('a directory name maps to exactly one import identifier', () => {
  // The mapping is mechanical (kebab → camel + "Authoring"); a collision would
  // emit a file that does not parse, so assert it before it can happen.
  const ids = typesWithAuthoring().map(identifierFor);
  assert.equal(new Set(ids).size, ids.length, `duplicate import identifiers: ${ids}`);
});

test('an authoring companion is plain data', () => {
  // No DOM, no i18n calls, no closure state: the file has to stay readable from
  // either side and from tooling (docs/reference/slide-type-directory.md).
  for (const [name, authoring] of Object.entries(SLIDE_TYPE_AUTHORING)) {
    assert.equal(
      typeof authoring,
      'object',
      `types/${name}/authoring.js does not default-export an object`
    );
    assert.ok(authoring !== null, `types/${name}/authoring.js exports null`);
    for (const [key, value] of Object.entries(authoring)) {
      assert.notEqual(
        typeof value,
        'function',
        `types/${name}/authoring.js has a function at "${key}" — companions are data`
      );
    }
  }
});
