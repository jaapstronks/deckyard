import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('retired direct translation dialogs and their opener stay removed', () => {
  for (const path of [
    'client/views/editor/modals/translate-slide-modal.js',
    'client/views/editor/modals/translate-field-modal.js',
    'client/views/editor/translate-openers.js',
  ]) {
    assert.equal(existsSync(new URL(path, root)), false, path);
  }

  const controller = read('client/views/editor/editor-controller.js');
  const more = read('client/views/editor/topbar/more-menu.js');
  const form = read('client/views/editor/editor-form/index.js');
  const fields = read('client/views/editor/editor-form/render-field.js');
  const language = read('client/views/editor/topbar/language-mode.js');
  assert.doesNotMatch(
    controller,
    /createTranslateOpeners|onTranslateSlide|onTranslateField/,
  );
  assert.doesNotMatch(more, /onTranslateOther|btnTranslateOther/);
  assert.doesNotMatch(form, /onFillSlide|onTranslateField|onTranslateSlide/);
  assert.doesNotMatch(fields, /translateLabelRightEl|onTranslateField/);
  assert.doesNotMatch(
    language,
    /translateMissingForActive|translateOtherLanguage/,
  );
});
