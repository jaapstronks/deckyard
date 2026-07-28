/**
 * Assertion 5 of the `structure` facet's guardrail: the companion matrix has no
 * hole.
 *
 * Assertions 1-4 live in tests/slide-type-structure.test.js and are all about
 * the *types* — does each declare a structure, does the declaration match the
 * schema, do two types secretly offer the same thing, does a layout variant
 * throw content away. This one is about the *codebase around* the types, and it
 * is the only one of the five that comes from a real regression rather than from
 * design.
 *
 * The failure it exists to stop: a module carries per-type knowledge, nobody
 * knows it does, and a type gets added, deprecated or renamed without visiting
 * it. That is what happened in PR #451 — see the header of
 * tests/helpers/slide-type-name-branching.js for the full account.
 *
 * The gate is on the accounting, not the contents. A module is free to be a
 * closed-set special case; it is not free to be a surprise.
 *
 * Run with: node --test tests/slide-type-name-branching.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRANCH_THRESHOLD,
  CORE_TYPE_NAMES,
  INTERACTION_TYPES,
  INVENTORY,
  KINDS,
  deriveNameBranchingModules,
} from './helpers/slide-type-name-branching.js';
import { COMPANIONS } from './helpers/slide-type-companions.js';

const derived = deriveNameBranchingModules();
const COMPANION_IDS = new Set(COMPANIONS.map((c) => c.id));

test('the derivation actually sees the codebase', () => {
  // Every assertion below is a subset check against `derived`. If the scan
  // silently returned nothing — a moved repo root, a git invocation that failed
  // — all of them would pass while guarding nothing.
  assert.ok(
    CORE_TYPE_NAMES.length > 30,
    `expected the core registry, got ${CORE_TYPE_NAMES.length} names`
  );
  assert.ok(
    derived.size > 30,
    `expected dozens of name-branching modules, got ${derived.size}`
  );
  for (const [file, names] of derived) {
    assert.ok(
      names.length >= BRANCH_THRESHOLD,
      `${file}: derived with ${names.length} names, below the threshold`
    );
  }
});

test('every module that branches on slide-type names is accounted for', () => {
  const unaccounted = [...derived.keys()]
    .filter((file) => !INVENTORY[file])
    .sort();

  assert.deepEqual(
    unaccounted,
    [],
    `these modules branch on ${BRANCH_THRESHOLD}+ slide-type names and are not in ` +
      `the inventory:\n` +
      unaccounted.map((f) => `  - ${f} (${derived.get(f).length} types)`).join('\n') +
      `\n\nAdd an entry in tests/helpers/slide-type-name-branching.js saying what ` +
      `kind of\nper-type knowledge it carries and why that is safe. If it is a ` +
      `table every type\nowes a row in, it belongs in the companion matrix too.\n` +
      `Nothing crashes without this — a type just quietly misses a place. That is ` +
      `why\nit is a test.`
  );
});

test('no inventory entry has gone stale', () => {
  const stale = Object.keys(INVENTORY)
    .filter((file) => !derived.has(file))
    .sort();

  assert.deepEqual(
    stale,
    [],
    `these files no longer branch on ${BRANCH_THRESHOLD}+ type names (moved, ` +
      `deleted, or the\nknowledge was derived away — which is the good outcome). ` +
      `Drop them from the\ninventory:\n${stale.map((f) => `  - ${f}`).join('\n')}`
  );
});

test('every table-kind module is gated by the companion matrix', () => {
  // This is the assertion's title claim, made literal: a module that holds a row
  // per type must be one the matrix knows how to check in both directions.
  const problems = [];
  for (const [file, entry] of Object.entries(INVENTORY)) {
    if (entry.kind !== KINDS.table) continue;
    if (!entry.companion) {
      problems.push(`${file}: kind 'table' without a companion id`);
    } else if (!COMPANION_IDS.has(entry.companion)) {
      problems.push(`${file}: companion '${entry.companion}' is not in the matrix`);
    }
  }
  assert.deepEqual(
    problems,
    [],
    `a per-type table has to be gated by tests/helpers/slide-type-companions.js, ` +
      `or it is\nexactly the hole this test is named after:\n${problems.join('\n')}`
  );
});

test('the inventory is a worklist, not a hiding place', () => {
  const kinds = new Set(Object.values(KINDS));
  for (const [file, entry] of Object.entries(INVENTORY)) {
    assert.ok(kinds.has(entry.kind), `${file}: unknown kind '${entry.kind}'`);
    assert.ok(
      typeof entry.why === 'string' && entry.why.length > 60,
      `${file}: needs a real reason, not a label`
    );
    if (entry.kind === KINDS.generated || entry.gate) {
      assert.ok(entry.gate, `${file}: generated code names the script that produces it`);
    }
  }
});

test('the live-interaction quartet is hard-coded in module after module', () => {
  // Not a gate — a measurement, and the most useful thing this inventory found.
  //
  // Nine modules independently write out most or all of the same four type names
  // to answer one question: "does this slide collect answers from the audience?"
  // None of them wants to know *which* type it is; they all want a capability the
  // type does not declare. That is the `runtime` facet, which brief B deferred
  // with "real, but no consumer yet". There are nine consumers, they already
  // disagree at the edges (the presenter's live set includes follow-invite, the
  // session storage only covers three of the four), and every one of them is a
  // place a fifth interaction type would be forgotten.
  //
  // Counted over `specific`-kind modules only: a table with a row per type has a
  // row for each of these four for the same reason it has one for every type,
  // and that is not the duplication in question.
  //
  // The assertion is a floor, not an equality: it fails when the count drops,
  // which is the moment to delete this test and point at the facet instead.
  const quartetModules = [...derived]
    .filter(([file, names]) => {
      if (INVENTORY[file]?.kind !== KINDS.specific) return false;
      return names.filter((n) => INTERACTION_TYPES.includes(n)).length >= 3;
    })
    .map(([file]) => file)
    .sort();

  assert.ok(
    quartetModules.length >= 8,
    `expected the interaction quartet re-derived across modules, found ` +
      `${quartetModules.length}:\n${quartetModules.map((f) => `  - ${f}`).join('\n')}\n\n` +
      `If this dropped because the types now declare a runtime capability, ` +
      `delete this\ntest — it has done its job.`
  );
});
