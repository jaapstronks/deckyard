/**
 * Tests for core/custom slide-type collision detection (PR 6, move 4).
 *
 * A custom (fork) slide type must not silently shadow a core type: it may only
 * replace core when it declares `override: true`. Otherwise the core type is
 * kept and a warning is logged. mergeSlideTypes is the pure merge used by the
 * registry; testing it directly avoids needing filesystem custom types.
 *
 * Run with: node --test tests/slide-type-collision.test.js
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

import { mergeSlideTypes } from '../shared/slide-types/registry.js';

const core = {
  'title-slide': { label: 'Core title', core: true },
  'content-slide': { label: 'Core content', core: true },
};

describe('mergeSlideTypes', () => {
  it('adds a non-colliding custom type', () => {
    const merged = mergeSlideTypes(core, { 'acme-hero': { label: 'Hero' } });
    assert.equal(merged['acme-hero'].label, 'Hero');
    assert.equal(merged['title-slide'].core, true); // core untouched
  });

  it('refuses to shadow core without an override flag (core wins)', () => {
    const warn = mock.method(console, 'warn', () => {});
    const merged = mergeSlideTypes(core, {
      'title-slide': { label: 'Fork title (no flag)' },
    });
    assert.equal(merged['title-slide'].core, true, 'core must be kept');
    assert.equal(merged['title-slide'].label, 'Core title');
    assert.ok(warn.mock.calls.length >= 1, 'a warning must be logged');
    warn.mock.restore();
  });

  it('honours an explicit override:true (custom wins)', () => {
    const log = mock.method(console, 'log', () => {});
    const merged = mergeSlideTypes(core, {
      'title-slide': { label: 'Fork title', override: true },
    });
    assert.equal(merged['title-slide'].label, 'Fork title');
    assert.equal(merged['title-slide'].override, true);
    assert.ok(log.mock.calls.length >= 1, 'an intentional-override note is logged');
    log.mock.restore();
  });

  it('does not mutate the core map', () => {
    const snapshot = JSON.stringify(core);
    mergeSlideTypes(core, { 'title-slide': { label: 'x', override: true } });
    assert.equal(JSON.stringify(core), snapshot);
  });
});
