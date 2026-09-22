import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { NATIVE_PPTX_SLIDE_TYPES } from '../server/export/pptx.js';

/**
 * The PPTX row in the export menu promises what the export hands back (B321).
 *
 * Every slide but video travels as one picture (`docs/reference/export-menu.md`
 * § What the PPTX hands back), so the row says so rather than "PowerPoint
 * file", which reads as editable slides. The copy is pinned to the export's
 * own handler map, not only to today's sentence: the day a second native
 * composition lands (B290, layer 0), this test fails and the person adding the
 * mapper rewrites the row in the same PR.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function editorCopy(locale) {
  const path = resolve(root, 'client/i18n', locale, 'editor.json');
  return JSON.parse(readFileSync(path, 'utf8'))['editor.export.descPptx'];
}

test('the PPTX export still writes only video natively', () => {
  assert.deepEqual(
    [...NATIVE_PPTX_SLIDE_TYPES],
    ['video-slide'],
    'A native PPTX composition was added: the export no longer hands back ' +
      'every other slide as an image. Rewrite editor.export.descPptx in every ' +
      'locale (and the fallback in client/views/editor/export-modal.js) to say ' +
      'what the file now holds, then update this pin.',
  );
});

test('the PPTX row says each slide is an image, in en and nl', () => {
  assert.equal(editorCopy('en'), 'PowerPoint, each slide as an image');
  assert.equal(editorCopy('nl'), 'PowerPoint, elke slide als beeld');
});

test('the in-code fallback is the en copy', () => {
  const src = readFileSync(
    resolve(root, 'client/views/editor/export-modal.js'),
    'utf8',
  );
  assert.match(
    src,
    /t\(\s*'editor\.export\.descPptx',\s*'PowerPoint, each slide as an image',?\s*\)/,
  );
});
