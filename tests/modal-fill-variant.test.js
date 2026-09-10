/**
 * One name for "the dialog owns its height".
 *
 * `.modal-content` is capped at 70vh and scrolls, which is right for a form
 * and wrong for a grid, an editor or an iframe: the flex chain stops at the
 * wrapper and the cap bites two levels above whatever should be growing.
 * Eleven dialogs used to undo that themselves, in ten stylesheets and about as
 * many spellings, and the load order forced four of them to double up as
 * `.modal-content.<class>` to win. A fork building the same kind of dialog hit
 * both halves of it in one evening (ciiic-slides #133, #134).
 *
 * `createModal({ fill: true })` is that one name. These pin the class it sets
 * and gate the re-derivation: no stylesheet outside the modal base layer may
 * lift the cap on `.modal-content` again.
 *
 * Run with: node --test tests/modal-fill-variant.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const BASE_LAYER = path.join(
  repoRoot,
  'client/styles/base/04-editor-and-misc/10-modals-base.css',
);

/** @returns {string[]} every .css file under `dir` */
function cssFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

test('the base layer owns both shapes of .modal-content', () => {
  const css = readFileSync(BASE_LAYER, 'utf8');
  assert.match(
    css,
    /\.modal-content\s*\{[^}]*max-height:\s*70vh/,
    'the default: as tall as its content, capped, scrolling',
  );
  assert.match(
    css,
    /\.modal\.is-fill\s*>\s*\.modal-content\s*\{[^}]*max-height:\s*none/,
    'the fill variant: the dialog owns the height, the body fills it',
  );
});

test('no stylesheet outside the base layer lifts the cap on .modal-content', () => {
  const offenders = [];
  for (const file of cssFiles(path.join(repoRoot, 'client/styles'))) {
    if (file === BASE_LAYER) continue;
    const css = readFileSync(file, 'utf8');
    // Every rule whose selector mentions the content region, in either
    // spelling: `.modal-content`, or a body class the modal's own JS puts on
    // it (`.creation-view-body`, `.ps-lib-edit-body`, …).
    for (const [, selector, body] of css.matchAll(
      /([^{}]*(?:modal-content|-body)[^{}]*)\{([^}]*)\}/g,
    )) {
      if (!/max-height\s*:/.test(body)) continue;
      offenders.push(
        `${path.relative(repoRoot, file)}: ${selector.trim().split('\n').join(' ')}`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'A dialog that needs its own height says so with `fill: true` and a ' +
      '`max-height` on the *dialog*, not by re-deriving the content region: ' +
      offenders.join(' | '),
  );
});

test('the load-order workaround is gone', () => {
  const offenders = [];
  for (const file of cssFiles(path.join(repoRoot, 'client/styles'))) {
    const css = readFileSync(file, 'utf8');
    if (/\.modal-content\.[a-z-]/i.test(css)) {
      offenders.push(path.relative(repoRoot, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    '`.modal-content.<class>` only existed to out-specify the base layer from ' +
      `a file that loads earlier. \`.modal.is-fill > .modal-content\` wins on ` +
      `specificity regardless of order: ${offenders.join(', ')}`,
  );
});
