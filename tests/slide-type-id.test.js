/**
 * Tests for the slide-type identity model: the canonical reverse-DNS id, and
 * the `namespace/name[@version]` and bare-name spellings that stay valid.
 *
 * Run with: node --test tests/slide-type-id.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  CORE_NAMESPACE,
  CORE_AUTHORITY,
  parseTypeId,
  tryParseTypeId,
  formatTypeId,
  formatCanonicalId,
  canonicalTypeName,
  isCoreNamespace,
  toStorageType,
  sameType,
} from '../shared/slide-types/type-id.js';

describe('parseTypeId', () => {
  it('parses a bare name into the core namespace', () => {
    assert.deepEqual(parseTypeId('title-slide'), {
      namespace: CORE_NAMESPACE,
      name: 'title-slide',
      version: null,
    });
  });
  it('parses a namespaced id', () => {
    assert.deepEqual(parseTypeId('acme/hero'), {
      namespace: 'acme',
      name: 'hero',
      version: null,
    });
  });
  it('parses a namespaced id with a version', () => {
    assert.deepEqual(parseTypeId('acme/hero@2.1'), {
      namespace: 'acme',
      name: 'hero',
      version: '2.1',
    });
  });
  it('parses a core name with a version', () => {
    assert.deepEqual(parseTypeId('content-slide@3'), {
      namespace: CORE_NAMESPACE,
      name: 'content-slide',
      version: '3',
    });
  });
  it('trims whitespace', () => {
    assert.deepEqual(parseTypeId('  acme/hero  '), {
      namespace: 'acme',
      name: 'hero',
      version: null,
    });
  });
  it('throws on empty, malformed, or over-slashed input', () => {
    assert.throws(() => parseTypeId(''));
    assert.throws(() => parseTypeId('  '));
    assert.throws(() => parseTypeId('a/b/c'));
    assert.throws(() => parseTypeId('Acme/Hero')); // uppercase not allowed
    assert.throws(() => parseTypeId('acme/'));
    assert.throws(() => parseTypeId('/hero'));
    assert.throws(() => parseTypeId('acme/hero@')); // empty version
    assert.throws(() => parseTypeId('-bad/name')); // leading hyphen
  });

  it('parses a reverse-DNS id, folding the core authority back to core', () => {
    assert.deepEqual(parseTypeId(`${CORE_AUTHORITY}.title`), {
      namespace: CORE_NAMESPACE,
      name: 'title',
      version: null,
    });
    assert.deepEqual(parseTypeId(`${CORE_AUTHORITY}.title@2`), {
      namespace: CORE_NAMESPACE,
      name: 'title',
      version: '2',
    });
    assert.deepEqual(parseTypeId(`${CORE_AUTHORITY}/title`), {
      namespace: CORE_NAMESPACE,
      name: 'title',
      version: null,
    });
  });

  it('parses a third-party reverse-DNS id, authority intact', () => {
    assert.deepEqual(parseTypeId('nl.ciiic.slide.hero'), {
      namespace: 'nl.ciiic.slide',
      name: 'hero',
      version: null,
    });
    assert.deepEqual(parseTypeId('nl.ciiic.slide/hero'), {
      namespace: 'nl.ciiic.slide',
      name: 'hero',
      version: null,
    });
  });

  it('refuses a two-label dotted id — an authority needs two labels', () => {
    // Otherwise `a.b` is ambiguous: authority `a` plus name `b`, or a
    // one-label authority that is really just a name with a dot in it.
    assert.throws(() => parseTypeId('a.b'));
    assert.throws(() => parseTypeId('eu.deckyard'));
    assert.throws(() => parseTypeId('a..b'));
    assert.throws(() => parseTypeId('.a.b'));
    assert.throws(() => parseTypeId('a.b.'));
  });
});

describe('canonicalTypeName', () => {
  it('drops the historical -slide suffix, and is idempotent', () => {
    assert.equal(canonicalTypeName('title-slide'), 'title');
    assert.equal(canonicalTypeName('custom-html-slide'), 'custom-html');
    assert.equal(canonicalTypeName('title'), 'title');
    assert.equal(canonicalTypeName(canonicalTypeName('end-slide')), 'end');
  });
  it('leaves a name that is only the suffix alone', () => {
    assert.equal(canonicalTypeName('-slide'), '-slide');
    assert.equal(canonicalTypeName(''), '');
  });
});

describe('formatCanonicalId', () => {
  it('gives a core type the core authority, suffix dropped', () => {
    assert.equal(
      formatCanonicalId({ namespace: CORE_NAMESPACE, name: 'title-slide' }),
      'eu.deckyard.slide.title'
    );
    assert.equal(formatCanonicalId({ name: 'end-slide' }), 'eu.deckyard.slide.end');
    assert.equal(
      formatCanonicalId({ namespace: CORE_NAMESPACE, name: 'title-slide', version: '2' }),
      'eu.deckyard.slide.title@2'
    );
  });
  it('keeps a declared authority and leaves its names alone', () => {
    // The suffix rule is a fact about core's own key history, not a rule we
    // impose on anyone else's naming.
    assert.equal(
      formatCanonicalId({ namespace: 'nl.ciiic.slide', name: 'hero-slide' }),
      'nl.ciiic.slide.hero-slide'
    );
  });
  it('falls back to the slash form without an authority to build on', () => {
    assert.equal(formatCanonicalId({ namespace: 'acme', name: 'hero' }), 'acme/hero');
    assert.equal(formatCanonicalId({ namespace: 'custom', name: 'x', version: '3' }), 'custom/x@3');
  });
  it('round-trips through parseTypeId', () => {
    for (const ref of [
      'eu.deckyard.slide.title',
      'eu.deckyard.slide.title@2.1',
      'nl.ciiic.slide.hero',
      'acme/hero',
    ]) {
      assert.equal(formatCanonicalId(parseTypeId(ref)), ref);
    }
  });
});

describe('tryParseTypeId', () => {
  it('returns null instead of throwing on bad input', () => {
    assert.equal(tryParseTypeId('a/b/c'), null);
    assert.equal(tryParseTypeId(''), null);
  });
  it('returns the parse on good input', () => {
    assert.deepEqual(tryParseTypeId('x'), {
      namespace: CORE_NAMESPACE,
      name: 'x',
      version: null,
    });
  });
});

describe('formatTypeId', () => {
  it('is always explicit about the namespace', () => {
    assert.equal(formatTypeId({ namespace: 'core', name: 'title-slide', version: null }), 'core/title-slide');
    assert.equal(formatTypeId({ namespace: 'acme', name: 'hero', version: '2' }), 'acme/hero@2');
  });
  it('round-trips through parseTypeId', () => {
    for (const ref of ['core/title-slide', 'acme/hero', 'acme/hero@2.1']) {
      assert.equal(formatTypeId(parseTypeId(ref)), ref);
    }
  });
  it('defaults a missing namespace to core', () => {
    assert.equal(formatTypeId({ name: 'x' }), 'core/x');
  });
});

describe('isCoreNamespace', () => {
  it('treats bare/core as core and fork namespaces as non-core', () => {
    assert.equal(isCoreNamespace(parseTypeId('title-slide')), true);
    assert.equal(isCoreNamespace(parseTypeId('core/title-slide')), true);
    assert.equal(isCoreNamespace(parseTypeId('acme/hero')), false);
  });
});

describe('toStorageType', () => {
  it('drops the core namespace and version to the bare key', () => {
    assert.equal(toStorageType('title-slide'), 'title-slide');
    assert.equal(toStorageType('core/title-slide'), 'title-slide');
    assert.equal(toStorageType('content-slide@3'), 'content-slide');
  });
  it('keeps a fork namespace (no bare form exists)', () => {
    assert.equal(toStorageType('acme/hero'), 'acme/hero');
    assert.equal(toStorageType('acme/hero@2'), 'acme/hero');
  });
  it('accepts an already-parsed id', () => {
    assert.equal(toStorageType(parseTypeId('core/x')), 'x');
  });
});

describe('sameType', () => {
  it('ignores version when comparing identity', () => {
    assert.equal(sameType('acme/hero@1', 'acme/hero@2'), true);
    assert.equal(sameType('title-slide', 'core/title-slide'), true);
  });
  it('treats all three core spellings as one type', () => {
    assert.equal(sameType('title-slide', 'eu.deckyard.slide.title'), true);
    assert.equal(sameType('eu.deckyard.slide.title', 'core/title'), true);
    assert.equal(sameType('title', 'title-slide'), true);
    assert.equal(sameType('title-slide', 'eu.deckyard.slide.quote'), false);
  });
  it('does not apply the suffix rule outside core', () => {
    assert.equal(sameType('acme/hero', 'acme/hero-slide'), false);
  });
  it('distinguishes namespace and name', () => {
    assert.equal(sameType('acme/hero', 'other/hero'), false);
    assert.equal(sameType('acme/hero', 'acme/banner'), false);
  });
  it('is false on malformed input', () => {
    assert.equal(sameType('a/b/c', 'a/b/c'), false);
  });
});
