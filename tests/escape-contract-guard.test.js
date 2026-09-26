/**
 * The Escape contract (B472): one press peels one layer.
 *
 * `client/lib/dom/escape.js` holds the contract: every handler that acts on
 * Escape goes through `takeEscape(e)`, which reads the mark a layer before it
 * left (`defaultPrevented`) and marks the press before its caller acts. A
 * transient layer that listens on `document` does so in the capture phase, so
 * it hears the key before the standing surface it opened over. Before B472 the
 * handlers came in three shapes — mark, read, `stopPropagation()` — and a
 * handler that did none of them closed its layer *and* the one under it (the
 * slide context menu in the narrow slides drawer).
 *
 * Two guards over source, both without an allowlist:
 *
 *  1. no `'Escape'` literal in `client/` outside escape.js — a handler that
 *     compares the key itself is the shape that forgets to read or mark;
 *  2. no `stopPropagation()` inside a `takeEscape` branch — the second form
 *     the mark replaced.
 *
 * And the live case, driven in jsdom: the slide context menu over the open
 * slides drawer.
 *
 * Run with: node --test tests/escape-contract-guard.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const CONTRACT = 'client/lib/dom/escape.js';

/** Every client source file, repo-relative, vendored code left out. */
function clientSources() {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(path.join(repoRoot, dir), {
      withFileTypes: true,
    })) {
      const rel = `${dir}/${ent.name}`;
      if (ent.isDirectory()) {
        if (ent.name === 'vendor' || ent.name === 'node_modules') continue;
        walk(rel);
      } else if (ent.name.endsWith('.js') && !ent.name.endsWith('.min.js')) {
        out.push(rel);
      }
    }
  };
  walk('client');
  return out;
}

/** Source with comments blanked, so prose about Escape does not count. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/**
 * The body of every `takeEscape(...)` branch: the braced block after the `if`
 * condition it sits in, or the rest of the statement when there is no brace.
 * @param {string} src - Comment-free source.
 * @returns {string[]}
 */
function takeEscapeBranches(src) {
  const bodies = [];
  const re = /takeEscape\(/g;
  let m;
  while ((m = re.exec(src))) {
    // Close the condition: walk to the `)` that balances the enclosing `if (`.
    let i = m.index;
    let depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth < 0) break;
      }
    }
    let j = i + 1;
    while (/\s/.test(src[j] || '')) j++;
    if (src[j] === '{') {
      let d = 0;
      let k = j;
      for (; k < src.length; k++) {
        if (src[k] === '{') d++;
        else if (src[k] === '}' && --d === 0) break;
      }
      bodies.push(src.slice(j, k + 1));
    } else {
      const eol = src.indexOf('\n', j);
      bodies.push(src.slice(j, eol === -1 ? src.length : eol));
    }
  }
  return bodies;
}

test('guard: no handler compares the Escape key itself (B472)', () => {
  const offenders = [];
  for (const rel of clientSources()) {
    if (rel === CONTRACT) continue;
    const src = code(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
    src.split('\n').forEach((line, i) => {
      if (/['"`]Escape['"`]/.test(line))
        offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'Escape goes through takeEscape() from client/lib/dom/escape.js, which ' +
      'reads the mark and sets it; a bare key comparison is the shape that ' +
      'closes two layers with one press:\n  ' +
      offenders.join('\n  '),
  );
});

test('guard: no stopPropagation() in an Escape branch (B472)', () => {
  const offenders = [];
  for (const rel of clientSources()) {
    const src = code(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
    for (const body of takeEscapeBranches(src)) {
      if (/stopPropagation\s*\(/.test(body))
        offenders.push(`${rel}: ${body.replace(/\s+/g, ' ').slice(0, 100)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'the mark (preventDefault, set by takeEscape) is the one signal a layer ' +
      'leaves; stopPropagation is the second form B472 removed:\n  ' +
      offenders.join('\n  '),
  );
});

test('guard: the branch finder sees both branch shapes', () => {
  // The stopPropagation guard is only as good as its parser.
  const src = [
    'if (takeEscape(e)) { e.stopPropagation(); close(); }',
    'if (open && takeEscape(e)) finish(false);',
  ].join('\n');
  assert.deepEqual(takeEscapeBranches(src), [
    '{ e.stopPropagation(); close(); }',
    'finish(false);',
  ]);
});

// ------------------------------------------------------------ the live case

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = clearTimeout;

const { takeEscape } = await import('../client/lib/dom/escape.js');
const { createResponsiveDrawers } =
  await import('../client/views/editor/responsive-drawers.js');
const { showSlideContextMenu, closeSlideContextMenu } =
  await import('../client/views/editor/slide-list/context-menu.js');

const pressEscape = (target = document.body) => {
  const ev = new dom.window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(ev);
  return ev;
};

test('takeEscape reads the mark, then sets it', () => {
  const ev = new dom.window.KeyboardEvent('keydown', {
    key: 'Escape',
    cancelable: true,
  });
  assert.equal(takeEscape(ev), true, 'a free press is taken');
  assert.equal(ev.defaultPrevented, true, 'and marked');
  assert.equal(takeEscape(ev), false, 'a marked press is left alone');
  const other = new dom.window.KeyboardEvent('keydown', {
    key: 'Enter',
    cancelable: true,
  });
  assert.equal(takeEscape(other), false, 'another key is never taken');
  assert.equal(other.defaultPrevented, false);
});

test('one Escape closes the slide context menu, the next the slides drawer', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const drawers = createResponsiveDrawers({ root });
  const html = document.documentElement;
  try {
    drawers.openSlidesDrawer();
    // Opened after the drawer mounted: its listener is the later one.
    showSlideContextMenu({
      x: 10,
      y: 10,
      slide: { id: 's1' },
      ids: new Set(['s1']),
      ctx: {},
    });
    assert.ok(document.querySelector('.slide-context-menu'), 'menu is open');

    pressEscape();
    assert.equal(
      document.querySelector('.slide-context-menu'),
      null,
      'the first press closes the menu',
    );
    assert.ok(
      html.classList.contains('is-slides-drawer-open'),
      'and leaves the drawer it opened over',
    );

    pressEscape();
    assert.equal(
      html.classList.contains('is-slides-drawer-open'),
      false,
      'the second press closes the drawer',
    );
  } finally {
    closeSlideContextMenu();
    drawers.detach();
    root.remove();
  }
});
