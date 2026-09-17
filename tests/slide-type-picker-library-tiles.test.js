/** Library slides retain their content and background across picker controls. */

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
// Two real types (the title declares a background field) keep the picker small;
// jsdom cannot draw every schematic (SVG `className` is read-only there).
const SLIDE_TYPES = {
  'quote-slide': ALL_TYPES['quote-slide'],
  'title-slide': ALL_TYPES['title-slide'],
};
const prefs =
  await import('../client/views/editor/slide-type-picker/preferences.js');
const { createSlideTypePicker } =
  await import('../client/views/editor/slide-type-picker/index.js');

const LIBRARY_TITLE = 'Saved-in-the-library title';

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
    '.ps-type-group:not(.ps-type-group-library) .ps-type-thumb[data-thumb-type="title-slide"]',
  );

const assertTiles = (mount, moment) => {
  const lib = libraryTile(mount);
  assert.ok(lib, `${moment}: the library tile is there`);
  assert.ok(
    lib.textContent.includes(LIBRARY_TITLE),
    `${moment}: the library tile shows item.content`,
  );
  assert.ok(lib.querySelector('.slide'), `${moment}: as a rendered slide`);
  const type = typeTile(mount);
  assert.ok(type, `${moment}: the title type tile is there`);
  assert.ok(
    !type.textContent.includes(LIBRARY_TITLE),
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
          name: 'Our title',
          slideType: 'title-slide',
          content: { title: LIBRARY_TITLE, background: 'lime' },
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
  assert.ok(lib?.textContent.includes(LIBRARY_TITLE), 'mounted with content');

  // Schematic → Preview.
  mount.querySelector('.ps-view-toggle-btn[data-view="preview"]').click();
  assertTiles(mount, 'after Schematic → Preview');
  assert.equal(libraryTile(mount), lib, 'the library tile is not rebuilt');

  const savedSlide = libraryTile(mount).querySelector('.slide');
  assert.ok(savedSlide.classList.contains('slide-bg-lime'));

  // A background switch restyles the hydrated type tiles.
  const swatch = mount.querySelector('.ps-surface-swatch[data-surface="mist"]');
  assert.ok(swatch, 'the picker offers the mist background');
  swatch.click();
  assertTiles(mount, 'after the background switch');
  assert.equal(libraryTile(mount).querySelector('.slide'), savedSlide);
  assert.ok(savedSlide.classList.contains('slide-bg-lime'));
  assert.ok(
    typeTile(mount).querySelector('.slide').classList.contains('slide-bg-mist'),
  );

  // And back to Schematic: the library tile is still the saved slide.
  mount.querySelector('.ps-view-toggle-btn[data-view="schematic"]').click();
  assertTiles(mount, 'after Preview → Schematic');

  mount.remove();
  localStorage.clear();
});
