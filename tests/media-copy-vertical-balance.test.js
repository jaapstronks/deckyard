/**
 * Copy beside an image balances on the column's vertical middle.
 *
 * image-text's split and image-set's beside layout put the copy in a column
 * next to the image. That copy is vertically centred (with `safe`, so copy
 * taller than the column falls back to the top instead of clipping the title).
 * The layouts whose copy hangs from something keep the top: image-text's corner
 * (the title lines up with the corner image, the empty bottom row is the design)
 * and image-set's row layouts (the copy sits under or above a full-width strip).
 *
 * The rule lives in CSS only, so this pins the declarations per selector.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SLIDES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'client/styles/slides/01-layout-and-title',
);

/** Every `justify-content` value declared in a rule with exactly this selector. */
function justifyContentFor(file, selector) {
  const css = fs
    .readFileSync(path.join(SLIDES_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const values = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim() !== selector) continue;
    const decl = m[2].match(/justify-content:\s*([^;]+);/);
    if (decl) values.push(decl[1].trim());
  }
  return values;
}

test('image-text: split copy is centred, corner copy keeps the top', () => {
  assert.deepEqual(
    justifyContentFor('50-image-text-slide.css', '.slide-image-text .copy'),
    ['safe center'],
  );
  assert.deepEqual(
    justifyContentFor(
      '50-image-text-slide.css',
      '.slide-image-text.is-layout-corner .copy',
    ),
    ['flex-start'],
  );
});

test('image-set: beside copy is centred, row layouts keep the top', () => {
  assert.deepEqual(
    justifyContentFor('55-image-set-slide.css', '.slide-image-set .copy'),
    ['flex-start'],
  );
  assert.deepEqual(
    justifyContentFor(
      '55-image-set-slide.css',
      '.slide-image-set.is-layout-beside .copy',
    ),
    ['safe center'],
  );
});
