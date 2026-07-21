/**
 * Tests for the slide-type identity layer on the registry (PR 6, move 4):
 * the getSlideType resolver, SLIDE_TYPE_IDS, getSlideTypeId, and the
 * collectSlideTypeManifest deck stamp. Collision detection between core and
 * custom types is exercised in tests/slide-type-collision.test.js (which loads
 * the merge helper in isolation, since custom types are filesystem-loaded).
 *
 * Run with: node --test tests/slide-type-registry-identity.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  SLIDE_TYPES,
  SLIDE_TYPE_IDS,
  getSlideType,
  getSlideTypeId,
  collectSlideTypeManifest,
} from '../shared/slide-types/registry.js';

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

describe('SLIDE_TYPE_IDS / getSlideTypeId', () => {
  it('gives every registered type a core-namespaced id by default', () => {
    for (const name of Object.keys(SLIDE_TYPES)) {
      const id = SLIDE_TYPE_IDS[name];
      assert.ok(typeof id === 'string' && id.includes('/'), `${name} -> ${id}`);
    }
  });
  it('core types resolve to core/<name>', () => {
    assert.equal(getSlideTypeId('title-slide'), 'core/title-slide');
    assert.equal(getSlideTypeId('content-slide'), 'core/content-slide');
  });
  it('returns undefined for an unknown name', () => {
    assert.equal(getSlideTypeId('no-such-slide'), undefined);
  });
});

describe('collectSlideTypeManifest', () => {
  it('maps each used bare type to its identity, de-duplicated', () => {
    const slides = [
      { type: 'title-slide' },
      { type: 'content-slide' },
      { type: 'content-slide' },
    ];
    assert.deepEqual(collectSlideTypeManifest(slides), {
      'title-slide': 'core/title-slide',
      'content-slide': 'core/content-slide',
    });
  });
  it('ignores slides without a usable type', () => {
    assert.deepEqual(collectSlideTypeManifest([{}, { type: '' }, { type: 5 }]), {});
    assert.deepEqual(collectSlideTypeManifest(null), {});
  });
  it('still records an unknown type under the core namespace (informational)', () => {
    // A manifest should faithfully report what a deck references even if the
    // current registry lacks the definition.
    assert.deepEqual(collectSlideTypeManifest([{ type: 'ghost-slide' }]), {
      'ghost-slide': 'core/ghost-slide',
    });
  });
});
