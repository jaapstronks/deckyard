/**
 * Tests for the slide-type identity model (`namespace/name[@version]`).
 *
 * Run with: node --test tests/slide-type-id.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  CORE_NAMESPACE,
  parseTypeId,
  tryParseTypeId,
  formatTypeId,
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
  it('distinguishes namespace and name', () => {
    assert.equal(sameType('acme/hero', 'other/hero'), false);
    assert.equal(sameType('acme/hero', 'acme/banner'), false);
  });
  it('is false on malformed input', () => {
    assert.equal(sameType('a/b/c', 'a/b/c'), false);
  });
});
