import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  SLIDE_TYPES,
  CORE_SLIDE_TYPE_NAMES,
} from '../shared/slide-types/registry.js';
import {
  REPO_ROOT,
  INVENTORY_DOC,
  COUNT_MARKER_FILES,
  coreCount,
  buildAllDocs,
} from '../scripts/generate-slide-type-docs.js';

/**
 * The slide-type inventory doc and the type counts in prose are generated from
 * the registry (scripts/generate-slide-type-docs.js). These tests gate the two
 * so a number can never again be hand-tracked and go stale. They iterate the
 * registry rather than enumerating type names, so adding or removing a type is
 * covered for free — which is the point of this doc existing.
 */

test('every generated doc is byte-identical to the committed file', () => {
  for (const [rel, expected] of buildAllDocs()) {
    const actual = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.equal(
      actual,
      expected,
      `${rel} is out of date — run \`node scripts/generate-slide-type-docs.js\``
    );
  }
});

test('the inventory lists exactly the core registry, in registration order', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, INVENTORY_DOC), 'utf8');
  const listed = [...doc.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(
    listed,
    CORE_SLIDE_TYPE_NAMES,
    'the inventory table must match CORE_SLIDE_TYPE_NAMES exactly'
  );
});

test('the stated count equals the real core type count (fork-stable)', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, INVENTORY_DOC), 'utf8');
  const m = /ships \*\*(\d+)\*\* built-in slide types/.exec(doc);
  assert.ok(m, 'inventory doc states a count');
  assert.equal(Number(m[1]), CORE_SLIDE_TYPE_NAMES.length);
  // Custom types (a fork's custom/slide-types/) must not inflate the count.
  assert.ok(
    Object.keys(SLIDE_TYPES).length >= CORE_SLIDE_TYPE_NAMES.length,
    'SLIDE_TYPES is core plus any custom'
  );
});

test('every prose count marker holds the current core count', () => {
  for (const rel of COUNT_MARKER_FILES) {
    const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const nums = [
      ...text.matchAll(/<!--gen:slide-type-count-->(\d+)<!--\/gen:slide-type-count-->/g),
    ].map((m) => Number(m[1]));
    assert.ok(nums.length > 0, `${rel}: expected at least one count marker`);
    for (const n of nums) {
      assert.equal(n, coreCount(), `${rel}: stale count marker (${n} ≠ ${coreCount()})`);
    }
  }
});
