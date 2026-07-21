/**
 * Pure-logic tests for the floating selection toolbar (editing-surfaces text
 * phase, step 2): placement math, the no-nested-emphasis button state, and
 * the slide-dialect link-URL gate.
 *
 * Run with: node --test tests/inline-selection-toolbar.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  computeToolbarPlacement,
  emphasisDisables,
  slideLinkUrl,
} from '../client/views/editor/inline-edit/selection-toolbar-logic.js';

const host = { left: 100, top: 50, width: 800, height: 450 };
const size = { width: 120, height: 32 };

describe('computeToolbarPlacement', () => {
  it('centers above the selection with the default gap', () => {
    const sel = { left: 400, top: 250, width: 200, height: 20 };
    const p = computeToolbarPlacement({ sel, host, size });
    // selection center x = (400-100) + 100 = 400 → left = 400 - 60
    assert.deepEqual(p, { left: 340, top: 250 - 50 - 32 - 8, below: false });
  });

  it('clamps to the left edge for selections near the left border', () => {
    const sel = { left: 105, top: 250, width: 20, height: 20 };
    const p = computeToolbarPlacement({ sel, host, size });
    assert.equal(p.left, 4);
  });

  it('clamps to the right edge for selections near the right border', () => {
    const sel = { left: 880, top: 250, width: 15, height: 20 };
    const p = computeToolbarPlacement({ sel, host, size });
    assert.equal(p.left, host.width - size.width - 4);
  });

  it('flips below the selection when there is no room above', () => {
    const sel = { left: 400, top: 60, width: 200, height: 20 };
    const p = computeToolbarPlacement({ sel, host, size });
    assert.equal(p.below, true);
    assert.equal(p.top, 60 - 50 + 20 + 8);
  });

  it('returns null for an empty selection rect', () => {
    assert.equal(
      computeToolbarPlacement({
        sel: { left: 400, top: 250, width: 0, height: 0 },
        host,
        size,
      }),
      null
    );
    assert.equal(computeToolbarPlacement({ sel: null, host, size }), null);
  });
});

describe('emphasisDisables (dialect cannot nest emphasis)', () => {
  it('disables Bold inside italic-only text', () => {
    assert.deepEqual(emphasisDisables({ insideEm: true }), {
      bold: true,
      italic: false,
    });
  });

  it('disables Italic inside bold-only text', () => {
    assert.deepEqual(emphasisDisables({ insideStrong: true }), {
      bold: false,
      italic: true,
    });
  });

  it('disables nothing in unstyled text', () => {
    assert.deepEqual(emphasisDisables({}), { bold: false, italic: false });
  });

  it('allows both toggles inside already-nested emphasis (un-nesting out)', () => {
    assert.deepEqual(emphasisDisables({ insideEm: true, insideStrong: true }), {
      bold: false,
      italic: false,
    });
  });
});

describe('slideLinkUrl (serializer keeps http/https only)', () => {
  it('accepts http and https', () => {
    assert.equal(slideLinkUrl('https://example.com/x'), 'https://example.com/x');
    assert.equal(slideLinkUrl('  http://example.com  '), 'http://example.com');
    assert.equal(slideLinkUrl('HTTPS://EXAMPLE.COM'), 'HTTPS://EXAMPLE.COM');
  });

  it('rejects schemes the serializer would degrade to bare text', () => {
    for (const url of [
      'mailto:a@b.c',
      'javascript:alert(1)',
      'data:text/html,x',
      'vbscript:x',
      'ftp://example.com',
      '//example.com',
      'example.com',
    ]) {
      assert.equal(slideLinkUrl(url), null, url);
    }
  });

  it('rejects control-character smuggling and empty input', () => {
    assert.equal(slideLinkUrl('java\nscript:alert(1)'), null);
    assert.equal(slideLinkUrl('http://exa mple.com'), null);
    assert.equal(slideLinkUrl('http://exa\tmple.com'), null);
    assert.equal(slideLinkUrl(''), null);
    assert.equal(slideLinkUrl(null), null);
  });
});
