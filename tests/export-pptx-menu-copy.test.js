import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { PIXEL_PERFECT_HANDLER_TYPES } from '../server/export/pptx.js';

/**
 * The two PowerPoint rows in the export menu promise what each file hands back
 * (B321, D141, D307).
 *
 * The pixel-perfect row: every slide but video travels as one picture
 * (`docs/reference/export-menu.md` § What the PPTX hands back), and video plays.
 * The copy is pinned to the handlers that declare `pixelPerfect` in the
 * export's own map, not only to today's sentence: the day the pixel-perfect
 * file composes a second type natively, this test fails and whoever adds it
 * rewrites the row in the same PR. A handler that serves only the editable
 * file (image-slide, B588) leaves this list alone. The
 * editable row promises editable text and pictures as far as the type allows;
 * which slides did not make it is said after the export, not in the row.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function editorCopy(locale, key = 'editor.export.descPptx') {
  const path = resolve(root, 'client/i18n', locale, 'editor.json');
  return JSON.parse(readFileSync(path, 'utf8'))[key];
}

test('the pixel-perfect PPTX still writes only video natively', () => {
  assert.deepEqual(
    [...PIXEL_PERFECT_HANDLER_TYPES],
    ['video-slide'],
    'The pixel-perfect file composes a second type natively: it no longer hands back ' +
      'every other slide as an image. Rewrite editor.export.descPptx in every ' +
      'locale (and the fallback in client/views/editor/export-modal.js) to say ' +
      'what the file now holds, then update this pin.',
  );
});

test('the pixel-perfect row says each slide is an image and video plays, in en and nl', () => {
  assert.equal(
    editorCopy('en'),
    'Pixel-perfect: every slide as an image, videos play',
  );
  assert.equal(
    editorCopy('nl'),
    "Pixel-perfect: elke slide als beeld, video's spelen af",
  );
});

test('the editable row is its own row, in en and nl', () => {
  assert.equal(
    editorCopy('en', 'editor.export.pptxEditable'),
    'PowerPoint, editable',
  );
  assert.equal(
    editorCopy('nl', 'editor.export.pptxEditable'),
    'PowerPoint, bewerkbaar',
  );
});

test('the in-code fallback is the en copy', () => {
  const src = readFileSync(
    resolve(root, 'client/views/editor/export-modal.js'),
    'utf8',
  );
  assert.match(
    src,
    /t\(\s*'editor\.export\.descPptx',\s*'Pixel-perfect: every slide as an image, videos play',?\s*\)/,
  );
});
