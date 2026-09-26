/**
 * Logo-wall rendering: background colour option, the 30-logo cap and the one
 * grid rule that carries every count (B445).
 *
 * Run with: node --test tests/logo-wall-render.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import {
  renderSlideHtml,
  validateSlide,
} from '../shared/slide-types/presentation.js';
import {
  MAX_LOGOS,
  logoWallGrid,
} from '../shared/slide-types/types/logo-wall-slide.js';
import {
  buildScriptChain,
  detectLayoutRuntimeNeeds,
  detectSlideRuntimeNeeds,
} from '../server/utils/script-chain.js';
import { initLogoWallBalance } from '../client/lib/slide-runtime/logo-wall-balance.js';

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

describe('logo-wall grid', () => {
  it('lays every count out by one rule (1-3 one row, 4 2x2, 5-6 3x2, 7-8 4x2, 9+ three rows, max 8 a row)', () => {
    const expected = {
      1: [1, 1],
      2: [2, 1],
      3: [3, 1],
      4: [2, 2],
      5: [3, 2],
      6: [3, 2],
      7: [4, 2],
      8: [4, 2],
      9: [3, 3],
      12: [4, 3],
      13: [5, 3],
      24: [8, 3],
      25: [7, 4],
      30: [8, 4],
    };
    for (const [count, [cols, rows]] of Object.entries(expected)) {
      assert.deepEqual(logoWallGrid(Number(count)), { cols, rows }, `${count}`);
    }
    for (let n = 1; n <= MAX_LOGOS; n++) {
      const { cols, rows } = logoWallGrid(n);
      assert.ok(cols * rows >= n && cols * (rows - 1) < n, `${n} fits`);
      assert.ok(cols <= 8, `${n}: at most 8 to a row`);
    }
  });

  it('writes the grid onto the slide for every count, with no count-specific class', () => {
    for (const n of [2, 5, 6, 12, 20]) {
      const html = render({ logos: makeLogos(n) });
      const { cols, rows } = logoWallGrid(n);
      assert.match(html, new RegExp(`data-logo-count="${n}"`));
      assert.match(html, new RegExp(`--lw-cols: ${cols}; --lw-rows: ${rows};`));
      assert.doesNotMatch(html, /is-fluid/);
    }
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

describe('logo-wall balance runtime', () => {
  it('ships in every document that shows a logo, a static sheet included', () => {
    const html = render(
      { logos: [{ image: '/a.png', name: 'A' }] },
      { stripEditorAttrs: true },
    );
    assert.equal(detectLayoutRuntimeNeeds(html).logoWall, true);
    assert.equal(detectSlideRuntimeNeeds(html).logoWall, true);
    assert.equal(
      detectLayoutRuntimeNeeds(render({ logos: makeLogos(3) })).logoWall,
      false,
      'placeholders only: no ratio to read',
    );

    const sheet = buildScriptChain({
      needs: { prism: false, katex: false },
      slideNeeds: detectLayoutRuntimeNeeds(html),
    });
    assert.match(sheet, /initLogoWallBalance\(document\.body\)/);
    assert.doesNotThrow(
      () =>
        new vm.Script(
          sheet.slice(sheet.indexOf('>') + 1, sheet.lastIndexOf('</')),
        ),
      'the inlined module has to parse as a classic script',
    );
  });

  it('runs on every render surface, thumbnails included', () => {
    const src = readFileSync(
      new URL('../client/lib/slide-runtime/slide-render.js', import.meta.url),
      'utf8',
    );
    const entry = src.match(
      /name: 'logo-wall-balance',[\s\S]*?run: \(el\) => initLogoWallBalance\(el\)/,
    );
    assert.ok(entry, 'slide-render should mount the balance pass');
    assert.doesNotMatch(entry[0], /runsIn/, 'layout, not behaviour');
  });

  it('hands each loaded logo its aspect ratio', () => {
    const set = [];
    const loaded = {
      complete: true,
      naturalWidth: 500,
      naturalHeight: 100,
      style: { setProperty: (k, v) => set.push([k, v]) },
    };
    const listeners = [];
    const pending = {
      complete: false,
      naturalWidth: 0,
      naturalHeight: 0,
      style: { setProperty: (k, v) => set.push([k, v]) },
      addEventListener: (_t, fn) => listeners.push(fn),
      removeEventListener: (_t, fn) =>
        listeners.splice(listeners.indexOf(fn), 1),
    };
    const root = { querySelectorAll: () => [loaded, pending] };
    const detach = initLogoWallBalance(root);
    assert.deepEqual(set, [['--lw-aspect', '5']]);

    Object.assign(pending, { naturalWidth: 200, naturalHeight: 400 });
    listeners[0]();
    assert.deepEqual(set[1], ['--lw-aspect', '0.5']);

    detach();
    assert.equal(listeners.length, 0);
  });
});
