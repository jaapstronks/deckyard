/**
 * Library tiles in the slide-type picker keep their own content (B311).
 *
 * The "From your library" strip builds its tiles from a saved slide's
 * `item.content`. The picker's two re-render loops — the Schematic/Preview
 * switch and the preview-background swatches — used to empty every
 * `.ps-type-thumb.thumb` and hydrate it from its type's sample, so after either
 * switch a library tile showed the type's sample instead of the saved slide.
 *
 * A tile now declares where its content comes from (`data-thumb-source`); the
 * loops re-render only `type` tiles, and a `library` tile renders its own
 * content through the same hydrate path.
 *
 * Run with: node --test tests/slide-type-picker-library-tiles.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/editor',
  pretendToBeVisual: true,
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
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = () => 0;

const { SLIDE_TYPES: ALL_TYPES } = await import('../shared/slide-types.js');
// Two real types (the quote declares a background field) keep the picker small;
// jsdom cannot draw every schematic (SVG `className` is read-only there).
const SLIDE_TYPES = {
  'quote-slide': ALL_TYPES['quote-slide'],
  'title-slide': ALL_TYPES['title-slide'],
};
const prefs =
  await import('../client/views/editor/slide-type-picker/preferences.js');
const { createSlideTypePicker } =
  await import('../client/views/editor/slide-type-picker/index.js');

const LIBRARY_QUOTE = 'Saved-in-the-library quote';

// Two distinct surfaces, so the picker offers the preview-background swatches.
const theme = {
  id: 'deckyard',
  cssVars: { '--t-slide-bg-lime': '#d4ff00', '--t-slide-bg-mist': '#eef1f4' },
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const libraryTile = (mount) =>
  mount.querySelector('.ps-type-group-library .ps-type-thumb.thumb');
const typeTile = (mount) =>
  mount.querySelector(
    '.ps-type-group:not(.ps-type-group-library) .ps-type-thumb[data-thumb-type="quote-slide"]',
  );

const assertTiles = (mount, moment) => {
  const lib = libraryTile(mount);
  assert.ok(lib, `${moment}: the library tile is there`);
  assert.ok(
    lib.textContent.includes(LIBRARY_QUOTE),
    `${moment}: the library tile shows item.content`,
  );
  assert.ok(lib.querySelector('.slide'), `${moment}: as a rendered slide`);
  const type = typeTile(mount);
  assert.ok(type, `${moment}: the quote type tile is there`);
  assert.ok(
    !type.textContent.includes(LIBRARY_QUOTE),
    `${moment}: the type tile shows its sample, not the library item`,
  );
};

test('picker: a library tile keeps its own content across a view switch and a background switch', async () => {
  localStorage.clear();
  prefs.persistViewMode('schematic');
  const mount = document.createElement('div');
  document.body.append(mount);
  const { renderSlideTypePicker } = createSlideTypePicker({
    SLIDE_TYPES,
    theme,
    insertSlide: () => {},
    disabledSlideTypes: [],
    loadLibraryStripItems: async () => ({
      personal: [
        {
          id: 'lib-1',
          name: 'Our quote',
          slideType: 'quote-slide',
          content: { quote: LIBRARY_QUOTE, author: 'A. Author' },
          i18n: { dominant: 'nl' },
        },
      ],
      organization: [],
    }),
    insertLibraryItem: () => {},
  });
  renderSlideTypePicker(mount, { onSeeAllLibrary: () => {} });
  await flush();

  const lib = libraryTile(mount);
  assert.ok(lib?.textContent.includes(LIBRARY_QUOTE), 'mounted with content');

  // Schematic → Preview.
  mount.querySelector('.ps-view-toggle-btn[data-view="preview"]').click();
  assertTiles(mount, 'after Schematic → Preview');
  assert.equal(libraryTile(mount), lib, 'the library tile is not rebuilt');

  // A background switch restyles the hydrated type tiles.
  const swatch = mount.querySelector('.ps-surface-swatch[data-surface="mist"]');
  assert.ok(swatch, 'the picker offers the mist background');
  swatch.click();
  assertTiles(mount, 'after the background switch');

  // And back to Schematic: the library tile is still the saved slide.
  mount.querySelector('.ps-view-toggle-btn[data-view="schematic"]').click();
  assertTiles(mount, 'after Preview → Schematic');

  mount.remove();
  localStorage.clear();
});
