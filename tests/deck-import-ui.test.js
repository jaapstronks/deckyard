/**
 * The `.deck` import in the creation view (B253): what the outcome says about
 * the carried theme and slide types and where it goes (a passing message when
 * everything arrived, the dialog's warnings block when something was left
 * out; D144), the install choice, and the inline refusal of a bundle.
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
  assert.deepEqual(outcome.sentences, [
    'Theme “Brand” installed.',
    'Slide types installed: “KPI”.',
    'Slide types already in your workspace: “Quote X”.',
  ]);
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
  assert.match(notRequested.sentences[0], /uses the default theme/);
  assert.match(notRequested.sentences[1], /install option ticked/);

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
  assert.match(notPermitted.sentences[0], /placeholders: “kpi”\./);
  assert.match(notPermitted.sentences[1], /A designer in your workspace/);
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
  assert.match(outcome.sentences[1], /default font is used: Brand Sans\./);
  assert.match(outcome.sentences[2], /1 file\(s\) could not be imported\./);
});

/** Mount a panel with a fake API and the host callbacks it expects. */
function mount({ canInstall, api }) {
  const panel = createDeckImportPanel({ canInstall });
  document.body.replaceChildren(panel.el);
  const calls = { close: 0, busy: [], warnings: [] };
  const opts = {
    api,
    close: () => {
      calls.close += 1;
    },
    setBusy: (v) => calls.busy.push(v),
    setStatus: () => {},
    showWarnings: (arg) => calls.warnings.push(arg),
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
  const { panel, opts, calls, pick } = mount({
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
  assert.equal(calls.close, 1, 'nothing left out: the editor opens');
  assert.deepEqual(calls.warnings, []);
});

test('what was left out stays in the dialog with a next step, not a toast', async () => {
  const { panel, opts, calls, pick } = mount({
    canInstall: false,
    api: async () => ({
      id: 'p1',
      lang: 'nl',
      bundledTheme: {
        slug: 'brand',
        label: 'Brand',
        status: 'not-installed',
        reason: 'not-permitted',
      },
    }),
  });
  pick();
  await panel.run(opts);
  assert.equal(calls.close, 0, 'the dialog stays open');
  assert.equal(calls.warnings.length, 1);
  const [{ warnings, navUrl }] = calls.warnings;
  assert.equal(navUrl, '/app/p1?lang=nl');
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Theme “Brand” is in the file but not installed/);
  assert.match(warnings[1], /A designer in your workspace/);
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
