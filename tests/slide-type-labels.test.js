/**
 * Every core slide type has a published English and Dutch name under one key
 * (B322). deckyard.eu reads these for its `/` and `/nl/` slide-type pages.
 *
 * Run with: node --test tests/slide-type-labels.test.js
 *
 * @see server/utils/slide-type-labels.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CORE_SLIDE_TYPE_NAMES,
  SLIDE_TYPES,
} from '../shared/slide-types/registry.js';
import {
  SLIDE_TYPE_LABEL_LOCALES,
  coreSlideTypeLabels,
} from '../server/utils/slide-type-labels.js';

describe('coreSlideTypeLabels', () => {
  const labels = coreSlideTypeLabels();

  it('covers exactly the core types', () => {
    assert.deepEqual(Object.keys(labels), [...CORE_SLIDE_TYPE_NAMES]);
  });

  it('carries exactly en and nl per type', () => {
    assert.deepEqual(SLIDE_TYPE_LABEL_LOCALES, ['en', 'nl']);
    for (const [name, entry] of Object.entries(labels)) {
      assert.deepEqual(Object.keys(entry), ['en', 'nl'], name);
    }
  });

  it('takes en from the registry label', () => {
    for (const name of CORE_SLIDE_TYPE_NAMES) {
      assert.equal(labels[name].en, SLIDE_TYPES[name].label, name);
    }
  });

  it('has a non-empty Dutch name for every core type', () => {
    for (const name of CORE_SLIDE_TYPE_NAMES) {
      const nl = labels[name].nl;
      assert.equal(typeof nl, 'string', name);
      assert.ok(nl.trim(), `${name} has an empty Dutch name`);
    }
  });
});
