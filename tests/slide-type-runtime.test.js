import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES, CORE_SLIDE_TYPE_NAMES } from '../shared/slide-types/registry.js';
import {
  LIVE_INTERACTION_NAMES,
  SLIDE_RUNTIME_NAMES,
  isSlideRuntime,
  liveSlideTypeNames,
  slideLiveInteraction,
  slideRuntime,
} from '../shared/slide-types/runtime.js';
import { slideStructure } from '../shared/slide-types/structure.js';
import {
  BRANCH_THRESHOLD,
  INVENTORY,
  KINDS,
  deriveNameBranchingModules,
} from './helpers/slide-type-name-branching.js';

/**
 * The `runtime` facet's guardrail — brief C.
 *
 * `structure` earned its guardrail by being derivable: the field schema already
 * knows the shape of the content, so a declaration that lies is detectable, and
 * assertion 2 over there simply asks the schema. `runtime` has no such oracle.
 * Nothing in a type's fields says whether the presenting session aggregates
 * answers for it; that is a fact about the server, not about the slide.
 *
 * So this facet's truthfulness is checked from the other end. Three gates:
 *
 * 1. **Completeness** — every core type declares a runtime (mirrors the
 *    `structure` assertion, same reason: silence must not be a third answer).
 * 2. **Coherence** — the parts of the declaration that *can* contradict each
 *    other must not. A `live` type declares an interaction kind and nothing
 *    else does; a `live` type is not `chrome`; and the four live types are
 *    exactly the types carrying a `question` field. That last one is a
 *    necessary condition rather than a sufficient one, and it is the closest
 *    thing to derivation this facet has — a new `live` type without a question
 *    is a type that cannot ask the room anything.
 * 3. **No second definition** — no module re-derives the live set by hand.
 *    This is the assertion the facet exists for, inverted: brief B's assertion
 *    5 measured a *floor* (at least eight modules hard-code the quartet, so
 *    build the facet); once they read the facet, the same derivation becomes a
 *    *ceiling* (no module hard-codes it, and none may start).
 *
 * Run with: node --test tests/slide-type-runtime.test.js
 */

// --- assertion 1: completeness --------------------------------------------

test('every core slide type declares a runtime from the vocabulary', () => {
  const missing = [];
  for (const name of CORE_SLIDE_TYPE_NAMES) {
    const declared = SLIDE_TYPES[name]?.runtime;
    if (!isSlideRuntime(declared)) missing.push(`${name} (${declared ?? 'none'})`);
  }
  assert.deepEqual(
    missing,
    [],
    `every type must declare one of ${SLIDE_RUNTIME_NAMES.join(', ')}:\n` +
      missing.join('\n')
  );
});

// --- assertion 2: coherence -----------------------------------------------

test('a live type declares an interaction kind, and nothing else does', () => {
  const problems = [];
  for (const name of CORE_SLIDE_TYPE_NAMES) {
    const def = SLIDE_TYPES[name];
    const runtime = slideRuntime(def);
    const declared = def?.interaction;
    const kind = slideLiveInteraction(def);
    if (runtime === 'live') {
      if (!kind) {
        problems.push(
          `${name}: live, but its interaction kind is ${
            declared === undefined ? 'missing' : `'${declared}' (not one of ${LIVE_INTERACTION_NAMES.join(', ')})`
          }. Every consumer that guards submission also has to dispatch on the ` +
            `kind — declaring one without the other just moves the hard-coded list.`
        );
      }
    } else if (declared !== undefined) {
      problems.push(
        `${name}: declares interaction '${declared}' while runtime is '${runtime}'. ` +
          `The kind is the contract 'live' implies; on anything else it is dead metadata.`
      );
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('a live type carries the question it asks the room', () => {
  // The one derivable signal this facet has, and only in one direction: a slide
  // the audience answers must have somewhere to put the thing being asked.
  // Necessary, not sufficient — a `question` field does not make a type live —
  // so the reverse check is deliberately absent.
  const problems = [];
  for (const name of liveSlideTypeNames()) {
    const def = SLIDE_TYPES[name];
    const hasQuestion = (def?.fields || []).some((f) => f?.key === 'question');
    if (!hasQuestion) {
      problems.push(`${name}: declared live but carries no 'question' field`);
    }
    if (slideStructure(def) === 'chrome') {
      problems.push(`${name}: declared live but 'chrome' — a slide with no content cannot ask anything`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

// --- assertion 3: no second definition ------------------------------------

test('no module re-derives the live set by hand', () => {
  // Brief B's assertion 5 counted nine modules writing out the same four type
  // names to answer "does this slide collect answers from the audience?", and
  // asserted a floor so it would fail the moment the count dropped — the signal
  // to delete it and point at the facet. This is where it points.
  //
  // The set comes from the facet now, so this assertion cannot go stale against
  // a fifth live type: add one, and every module that hard-codes four names
  // still passes until it hard-codes the fifth as well.
  const live = liveSlideTypeNames();
  const derived = deriveNameBranchingModules();

  assert.ok(live.length >= 4, `expected the live types from the registry, got ${live.length}`);
  assert.ok(derived.size > 20, `expected the codebase scan, got ${derived.size} modules`);

  const rederivers = [...derived]
    .filter(([file, names]) => {
      // A per-type table has a row for each live type for the same reason it
      // has one for every type; that is not a second definition of the set.
      const kind = INVENTORY[file]?.kind;
      if (kind === KINDS.table || kind === KINDS.generated || kind === KINDS.source) {
        return false;
      }
      const liveNames = names.filter((n) => live.includes(n));
      if (liveNames.length < BRANCH_THRESHOLD) return false;
      // Same distinction for the sparse tables, which have no kind to lean on:
      // a module that names the live types *and little else* is answering "is
      // this slide live?"; one that also names twenty other types is a table
      // that happens to have rows for them. The nine this facet retired all
      // named the quartet plus at most follow-invite.
      return names.length <= liveNames.length + 1;
    })
    .map(([file]) => file)
    .sort();

  assert.deepEqual(
    rederivers,
    [],
    `these modules write out ${BRANCH_THRESHOLD}+ of the live types by hand:\n` +
      rederivers.map((f) => `  - ${f}`).join('\n') +
      `\n\nUse isLiveSlideType()/liveInteractionKind() from ` +
      `shared/slide-types/runtime.js instead.\nThat is what the facet is for: ` +
      `nine modules answered this question separately and had\nalready drifted ` +
      `apart at the edges.`
  );
});
