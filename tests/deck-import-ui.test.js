/**
 * The `.deck` import in the creation view (B253): what the passing message says
 * about the carried theme and slide types, the install choice, and the inline
 * refusal of a bundle.
 *
 * The route and its statuses are pinned by deck-bundle-theme.test.js and
 * deck-bundle-slide-types.test.js; this pins how the client reads them.
 *
 * Run with: node --test tests/deck-import-ui.test.js
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
globalThis.history = dom.window.history;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;

const { deckImportOutcome, createDeckImportPanel } =
  await import('../client/views/list/modals/creation-view/import-deck.js');

test('a deck that carried nothing says nothing', () => {
  assert.equal(deckImportOutcome({ id: 'p1', lang: 'en-GB' }), null);
});

test('installed and existing definitions are a success, named by label', () => {
  const outcome = deckImportOutcome({
    bundledTheme: { slug: 'brand', label: 'Brand', status: 'installed' },
    bundledSlideTypes: [
      { slug: 'kpi', label: 'KPI', status: 'installed' },
      { slug: 'quote-x', label: 'Quote X', status: 'existing' },
    ],
  });
  assert.equal(outcome.type, 'success');
  assert.match(outcome.message, /Theme “Brand” installed\./);
  assert.match(outcome.message, /Slide types installed: “KPI”\./);
  assert.match(outcome.message, /already in your workspace: “Quote X”\./);
});

test('not installed is a warning that says who can install it', () => {
  const notRequested = deckImportOutcome({
    bundledTheme: {
      slug: 'brand',
      label: 'Brand',
      status: 'not-installed',
      reason: 'install-not-requested',
    },
  });
  assert.equal(notRequested.type, 'warning');
  assert.match(notRequested.message, /uses the default theme/);
  assert.match(notRequested.message, /install option ticked/);

  const notPermitted = deckImportOutcome({
    bundledSlideTypes: [
      {
        slug: 'kpi',
        status: 'not-installed',
        reason: 'not-permitted',
      },
    ],
  });
  assert.equal(notPermitted.type, 'warning');
  assert.match(notPermitted.message, /placeholders: “kpi”\./);
  assert.match(notPermitted.message, /A designer in your workspace/);
});

test('missing fonts and failed assets are reported', () => {
  const outcome = deckImportOutcome({
    bundledTheme: {
      slug: 'brand',
      status: 'existing',
      fontsMissing: ['Brand Sans'],
    },
    failedAssets: [{ ref: 'assets/a.bin' }],
  });
  assert.equal(outcome.type, 'warning');
  assert.match(outcome.message, /default font is used: Brand Sans\./);
  assert.match(outcome.message, /1 file\(s\) could not be imported\./);
});

/** Mount a panel with a fake API and the host callbacks it expects. */
function mount({ canInstall, api }) {
  const panel = createDeckImportPanel({ canInstall });
  document.body.replaceChildren(panel.el);
  const calls = { close: 0, busy: [] };
  const opts = {
    api,
    close: () => {
      calls.close += 1;
    },
    setBusy: (v) => calls.busy.push(v),
    setStatus: () => {},
  };
  const fileInput = panel.el.querySelector('input[type="file"]');
  const pick = () => {
    const file = new dom.window.File(['PK'], 'talk.deck');
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
    });
    fileInput.dispatchEvent(new dom.window.Event('change'));
  };
  return { panel, opts, calls, fileInput, pick };
}

test('the install choice is offered only to a user who may manage', () => {
  const plain = mount({ canInstall: false, api: async () => ({}) });
  assert.equal(plain.panel.el.querySelector('input[type="checkbox"]'), null);
  const designer = mount({ canInstall: true, api: async () => ({}) });
  const box = designer.panel.el.querySelector('input[type="checkbox"]');
  assert.ok(box);
  assert.equal(box.checked, false, 'installing is explicit, never a default');
});

test('ticking install asks for both theme and slide types', async () => {
  const paths = [];
  const { panel, opts, pick } = mount({
    canInstall: true,
    api: async (path) => {
      paths.push(path);
      return { id: 'p1', lang: 'en-GB' };
    },
  });
  pick();
  panel.el.querySelector('input[type="checkbox"]').checked = true;
  await panel.run(opts);
  assert.deepEqual(paths, [
    '/api/presentations/import/deck?install=theme,slideTypes',
  ]);
});

test('a refused bundle is an inline error at the file input, cleared on retry', async () => {
  let refuse = true;
  const { panel, opts, calls, fileInput, pick } = mount({
    canInstall: false,
    api: async (path) => {
      assert.equal(path, '/api/presentations/import/deck');
      if (refuse) {
        const err = new Error(
          'Invalid .deck bundle: unsupported bundleVersion 9',
        );
        err.statusCode = 400;
        throw err;
      }
      return { id: 'p1', lang: 'en-GB' };
    },
  });
  const error = panel.el.querySelector('.inline-error');

  await panel.run(opts);
  assert.equal(error.hidden, false, 'no file is refused in place');
  assert.equal(fileInput.getAttribute('aria-invalid'), 'true');

  pick();
  await panel.run(opts);
  assert.equal(error.hidden, false);
  assert.equal(
    error.textContent,
    'Invalid .deck bundle: unsupported bundleVersion 9',
    "the server's sentence, not a generic one",
  );
  assert.equal(calls.close, 0);
  assert.deepEqual(calls.busy, [true, false]);

  refuse = false;
  await panel.run(opts);
  assert.equal(error.hidden, true);
  assert.equal(fileInput.hasAttribute('aria-invalid'), false);
  assert.equal(calls.close, 1);
});
