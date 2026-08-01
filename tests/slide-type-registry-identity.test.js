/**
 * Tests for the slide-type identity layer on the registry (PR 6, move 4):
 * the getSlideType resolver, SLIDE_TYPE_IDS, getSlideTypeId, and the
 * canonicalSlideType read/export projection. Collision detection between core
 * and custom types is exercised in tests/slide-type-collision.test.js (which
 * loads the merge helper in isolation, since custom types are filesystem-loaded).
 *
 * Run with: node --test tests/slide-type-registry-identity.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  SLIDE_TYPES,
  SLIDE_TYPE_IDS,
  CORE_SLIDE_TYPE_NAMES,
  OVERRIDDEN_CORE_SLIDE_TYPE_NAMES,
  getSlideType,
  getSlideTypeId,
  resolveSlideTypeName,
  canonicalSlideType,
} from '../shared/slide-types/registry.js';
import {
  CORE_AUTHORITY,
  canonicalTypeName,
  formatCanonicalId,
  parseTypeId,
  sameType,
} from '../shared/slide-types/type-id.js';

/**
 * The core names whose definition is still CORE's.
 *
 * `CORE_SLIDE_TYPE_NAMES` lists the names core ships, not the names core still
 * serves: a fork `override: true` keeps the core name in the registry while
 * replacing the definition behind it, so that name's published id is the fork's
 * (`custom/payoff-slide`), not core's. Every spelling still resolves to the same
 * registry key — `eu.deckyard.slide.payoff`, `custom/payoff-slide` and
 * `payoff-slide` all land on `payoff-slide` — so nothing about back-compat
 * changes; what changes is whose identity the manifest reports, and reporting
 * the fork's is the point (a reader learns the deck needs the fork's
 * definition). The assertions below are about core's OWN identity scheme, so
 * they run over the names core actually still owns. Empty-op in the OSS lane,
 * where no name is overridden.
 */
const CORE_NAMES_SERVED_BY_CORE = CORE_SLIDE_TYPE_NAMES.filter(
  (name) => !OVERRIDDEN_CORE_SLIDE_TYPE_NAMES.includes(name)
);

describe('getSlideType resolver', () => {
  it('resolves a bare registered key', () => {
    assert.equal(getSlideType('title-slide'), SLIDE_TYPES['title-slide']);
  });
  it('resolves a core-qualified id to the same def', () => {
    assert.equal(getSlideType('core/title-slide'), SLIDE_TYPES['title-slide']);
  });
  it('resolves a versioned ref by name', () => {
    assert.equal(getSlideType('content-slide@7'), SLIDE_TYPES['content-slide']);
  });
  it('returns undefined for unknown or malformed refs', () => {
    assert.equal(getSlideType('no-such-slide'), undefined);
    assert.equal(getSlideType('a/b/c'), undefined);
    assert.equal(getSlideType(''), undefined);
    assert.equal(getSlideType(null), undefined);
  });
  it('resolves against an injected registry map', () => {
    const fake = { 'x-slide': { label: 'X' } };
    assert.deepEqual(getSlideType('x-slide', fake), { label: 'X' });
    assert.deepEqual(getSlideType('acme/x-slide', fake), { label: 'X' });
    assert.equal(getSlideType('title-slide', fake), undefined);
  });
});

describe('the three spellings are one type', () => {
  // The point of A8.3: a reverse-DNS id and the historical bare key name the
  // same definition, so publishing the canonical form costs no deck a rewrite.
  it('resolves the canonical reverse-DNS id to the same def as the bare key', () => {
    for (const ref of [
      `${CORE_AUTHORITY}.title`,
      `${CORE_AUTHORITY}.title@2`,
      `${CORE_AUTHORITY}/title`,
      'core/title',
      'title',
      'title-slide',
    ]) {
      assert.equal(
        getSlideType(ref),
        SLIDE_TYPES['title-slide'],
        `${ref} must resolve to the title-slide definition`
      );
      assert.equal(resolveSlideTypeName(ref), 'title-slide', ref);
    }
  });

  it('holds for every registered type, in both spellings', () => {
    // Every type, fork types included: whatever id we publish for it has to
    // resolve back to the key it was published for.
    for (const name of Object.keys(SLIDE_TYPES)) {
      assert.equal(
        resolveSlideTypeName(SLIDE_TYPE_IDS[name]),
        name,
        `${SLIDE_TYPE_IDS[name]} must resolve back to ${name}`
      );
      assert.equal(
        resolveSlideTypeName(canonicalTypeName(name)),
        name,
        `the suffix-free name of ${name} must resolve back to it`
      );
    }
    // sameType() compares identities, and a bare name is a CORE identity — so
    // it is core names that must equal their own canonical id. A fork type's
    // bare name and its `custom/…` id are deliberately different identities,
    // and an overridden core name is exactly that case wearing a core name.
    for (const name of CORE_NAMES_SERVED_BY_CORE) {
      assert.ok(
        sameType(name, SLIDE_TYPE_IDS[name]),
        `${name} and its canonical id must compare equal`
      );
    }
  });

  it('keeps canonical names unambiguous', () => {
    // Dropping `-slide` is only safe while no two core types differ by just
    // that suffix. A core type literally named `title` beside `title-slide`
    // would make `eu.deckyard.slide.title` mean two things — catch it at the
    // moment the name is added, not at the moment a reader misrenders.
    const byCanonical = new Map();
    for (const name of CORE_SLIDE_TYPE_NAMES) {
      const canonical = canonicalTypeName(name);
      const clash = byCanonical.get(canonical);
      assert.equal(
        clash,
        undefined,
        `${name} and ${clash} share the canonical name "${canonical}"`
      );
      byCanonical.set(canonical, name);
    }
  });

  it('keeps every spelling of an overridden core name resolvable', () => {
    // The positive half of CORE_NAMES_SERVED_BY_CORE: an override changes whose
    // identity the name publishes, and must change nothing about resolution.
    // A deck written against core still stores the bare key and still finds a
    // definition; the canonical core id a foreign reader may hand us still
    // lands on the same key. Only runs in the fork lane, where the fixture in
    // tests/fixtures/fork-slide-types/payoff-slide.js supplies an override.
    for (const name of OVERRIDDEN_CORE_SLIDE_TYPE_NAMES) {
      const coreId = `${CORE_AUTHORITY}.${canonicalTypeName(name)}`;
      for (const ref of [name, coreId, `core/${name}`, SLIDE_TYPE_IDS[name]]) {
        assert.equal(resolveSlideTypeName(ref), name, `${ref} -> ${name}`);
      }
      // The published id is the fork's, which is what tells a reader the deck
      // needs the fork's definition rather than core's.
      assert.equal(SLIDE_TYPE_IDS[name], formatCanonicalId(parseTypeId(SLIDE_TYPE_IDS[name])));
      assert.ok(!SLIDE_TYPE_IDS[name].startsWith(`${CORE_AUTHORITY}.`), SLIDE_TYPE_IDS[name]);
    }
  });

  it('lets an exact registry key win over a canonical alias', () => {
    // A fork registering a literal `title` keeps it; core's `title-slide` only
    // answers to `title` when nothing is registered under that key.
    const fake = { title: { label: 'Fork title' }, 'title-slide': { label: 'Core' } };
    assert.deepEqual(getSlideType('title', fake), { label: 'Fork title' });
    assert.deepEqual(getSlideType('title-slide', fake), { label: 'Core' });
  });
});

describe('SLIDE_TYPE_IDS / getSlideTypeId', () => {
  it('gives every registered type an id that is already canonical', () => {
    for (const name of Object.keys(SLIDE_TYPES)) {
      const id = SLIDE_TYPE_IDS[name];
      assert.equal(
        formatCanonicalId(parseTypeId(id)),
        id,
        `${name} -> ${id} is not the canonical spelling`
      );
    }
  });
  it('gives every CORE type a reverse-DNS id', () => {
    // A fork type is only reverse-DNS if the fork declares an authority; one
    // that declares a single-label namespace (or none) keeps the slash form,
    // because we cannot invent a domain on its behalf. That applies to a fork
    // override of a core NAME too, hence the served-by-core filter.
    for (const name of CORE_NAMES_SERVED_BY_CORE) {
      const id = SLIDE_TYPE_IDS[name];
      assert.ok(id.startsWith(`${CORE_AUTHORITY}.`), `${name} -> ${id}`);
    }
  });
  it('core types resolve to <core authority>.<name>, suffix dropped', () => {
    assert.equal(getSlideTypeId('title-slide'), 'eu.deckyard.slide.title');
    assert.equal(getSlideTypeId('content-slide'), 'eu.deckyard.slide.content');
  });
  it('returns undefined for an unknown name', () => {
    assert.equal(getSlideTypeId('no-such-slide'), undefined);
  });
});

describe('canonicalSlideType', () => {
  it('projects the stored registry key to its one published id', () => {
    assert.equal(canonicalSlideType('title-slide'), 'eu.deckyard.slide.title');
    assert.equal(canonicalSlideType('content-slide'), 'eu.deckyard.slide.content');
  });
  it('folds any accepted spelling to the same canonical id', () => {
    assert.equal(canonicalSlideType('core/title-slide'), 'eu.deckyard.slide.title');
    assert.equal(canonicalSlideType('eu.deckyard.slide.title'), 'eu.deckyard.slide.title');
  });
  it('returns an unresolvable value unchanged (unknown/foreign type)', () => {
    // An unknown type still crosses the boundary intact rather than dropping.
    assert.equal(canonicalSlideType('acme/hero'), 'acme/hero');
    assert.equal(canonicalSlideType('ghost-slide'), 'ghost-slide');
    assert.equal(canonicalSlideType(''), '');
    assert.equal(canonicalSlideType(5), 5);
  });
});
