/**
 * The tier ladder's guardrail: the core profile is what it says it is, and every
 * type outside it declares how it degrades into it.
 *
 * The facet exists to make a promise bounded. A promise nothing checks is the
 * state we were already in — 36 published names, no statement about which of
 * them a second implementation actually owes. So the assertions here are the
 * enforcement half of the decision, not decoration:
 *
 * 1. the profile is exactly the nine names, and they are real, active types;
 * 2. every other core type declares a `fallback`, and it is a tier-1 name;
 * 3. tier-1 types declare none — they are the floor, and a fallback on one
 *    would be a cycle waiting to happen;
 * 4. the degradation terminates in one hop for every registered type;
 * 5. a declared-but-unbuilt name is reserved, not registered;
 * 6. `tier` and `fallback` travel on `/api/slide-types`, because the editor and
 *    any browser-side exporter hold that response and not the registry.
 *
 * Run with: node --test tests/slide-type-tiers.test.js
 *
 * @see shared/slide-types/tiers.js
 * @see docs/reference/slide-type-tiers.md
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SLIDE_TYPES,
  CORE_SLIDE_TYPE_NAMES,
} from '../shared/slide-types/registry.js';
import { REMOVED_SLIDE_TYPE_NAMES } from '../shared/slide-types/removed.js';
import { SLIDE_STRUCTURE_NAMES } from '../shared/slide-types/structure.js';
import {
  CORE_PROFILE,
  DECLARED_SLIDE_TYPES,
  DECLARED_SLIDE_TYPE_NAMES,
  SLIDE_TIER,
  SLIDE_TIERS,
  coreProfileContract,
  isCoreProfileType,
  slideFallback,
  slideTypeTier,
} from '../shared/slide-types/tiers.js';
import { handleSlideTypes } from '../server/routes/api/slide-types.js';

/** Core names outside the profile — the tier-2 set, deprecated ones included. */
const DECKYARD_SET = CORE_SLIDE_TYPE_NAMES.filter((n) => !isCoreProfileType(n));

describe('the core profile', () => {
  it('is exactly the nine normative names', () => {
    assert.equal(CORE_PROFILE.length, 9, 'the profile is nine types');
    assert.deepEqual(
      [...CORE_PROFILE].sort(),
      [
        'chapter-title-slide',
        'content-slide',
        'end-slide',
        'image-slide',
        'image-text-slide',
        'list-slide',
        'quote-slide',
        'table-slide',
        'title-slide',
      ],
      'changing the profile changes what a conforming implementation owes — ' +
        'that is a spec decision, not a refactor',
    );
  });

  it('names only registered, non-deprecated core types', () => {
    for (const name of CORE_PROFILE) {
      assert.ok(SLIDE_TYPES[name], `profile names a registered type: ${name}`);
      assert.ok(
        CORE_SLIDE_TYPE_NAMES.includes(name),
        `a normative type must be core, not a fork type: ${name}`,
      );
      assert.notEqual(
        SLIDE_TYPES[name]?.deprecated,
        true,
        `a deprecated type cannot be normative: ${name}`,
      );
    }
  });

  it('leaves chart out on purpose', () => {
    // Pinned rather than merely omitted: chart is the one exclusion that looks
    // arbitrary from inside the product and is not. It needs a charting library,
    // and the bar for a second implementation is a weekend of work.
    assert.equal(isCoreProfileType('chart-slide'), false);
    assert.equal(slideTypeTier('chart-slide'), SLIDE_TIER.DECKYARD_SET);
  });
});

describe('the fallback facet', () => {
  it('is declared by every core type outside the profile', () => {
    const missing = DECKYARD_SET.filter(
      (name) => !slideFallback(SLIDE_TYPES[name]),
    );
    assert.deepEqual(
      missing,
      [],
      'a tier-2 type without a fallback is a slide a core-profile-only reader ' +
        'has to drop. Declare one, or ask whether the type is a theme variant:\n' +
        missing.join('\n'),
    );
  });

  it('only ever points at a tier-1 type', () => {
    const bad = [];
    for (const name of DECKYARD_SET) {
      const raw = SLIDE_TYPES[name]?.fallback;
      if (!isCoreProfileType(raw)) bad.push(`${name} -> ${raw ?? 'none'}`);
    }
    assert.deepEqual(
      bad,
      [],
      `a fallback must name one of the nine, so the degradation is guaranteed ` +
        `renderable:\n${bad.join('\n')}`,
    );
  });

  it('is absent on the tier-1 types themselves', () => {
    const declared = CORE_PROFILE.filter((name) => SLIDE_TYPES[name]?.fallback);
    assert.deepEqual(
      declared,
      [],
      `the profile is the floor; a fallback on a tier-1 type is either a cycle ` +
        `or a claim that the floor has a floor:\n${declared.join('\n')}`,
    );
  });

  it('degrades every registered core type in one hop', () => {
    for (const name of CORE_SLIDE_TYPE_NAMES) {
      const target = coreProfileContract(name, SLIDE_TYPES[name]);
      assert.ok(
        isCoreProfileType(target),
        `${name} does not resolve to a tier-1 contract (got '${target}')`,
      );
      assert.equal(
        coreProfileContract(target, SLIDE_TYPES[target]),
        target,
        `${name} -> ${target} must be the last hop`,
      );
    }
  });

  it('ignores a declaration that is not a tier-1 name', () => {
    // Seam rule 5: unknown degrades, never breaks. A fork declaring nonsense
    // gets "no declaration" and the caller's own default, not a throw.
    assert.equal(slideFallback({ fallback: 'acme-hero' }), '');
    assert.equal(slideFallback({ fallback: 42 }), '');
    assert.equal(slideFallback(undefined), '');
    assert.equal(
      coreProfileContract('acme-hero', { fallback: 'acme-hero' }),
      '',
    );
  });

  it('hears a fork type that declares its own', () => {
    assert.equal(
      coreProfileContract('acme-hero', { fallback: 'content-slide' }),
      'content-slide',
    );
  });
});

describe('the tier ladder', () => {
  it('has a description per tier', () => {
    for (const tier of Object.values(SLIDE_TIER)) {
      assert.ok(SLIDE_TIERS[tier], `tier ${tier} has a description`);
    }
    assert.equal(Object.keys(SLIDE_TIERS).length, 3);
  });

  it('resolves off the name, so an override cannot escape the promise', () => {
    for (const name of CORE_PROFILE) {
      assert.equal(slideTypeTier(name), SLIDE_TIER.CORE_PROFILE, name);
    }
    for (const name of DECKYARD_SET) {
      assert.equal(slideTypeTier(name), SLIDE_TIER.DECKYARD_SET, name);
    }
    assert.equal(slideTypeTier('acme-hero'), SLIDE_TIER.EXTENSION);
    assert.equal(slideTypeTier('custom-something'), SLIDE_TIER.EXTENSION);
    assert.equal(slideTypeTier(''), SLIDE_TIER.EXTENSION);
    assert.equal(slideTypeTier(undefined), SLIDE_TIER.EXTENSION);
  });

  it('accounts for every core type exactly once', () => {
    assert.equal(
      CORE_PROFILE.length + DECKYARD_SET.length,
      CORE_SLIDE_TYPE_NAMES.length,
    );
  });
});

describe('types declared without being built', () => {
  it('are reserved names, not registry entries', () => {
    for (const name of DECLARED_SLIDE_TYPE_NAMES) {
      assert.equal(
        SLIDE_TYPES[name],
        undefined,
        `${name} is registered — it is a normal type now, so it declares its ` +
          `own fallback and its entry in DECLARED_SLIDE_TYPES goes`,
      );
      assert.equal(
        REMOVED_SLIDE_TYPE_NAMES.includes(name),
        false,
        `${name} is a removed type — reserving a retired name would promise ` +
          `its return under different semantics`,
      );
    }
  });

  it('carry a tier, a tier-1 fallback, a structure and a reason', () => {
    for (const [name, entry] of Object.entries(DECLARED_SLIDE_TYPES)) {
      assert.ok(SLIDE_TIERS[entry.tier], `${name} declares a known tier`);
      assert.notEqual(
        entry.tier,
        SLIDE_TIER.CORE_PROFILE,
        `${name} cannot be normative while nothing renders it`,
      );
      assert.ok(
        isCoreProfileType(entry.fallback),
        `${name} must name a tier-1 fallback (got '${entry.fallback}')`,
      );
      assert.ok(
        SLIDE_STRUCTURE_NAMES.includes(entry.structure),
        `${name} must declare a known structure (got '${entry.structure}')`,
      );
      assert.ok(
        entry.why.length > 60,
        `${name} needs a real reason — the bar for a new published name is ` +
          `"which tier-1 type is the fallback, and why is that loss unacceptable"`,
      );
      assert.equal(
        coreProfileContract(name),
        entry.fallback,
        `${name} resolves to its declared fallback without a definition`,
      );
    }
  });

  it('include the code/monospace type', () => {
    // The one name decision 3 declares. Pinned so the "declare, do not build"
    // move is visible rather than an untested constant.
    assert.ok(DECLARED_SLIDE_TYPES['code-slide']);
    assert.equal(DECLARED_SLIDE_TYPES['code-slide'].fallback, 'content-slide');
  });
});

/** Drive the route the way the server does and hand back the parsed body. */
async function fetchMeta() {
  let body = '';
  const res = {
    writeHead() {},
    end(chunk) {
      body = chunk;
    },
  };
  const handled = await handleSlideTypes({
    req: { method: 'GET' },
    res,
    url: new URL('http://localhost/api/slide-types'),
    authedUser: null,
  });
  assert.equal(handled, true, 'the route did not claim GET /api/slide-types');
  return JSON.parse(body);
}

const META = await fetchMeta();

describe('the wire', () => {
  it('serves a tier for every registered type', () => {
    for (const name of Object.keys(META)) {
      assert.ok(
        SLIDE_TIERS[META[name].tier],
        `${name} was served tier '${META[name].tier}'`,
      );
    }
  });

  it('serves the resolved fallback for every tier-2 type', () => {
    const missing = DECKYARD_SET.filter(
      (name) => META[name]?.fallback !== slideFallback(SLIDE_TYPES[name]),
    );
    assert.deepEqual(
      missing,
      [],
      `the editor holds this response, not the registry — a fallback that does ` +
        `not travel is a declaration nothing can read:\n${missing.join('\n')}`,
    );
  });

  it('does not invent a fallback for the tier-1 types', () => {
    for (const name of CORE_PROFILE) {
      assert.equal(META[name]?.fallback, undefined, name);
      assert.equal(META[name]?.tier, SLIDE_TIER.CORE_PROFILE, name);
    }
  });
});
