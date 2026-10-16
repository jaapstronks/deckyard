/**
 * Every file row in the export modal fetches its file itself (B715).
 *
 * PowerPoint, the handoff ZIP and Notes used to `window.open` their download
 * URL: a blank tab for the minute the server took, no state on the row, no
 * error, and on an instance with a job queue a `202` JSON blob in that tab.
 * HTML, .deck and JSON navigated the editor itself. Now one path serves them
 * all: `fetch` with `?sync=1`, the button busy meanwhile, a failure inline
 * under the row. `window.open` is left for pages, and the test derives which
 * routes are pages from the route table (`createHtmlPreviewRoute`), so a row
 * that opens a file in a tab fails here.
 *
 * Run with: node --test tests/export-modal-downloads.test.js
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/deck-1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;

const { openExportModal } =
  await import('../client/views/editor/export-modal.js');

/** The export routes that serve a page rather than a file, from the table. */
function previewRoutes() {
  const src = readFileSync(
    new URL('../server/routes/api/export.js', import.meta.url),
    'utf8',
  );
  const routes = [
    ...src.matchAll(
      /createHtmlPreviewRoute\(\{[^}]*?pattern:\s*\/\^\\\/api\\\/presentations\\\/\(\[\^\/\]\+\)\\\/export\\\/([\w-]+)\$\//g,
    ),
  ].map((m) => m[1]);
  assert.ok(routes.length >= 2, 'found the preview routes in the table');
  return new Set(routes);
}

/** The export route segment of a modal URL. */
const segment = (url) =>
  new URL(url, 'http://localhost').pathname.split('/export/')[1];

let opened;
let fetched;
let saved;
/** What the next fetch answers; a function of the URL. */
let answer;

beforeEach(() => {
  document.body.innerHTML = '';
  opened = [];
  fetched = [];
  saved = [];
  answer = () =>
    new Response('bytes', {
      status: 200,
      headers: { 'Content-Disposition': 'attachment; filename="Deck.bin"' },
    });
  window.open = (url) => {
    opened.push(url);
    return null;
  };
  globalThis.fetch = async (url) => {
    fetched.push(url);
    return answer(url);
  };
  dom.window.HTMLAnchorElement.prototype.click = function click() {
    saved.push(this.download);
  };
});

const DECK = {
  id: 'deck-1',
  title: 'Deck',
  i18n: { active: 'nl', versions: { nl: { slides: [] } } },
  slides: [{ type: 'title' }],
};

function open() {
  return openExportModal({ pres: DECK, id: DECK.id, root: document.body });
}

/** Every row wrapper, keyed by its format name. */
function rows() {
  const out = {};
  for (const row of document.querySelectorAll('.export-format-row')) {
    out[row.querySelector('.export-format-name').textContent] = row;
  }
  return out;
}

/** Let the click's fetch, blob read and finally-block settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

test('only the preview pages open a tab; every file row fetches with ?sync=1', async () => {
  open();
  const pages = previewRoutes();
  const byName = rows();
  const fileRows = Object.keys(byName).filter((n) => n !== 'PDF');

  for (const name of fileRows) {
    for (const btn of byName[name].querySelectorAll('button')) {
      btn.click();
      await settle();
    }
  }

  assert.deepEqual(opened.map(segment).sort(), ['pdf', 'png']);
  for (const url of opened) {
    assert.ok(pages.has(segment(url)), `${url} is a page, not a file`);
  }
  assert.deepEqual(fetched.map((u) => segment(u).split('?')[0]).sort(), [
    'deck.zip',
    'handoff.zip',
    'html',
    'json',
    'notes.docx',
    'notes.md',
    'pptx',
    'pptx-editable',
  ]);
  for (const url of fetched) {
    assert.equal(
      new URL(url, 'http://localhost').searchParams.get('sync'),
      '1',
      `${url} asks synchronously`,
    );
    assert.ok(!pages.has(segment(url).split('?')[0]), `${url} is a file`);
  }
  assert.equal(saved.length, fetched.length, 'every fetched file is saved');
  assert.equal(location.pathname, '/app/deck-1', 'the editor stays put');
});

test('the PowerPoint row is busy while the file is built, then itself again', async () => {
  let release;
  answer = () =>
    new Promise((resolve) => {
      release = () => resolve(new Response('bytes', { status: 200 }));
    });
  open();
  const btn = rows().PowerPoint.querySelector('button');

  btn.click();
  await settle();
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, 'Building PowerPoint…');
  btn.click();
  assert.equal(fetched.length, 1, 'a busy row takes no second click');

  release();
  await settle();
  await settle();
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Export');
  assert.deepEqual(saved, ['Deck.pptx'], 'falls back to the title + suffix');
  assert.deepEqual(opened, [], 'no tab');
});

test('a failed file row shows the server sentence under that row', async () => {
  answer = () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: 'browser_unavailable',
        message: 'The export browser could not start; try again.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  open();
  const wrap = rows()['Handoff ZIP'].parentElement;
  const btn = wrap.querySelector('button');

  btn.click();
  await settle();
  await settle();
  const alert = wrap.querySelector('.inline-error');
  assert.ok(alert && !alert.hidden, 'an inline error under the row');
  assert.match(alert.textContent, /export browser could not start/);
  assert.equal(btn.disabled, false);
  assert.deepEqual(saved, []);
  assert.deepEqual(opened, []);
  assert.equal(
    document.querySelectorAll(
      '.export-format-rowwrap .inline-error:not([hidden])',
    ).length,
    1,
    'only the failed row shows an error',
  );

  // The next attempt clears it first.
  answer = () => new Response('bytes', { status: 200 });
  btn.click();
  await settle();
  await settle();
  assert.ok(alert.hidden || !alert.textContent, 'cleared on success');
});
