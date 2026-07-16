/**
 * Logo-wall rendering: background colour option, the raised 30-logo cap and
 * the fluid grid tiers beyond 12 logos.
 *
 * Run with: node --test tests/logo-wall-render.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { renderSlideHtml, validateSlide } from '../shared/slide-types/presentation.js';
import { MAX_LOGOS } from '../shared/slide-types/types/logo-wall-slide.js';

function makeLogos(n) {
  return Array.from({ length: n }, (_v, i) => ({ name: `Logo ${i + 1}` }));
}

function render(content, ctx = {}) {
  return renderSlideHtml({ type: 'logo-wall-slide', content }, ctx);
}

describe('logo-wall background', () => {
  it('defaults to mist (historical look) when no background is set', () => {
    const html = render({ title: 'Partners', logos: makeLogos(4) });
    assert.match(html, /slide-logo-wall slide-bg-mist/);
  });

  it('honours the lime background option', () => {
    const html = render({ logos: makeLogos(4), background: 'lime' });
    assert.match(html, /slide-logo-wall slide-bg-lime/);
  });

  it('honours a theme-defined variant id', () => {
    const html = render({ logos: makeLogos(4), background: 'calm' });
    assert.match(html, /slide-logo-wall slide-bg-calm/);
  });

  it('validates a slide with a background value', () => {
    const errors = validateSlide({
      id: crypto.randomUUID(),
      type: 'logo-wall-slide',
      content: { title: 'x', background: 'mist', logos: makeLogos(3) },
    });
    assert.deepEqual(errors, []);
  });
});

describe('logo-wall counts and fluid grid', () => {
  it('keeps the CSS tiers (no fluid grid) up to 12 logos', () => {
    const html = render({ logos: makeLogos(12) });
    assert.match(html, /data-logo-count="12"/);
    assert.doesNotMatch(html, /is-fluid/);
    assert.doesNotMatch(html, /--lw-cols/);
  });

  it('switches to a fluid 7-column grid beyond 12 logos', () => {
    const html = render({ logos: makeLogos(20) });
    assert.match(html, /data-logo-count="20"/);
    assert.match(html, /is-fluid/);
    assert.match(html, /--lw-cols: 7; --lw-rows: 3;/);
  });

  it('uses 8 columns for the top tier', () => {
    const html = render({ logos: makeLogos(30) });
    assert.match(html, /--lw-cols: 8; --lw-rows: 4;/);
  });

  it('caps rendering at MAX_LOGOS', () => {
    const html = render({ logos: makeLogos(MAX_LOGOS + 5) });
    assert.match(html, new RegExp(`data-logo-count="${MAX_LOGOS}"`));
  });

  it('validates a wall with 30 logos', () => {
    const errors = validateSlide({
      id: crypto.randomUUID(),
      type: 'logo-wall-slide',
      content: { title: 'x', logos: makeLogos(30) },
    });
    assert.deepEqual(errors, []);
  });
});
