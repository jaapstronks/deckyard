/**
 * Copy in the slide library, paste in a deck.
 *
 * The library's "Copy to clipboard" toasts "Paste it in a presentation with
 * Ctrl/Cmd+V". It used to write raw JSON to the OS clipboard, which nothing in
 * the app reads back, while the editor's paste bar and Ctrl/Cmd+V read only the
 * `ps:slide-clipboard` buffer. So the promise had no paste behind it. There is
 * one slide clipboard; this file pins that the library writes to it.
 *
 * Run with: node --test tests/slide-library-copy-paste.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

const { copyLibraryItemToClipboard } =
  await import('../client/lib/slide-library/compose.js');
const { pasteSlidesFromClipboard } =
  await import('../client/lib/slide-authoring/clone-slides.js');
const { getClipboardCount } =
  await import('../client/lib/slide-authoring/slide-clipboard.js');

const t = (_key, fallback) => fallback;

test('a library copy lands on the slide clipboard and pastes into a deck', () => {
  localStorage.clear();
  const content = { title: 'Uit de bibliotheek', body: 'Tekst' };
  assert.equal(
    copyLibraryItemToClipboard({
      id: 'lib-1',
      slideType: 'content-slide',
      content,
      i18n: { versions: { 'en-GB': { content: { title: 'Other language' } } } },
    }),
    true,
  );
  // The paste bar and Ctrl/Cmd+V both gate on this count.
  assert.equal(getClipboardCount(), 1);

  const pres = {
    id: 'deck-1',
    slides: [{ id: 's1', type: 'title', content: {}, notes: '' }],
  };
  let selected = 's1';
  const pasted = pasteSlidesFromClipboard({
    pres,
    getSelectedSlideId: () => selected,
    setSelectedSlideId: (id) => {
      selected = id;
    },
    editorState: { dirtyRefreshAll() {} },
    t,
  });

  assert.equal(pasted, 1);
  assert.equal(pres.slides.length, 2);
  const slide = pres.slides[1];
  assert.equal(slide.type, 'content-slide');
  assert.deepEqual(slide.content, content);
  assert.equal(slide.notes, '');
  assert.equal(slide.parentId ?? null, null);
  assert.ok(
    slide.id && slide.id !== 'lib-1',
    'the pasted slide gets a fresh id',
  );
  assert.equal(selected, slide.id);
});

test('an item without a slide type is refused, not written', () => {
  localStorage.clear();
  assert.equal(copyLibraryItemToClipboard({ content: { title: 'x' } }), false);
  assert.equal(getClipboardCount(), 0);
});

test('the library view has no second clipboard path', async () => {
  const src = await readFile(
    new URL(
      '../client/views/list/views/slide-library-view.js',
      import.meta.url,
    ),
    'utf8',
  );
  assert.doesNotMatch(src, /navigator\.clipboard/);
  assert.match(src, /copyLibraryItemToClipboard\(/);
});
