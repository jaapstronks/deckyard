/**
 * The editor topbar's fold ladder is wired in two places at once, and the
 * failure it replaces was exactly that the two drifted apart (B354): the
 * stylesheet still hid a `.sb-segmented` language switch that the markup had
 * stopped building, and mirrored a theme toggle into the ⋯ menu only below
 * 1024px although the bar had no theme control at any width — so a desktop
 * had no way to change theme at all.
 *
 * `.topbar-fold-<rung>` marks both halves of one control: the element in the
 * bar and its counterpart in the ⋯ menu. This test pins the shape of that
 * pairing, not the pixel budget (a budget needs a browser; the measurements
 * live in the stylesheet's own comment):
 *
 * 1. Every rung used in the markup is one of the documented ones.
 * 2. Each used rung declares all three of its rules, in the right query.
 * 3. No element claims two rungs — a control folds at one width, or not.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CSS_FILE = 'client/styles/base/01-core/10-shell-topbar-dropdown.css';
const JS_ROOTS = ['client/views/editor'];

/** The rung → `max-width` it folds at. Must stay on the documented ladder. */
const RUNGS = { xl: 1280, lg: 1024, md: 768, sm: 640 };

/** @returns {string[]} every `.js` file under `dir`, recursively. */
function jsFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const css = readFileSync(CSS_FILE, 'utf8');
const sources = JS_ROOTS.flatMap(jsFilesUnder).map((file) => ({
  file,
  text: readFileSync(file, 'utf8'),
}));

test('every fold rung in the markup is one of the documented rungs', () => {
  for (const { file, text } of sources) {
    for (const [, rung] of text.matchAll(/topbar-fold-([a-z]+)/g)) {
      assert.ok(
        rung in RUNGS,
        `${file} folds at "${rung}", which is not on the ladder (${Object.keys(RUNGS).join(', ')})`,
      );
    }
  }
});

test('each used rung declares both halves inside its own media query', () => {
  const used = new Set(
    sources.flatMap(({ text }) =>
      [...text.matchAll(/topbar-fold-([a-z]+)/g)].map((m) => m[1]),
    ),
  );
  assert.ok(used.size > 0, 'no fold classes found — did the topbar move?');

  for (const rung of used) {
    const width = RUNGS[rung];

    // The ⋯ counterpart is hidden by default: above its rung the bar shows the
    // control, and a menu entry beside it would be the same action twice.
    assert.match(
      css,
      new RegExp(
        `\\.dropdown-menu > \\.topbar-fold-${rung},?[^{]*\\{[^}]*display:\\s*none`,
      ),
      `${rung}: the ⋯ counterpart is not hidden by default`,
    );

    // Both halves flip inside one query, so they cannot flip at different
    // widths and leave the control in the bar and the menu at once — or in
    // neither, which is how an action becomes unreachable.
    const query = mediaBlock(css, width);
    assert.ok(query, `${rung}: no "@media (max-width: ${width}px)" block`);
    assert.match(
      query,
      new RegExp(
        `\\.topbar > \\.topbar-fold-${rung}\\s*\\{[^}]*display:\\s*none`,
      ),
      `${rung}: the bar half is not hidden at ≤${width}px`,
    );
    assert.match(
      query,
      new RegExp(
        `\\.dropdown-menu > \\.topbar-fold-${rung}\\s*\\{[^}]*display:\\s*flex`,
      ),
      `${rung}: the ⋯ counterpart is not shown at ≤${width}px`,
    );
  }
});

test('no element claims two rungs', () => {
  for (const { file, text } of sources) {
    for (const [, classList] of text.matchAll(/class:\s*'([^']*)'/g)) {
      const rungs = [...classList.matchAll(/topbar-fold-([a-z]+)/g)];
      assert.ok(
        rungs.length <= 1,
        `${file}: "${classList}" folds at ${rungs.length} widths at once`,
      );
    }
  }
});

/**
 * Every `@media (max-width: <width>px)` block in `text`, concatenated and
 * brace-matched so nested rules come along. A regex cannot do this on its
 * own: a block contains braces of its own. All of them, not the first —
 * nothing stops a second query at the same width further down the file.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string|null} null when the file has no query at that width
 */
function mediaBlock(text, width) {
  const head = `@media (max-width: ${width}px) {`;
  const blocks = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(head, from);
    if (start === -1) break;
    let depth = 0;
    for (let i = start + head.length - 1; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          blocks.push(text.slice(start, i + 1));
          from = i + 1;
          break;
        }
      }
    }
    if (from <= start) break;
  }
  return blocks.length ? blocks.join('\n') : null;
}
