/**
 * The client half of B176 / D70: the two shared theme pickers render what the
 * server offers, and nothing else.
 *
 * `server/routes/api/themes.js` now enforces the `enabledThemes` allowlist, so
 * the picker's job shrank to two things, both pinned here:
 *
 *   1. **Render the response as-is.** The creation grid used to sort themes
 *      into a visible grid and a "Show all themes" drawer on `theme.enabled`.
 *      That drawer is gone; a second surface that softens the allowlist is the
 *      defect D70 removed, so this asserts the picker builds one grid and
 *      exposes no toggle.
 *   2. **Ask for the deck's own theme back.** Both pickers send
 *      `?current=<id>` when they know the theme in use, which is the single
 *      exception the server honours — without it, opening the settings modal on
 *      a deck whose theme was withdrawn would silently offer something else.
 *
 * Run with: node --test tests/theme-picker-allowlist-client.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app',
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
globalThis.fetch = async () => {
  throw new Error('no network in this test');
};

const { createVisualThemePicker, createAndPopulateThemeSelect } =
  await import('../client/views/theme-select.js');
const { buildThemeSection } =
  await import('../client/views/editor/modals/settings-modal/theme.js');

/**
 * A `GET /api/themes` double that records what the picker asked for and answers
 * the way the filtering server does: only what the allowlist permits, plus the
 * theme named by `?current=`.
 *
 * @param {Object} options
 * @param {string[]} options.allowed - Theme ids the workspace allows
 * @param {string[]} [options.all] - Every theme that exists
 * @returns {{api: Function, paths: string[]}}
 */
const BRAND = '11111111-1111-4111-8111-111111111111';
const EDITORIAL = '22222222-2222-4222-8222-222222222222';
const MIDNIGHT = '33333333-3333-4333-8333-333333333333';
const LABELS = {
  [BRAND]: 'Forest',
  [EDITORIAL]: 'Editorial',
  [MIDNIGHT]: 'Midnight',
};

function fakeThemesApi({ allowed, all = [BRAND, EDITORIAL, MIDNIGHT] }) {
  const paths = [];
  const api = async (path) => {
    paths.push(path);
    const current = new URL(path, 'http://localhost').searchParams.get(
      'current',
    );
    const offered = all.filter((id) => allowed.includes(id) || id === current);
    const defaultThemeId = allowed[0] || BRAND;
    return {
      themes: offered.map((id) => ({
        id,
        label: LABELS[id],
        source: 'seed',
        isDefault: id === defaultThemeId,
      })),
      enabledThemes: allowed,
    };
  };
  return { api, paths };
}

test('the visual picker renders one grid, with no "show all" escape hatch', async () => {
  const { api } = fakeThemesApi({ allowed: [BRAND, EDITORIAL] });
  const picker = createVisualThemePicker({ api, initialTheme: BRAND });
  await picker.populated;

  const grids = picker.wrap.querySelectorAll('.theme-picker-grid');
  assert.equal(grids.length, 1, 'exactly one grid');
  assert.equal(
    picker.wrap.querySelector('.theme-picker-grid-more'),
    null,
    'no hidden drawer',
  );
  assert.equal(
    picker.wrap.querySelector('.theme-picker-toggle'),
    null,
    'no toggle to reveal withdrawn themes',
  );

  const labels = [...grids[0].querySelectorAll('.theme-card-label')].map(
    (el) => el.textContent,
  );
  assert.deepEqual(labels, [
    'Workspace default (Forest)',
    'Forest',
    'Editorial',
  ]);
});

test('the visual picker asks for the deck theme it was opened on', async () => {
  const { api, paths } = fakeThemesApi({ allowed: [BRAND] });
  const picker = createVisualThemePicker({ api, initialTheme: MIDNIGHT });
  await picker.populated;

  assert.deepEqual(paths, [`/api/themes?current=${MIDNIGHT}`]);
  const labels = [...picker.wrap.querySelectorAll('.theme-card-label')].map(
    (el) => el.textContent,
  );
  assert.deepEqual(
    labels,
    ['Workspace default (Forest)', 'Forest', 'Midnight'],
    'the withdrawn theme is offered here, and only here',
  );
});

test('the visual picker omits the parameter when no theme is chosen yet', async () => {
  const { api, paths } = fakeThemesApi({ allowed: [BRAND, EDITORIAL] });
  const picker = createVisualThemePicker({ api });
  await picker.populated;

  assert.deepEqual(paths, ['/api/themes']);
  assert.equal(picker.getTheme(), 'default', 'preserves the default reference');
});

test('the deck-settings select offers the response, and asks for the deck theme', async () => {
  const { api, paths } = fakeThemesApi({ allowed: [BRAND, EDITORIAL] });
  const selector = createAndPopulateThemeSelect({
    api,
    initialTheme: MIDNIGHT,
  });
  await selector.populated;

  assert.deepEqual(paths, [`/api/themes?current=${MIDNIGHT}`]);
  const values = [...selector.select.options].map((o) => o.value);
  assert.deepEqual(values, ['default', BRAND, EDITORIAL, MIDNIGHT]);
  assert.equal(
    selector.select.value,
    MIDNIGHT,
    'the deck keeps showing its own theme',
  );
});

test('the deck-settings select drops a theme the workspace withdrew', async () => {
  const { api } = fakeThemesApi({ allowed: [BRAND] });
  const selector = createAndPopulateThemeSelect({ api, initialTheme: BRAND });
  await selector.populated;

  const values = [...selector.select.options].map((o) => o.value);
  assert.deepEqual(
    values,
    ['default', BRAND],
    'editorial and midnight are not selectable anywhere',
  );
});

test('both pickers name the theme "Workspace default" resolves to (B584)', async () => {
  const { api } = fakeThemesApi({ allowed: [BRAND, EDITORIAL] });
  const selector = createAndPopulateThemeSelect({ api, initialTheme: BRAND });
  await selector.populated;
  assert.equal(selector.select.options[0].text, 'Workspace default (Forest)');

  const picker = createVisualThemePicker({ api });
  await picker.populated;
  assert.equal(
    picker.wrap.querySelector('.theme-card-label').textContent,
    'Workspace default (Forest)',
  );
});

test('without a marked default the select keeps the bare label', async () => {
  const api = async () => ({
    themes: [{ id: BRAND, label: 'Forest', source: 'seed' }],
  });
  const selector = createAndPopulateThemeSelect({ api, initialTheme: BRAND });
  await selector.populated;
  assert.equal(selector.select.options[0].text, 'Workspace default');
});

test('the deck-settings section reads the deck theme under its real name', async () => {
  // A deck object spells its theme `theme`, on the wire and on the client
  // (`save-manager.js`). This section read `themeId`, a name nothing writes, so
  // it silently pre-selected the default. That was cosmetic while every theme
  // was listed; with the allowlist enforced it costs the deck its own theme.
  const { api, paths } = fakeThemesApi({ allowed: [BRAND] });
  const section = buildThemeSection({
    root: document.body,
    pres: { id: 'deck-1', theme: MIDNIGHT },
    api,
    modal: { close() {} },
  });
  // The select is populated asynchronously; one microtask drain is enough for
  // the fake api, which never touches the network.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(paths, [`/api/themes?current=${MIDNIGHT}`]);
  const select = section.el.querySelector('select');
  assert.equal(select.value, MIDNIGHT, 'the deck keeps its own theme');
});
