/**
 * The companion-coverage gate for slide types (STRATEGY T7, and step 3 of
 * briefs/agent-facing-type-contract.md — the same test seen from two sides).
 *
 * Registering a type gives you the derived layers for free. The hand-maintained
 * companions — AI/MCP catalog entry, picker description, search aliases,
 * schematic glyph, settings curation category — do not come along, and every
 * one of them degrades gracefully when it is absent. Nothing breaks; the type
 * just gets quietly worse. #323 removed one such drift by hand (a deprecated
 * type still sitting in the AI catalog) and #386 removed another (three live
 * types the MCP layer could not see) — both symptoms of the same missing gate.
 *
 * This is that gate. It runs both directions, so it fails on the two failure
 * modes that actually happen:
 *
 *   forward — a type that owes a companion and does not have it. The build
 *             fails naming the type AND the companion, at author time.
 *   reverse — a companion entry for a type that is gone, deprecated, or opted
 *             out. That is the rot #323 had to clean up by hand.
 *
 * The exemption escape hatch is deliberately expensive: an entry needs a real
 * reason, and the reason is itself tested for rot (an exemption for a type that
 * no longer needs one fails). Same discipline as
 * tests/removed-slide-types.test.js.
 *
 * The matrix itself lives in tests/helpers/slide-type-companions.js; the
 * human-facing inventory (with the derived column) in
 * docs/reference/slide-type-companions.md.
 *
 * Run with: node --test tests/slide-type-companion-coverage.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import {
  isAgentOptOut,
  resolveAgentSlideTypes,
} from '../server/utils/ai/slide-catalog/agent-catalog.js';
import { SLIDE_TYPE_CATALOG } from '../server/utils/ai/slide-catalog/definitions.js';
import {
  COMPANIONS,
  CORE_SLIDE_TYPE_NAMES,
  missingFor,
  staleFor,
} from './helpers/slide-type-companions.js';

test('the matrix actually sees the registry', () => {
  // A vacuous pass is the one outcome worse than a failure here.
  assert.ok(
    CORE_SLIDE_TYPE_NAMES.length > 30,
    `expected the core registry, got ${CORE_SLIDE_TYPE_NAMES.length} types`
  );
  assert.ok(COMPANIONS.length > 0, 'expected at least one companion declared');
  for (const c of COMPANIONS) {
    assert.ok(c.keys().length > 0, `${c.id}: companion source resolved to nothing`);
  }
});

for (const companion of COMPANIONS) {
  const { id, label, where, degradesTo, exempt } = companion;

  test(`[${id}] every type that owes a ${label} has one`, (t) => {
    if (companion.optional) {
      t.skip(`${id} is sparse by design — only the reverse direction is a gate`);
      return;
    }
    const missing = missingFor(companion, CORE_SLIDE_TYPE_NAMES, SLIDE_TYPES);
    assert.deepEqual(
      missing,
      [],
      `these types have no ${label}:\n` +
        missing.map((n) => `  - ${n}`).join('\n') +
        `\n\nAdd an entry in ${where}, or exempt the type with a reason in\n` +
        `tests/helpers/slide-type-companions.js (companion "${id}").\n` +
        `Nothing crashes without it — ${degradesTo}. That is why this is a test.`
    );
  });

  test(`[${id}] no ${label} outlives the type it describes`, () => {
    const stale = staleFor(companion, SLIDE_TYPES);
    assert.deepEqual(
      stale,
      [],
      `${where} still names:\n` +
        stale.map((n) => `  - ${n}`).join('\n') +
        `\n\nEach is either unregistered, deprecated, or opted out of this ` +
        `companion. Drop the entry (retiring a type means retiring its ` +
        `companions), or exempt it with a reason in ` +
        `tests/helpers/slide-type-companions.js.`
    );
  });

  test(`[${id}] every exemption carries a reason and is still needed`, () => {
    for (const [name, why] of Object.entries(exempt)) {
      assert.ok(
        typeof why === 'string' && why.trim().length > 15,
        `${id}: exempt["${name}"] needs a real reason, not "${why}"`
      );
      const def = SLIDE_TYPES[name];
      assert.ok(def, `${id}: exempt["${name}"] names a type that is not registered`);
      const owes = companion.appliesTo(name, def);
      const covered = companion.has(name, def);
      assert.ok(
        owes && !covered,
        `${id}: exempt["${name}"] is no longer needed — the type ` +
          `${!owes ? 'does not owe this companion' : 'has one now'}. ` +
          `Drop the exemption; a stale one hides the next real gap.`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// The gate bites.
//
// Every assertion above is "this list is empty", which is also what a broken
// matrix returns. These run the same rules against a synthetic registry where
// the answer is known, so a matrix that has quietly stopped looking at anything
// fails here instead of passing everywhere.
// ---------------------------------------------------------------------------

const fakeCompanion = (entries, exempt = {}) => ({
  id: 'fake',
  label: 'fake companion',
  where: 'nowhere',
  degradesTo: 'nothing',
  appliesTo: (name, def) => def?.deprecated !== true,
  has: (name) => Object.prototype.hasOwnProperty.call(entries, name),
  keys: () => Object.keys(entries),
  exempt,
});

test('a new type with no companion is named, not tolerated', () => {
  const types = { 'kept-slide': {}, 'brand-new-slide': {} };
  const missing = missingFor(fakeCompanion({ 'kept-slide': 1 }), Object.keys(types), types);
  assert.deepEqual(missing, ['brand-new-slide']);
});

test('a deprecated type owes nothing, and its leftover entry is rot', () => {
  const types = { 'old-slide': { deprecated: true } };
  const companion = fakeCompanion({ 'old-slide': 1 });
  assert.deepEqual(missingFor(companion, Object.keys(types), types), []);
  assert.deepEqual(staleFor(companion, types), ['old-slide']);
});

test('an entry for a type that no longer exists is rot', () => {
  assert.deepEqual(staleFor(fakeCompanion({ 'ghost-slide': 1 }), {}), ['ghost-slide']);
});

test('an exemption silences both directions, and only for its own type', () => {
  const types = { 'weird-slide': {}, 'other-slide': {} };
  const companion = fakeCompanion({}, { 'weird-slide': 'a reason long enough to count' });
  assert.deepEqual(missingFor(companion, Object.keys(types), types), ['other-slide']);
});

// ---------------------------------------------------------------------------
// The agent-facing slice (briefs/agent-facing-type-contract.md, step 3).
//
// The generic matrix above covers "is there a catalog entry"; these pin the
// consequences of *not* having one, which is where the derivation had to make a
// guess. Kept here rather than in agent-slide-type-contract.test.js: that file
// unit-tests the derivation's behaviour, this one gates author discipline.
// ---------------------------------------------------------------------------

test('no core type reaches agents undocumented', () => {
  // resolveAgentSlideTypes degrades an entry-less type to documented:false so it
  // is at least usable at runtime (a fork type may legitimately land there).
  // For core, that fallback must never be load-bearing.
  const undocumented = Object.entries(resolveAgentSlideTypes({}))
    .filter(([name, entry]) => CORE_SLIDE_TYPE_NAMES.includes(name) && !entry.documented)
    .map(([name]) => name);
  assert.deepEqual(
    undocumented,
    [],
    `these core types are offered to agents with a derived description:\n` +
      undocumented.map((n) => `  - ${n}`).join('\n') +
      `\n\nWrite the editorial entry, or mark the type ai:false if agents should ` +
      `not have it. documented:false is the runtime safety net, not a resting place.`
  );
});

test('a structural type is never mistaken for a content type', () => {
  // The derivation reads `category` off the catalog entry, so an undocumented
  // type is unavoidably filed as 'content' — it would fall out of a
  // category:'structural' filter. The gate above is what keeps that harmless
  // for core types; this test states the dependency out loud so weakening one
  // breaks the other rather than silently mis-filing a type.
  const structural = resolveAgentSlideTypes({ category: 'structural' });
  const declaredStructural = CORE_SLIDE_TYPE_NAMES.filter(
    (name) => SLIDE_TYPE_CATALOG[name]?.category === 'structural'
  );
  assert.ok(declaredStructural.length > 0, 'expected structural types in the catalog');
  for (const name of declaredStructural) {
    if (isAgentOptOut(SLIDE_TYPES[name])) continue;
    assert.ok(
      structural[name],
      `${name} is category:'structural' in the catalog but missing from the ` +
        `structural filter — check that resolveAgentSlideTypes reads the same ` +
        `signal the catalog writes.`
    );
  }
});

test('the catalog agrees with itself about what is structural', () => {
  // Entries carry both `category` and `resolveInPhase1`; the derivation used to
  // read only the latter. They must not drift apart.
  for (const [name, entry] of Object.entries(SLIDE_TYPE_CATALOG)) {
    assert.equal(
      entry.category === 'structural',
      entry.resolveInPhase1 === true,
      `${name}: category:'${entry.category}' and resolveInPhase1:${entry.resolveInPhase1} ` +
        `disagree about whether this type is structural`
    );
  }
});
