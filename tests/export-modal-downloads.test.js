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
 * The exports that render in Chrome (PDF, the PNG ZIP, both PowerPoints, the
 * handoff ZIP) are long tasks (B716): they ask the route's streamed twin
 * (`…/stream`), run in the loading modal with a slide counter and a Cancel,
 * and fetch the file the stream's `complete` names.
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
/** What the next fetch answers; a function of the URL and its init. */
let answer;

const STATUS_12 =
  'event: status\ndata: {"phase":"render","progress":24,"done":12,"total":54,"unit":"slide"}\n\n';
const COMPLETE =
  'event: complete\ndata: {"downloadUrl":"/api/jobs/export-stream-1/download"}\n\n';

/** The default server: an event stream for `/stream`, bytes for the rest. */
function server(url) {
  if (url.includes('/stream')) {
    return new Response(
      'event: status\ndata: {"phase":"start","progress":3}\n\n' +
        STATUS_12 +
        COMPLETE,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  }
  return new Response('bytes', {
    status: 200,
    headers: { 'Content-Disposition': 'attachment; filename="Deck.bin"' },
  });
}

/** A stream that sends `first`, then stays open until `release()` or abort. */
function heldStream(init, first) {
  const encoder = new TextEncoder();
  let release;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(first));
      release = () => {
        controller.enqueue(encoder.encode(COMPLETE));
        controller.close();
      };
      init?.signal?.addEventListener('abort', () =>
        controller.error(new DOMException('aborted', 'AbortError')),
      );
    },
  });
  return { response: new Response(body, { status: 200 }), release };
}

beforeEach(() => {
  document.body.innerHTML = '';
  opened = [];
  fetched = [];
  saved = [];
  answer = server;
  window.open = (url) => {
    opened.push(url);
    return null;
  };
  globalThis.fetch = async (url, init) => {
    fetched.push(url);
    return answer(url, init);
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

/** Let the click's fetches, stream read and finally-block settle. */
async function settle() {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
}

test('only the preview pages open a tab; a quick file fetches with ?sync=1, a Chrome export streams', async () => {
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
  const exports = fetched.filter((u) => u.includes('/export/'));
  assert.deepEqual(exports.map((u) => segment(u).split('?')[0]).sort(), [
    'deck.zip',
    'handoff.zip/stream',
    'html',
    'json',
    'notes.docx',
    'notes.md',
    'png.zip/stream',
    'pptx-editable/stream',
    'pptx/stream',
  ]);
  for (const url of exports.filter((u) => !u.includes('/stream'))) {
    assert.equal(
      new URL(url, 'http://localhost').searchParams.get('sync'),
      '1',
      `${url} asks synchronously`,
    );
    assert.ok(!pages.has(segment(url).split('?')[0]), `${url} is a file`);
  }
  const downloads = fetched.filter((u) => u.startsWith('/api/jobs/'));
  assert.equal(downloads.length, 4, 'each stream ends in one file download');
  assert.equal(saved.length, exports.length, 'every export is saved');
  assert.equal(location.pathname, '/app/deck-1', 'the editor stays put');
});

test('a quick file row is busy while the file is built, then itself again', async () => {
  let release;
  answer = () =>
    new Promise((resolve) => {
      release = () => resolve(new Response('bytes', { status: 200 }));
    });
  open();
  const btn = rows().HTML.querySelector('button');

  btn.click();
  await settle();
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, 'Preparing…');
  btn.click();
  assert.equal(fetched.length, 1, 'a busy row takes no second click');

  release();
  await settle();
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Export');
  assert.deepEqual(saved, ['Deck.html'], 'falls back to the title + suffix');
  assert.deepEqual(opened, [], 'no tab');
});

test('a Chrome export runs in the loading modal: slide 12 of 54, then the file', async () => {
  let release;
  answer = (url, init) => {
    if (!url.includes('/stream')) return server(url);
    const held = heldStream(init, STATUS_12);
    release = held.release;
    return held.response;
  };
  open();
  rows().PowerPoint.querySelector('button').click();
  await settle();

  const modal = document.querySelector('.loading-modal');
  assert.ok(modal, 'the loading modal is open');
  assert.equal(
    modal.querySelector('.loading-modal-title').textContent,
    'Exporting PowerPoint',
  );
  assert.equal(
    modal.querySelector('.loading-modal-message').textContent,
    'Slide 12 of 54',
  );
  assert.ok(
    modal.querySelector('.loading-modal-cancel'),
    'it can be cancelled',
  );

  release();
  await settle();
  assert.deepEqual(saved, ['Deck.bin']);
  assert.ok(
    fetched.includes('/api/jobs/export-stream-1/download'),
    'the file comes from the URL the stream named',
  );
});

test('Cancel aborts the stream: no file, no error, the row is itself again', async () => {
  let streamSignal;
  answer = (url, init) => {
    streamSignal = init?.signal;
    return heldStream(init, STATUS_12).response;
  };
  open();
  const wrap = rows()['Handoff ZIP'].parentElement;
  const btn = wrap.querySelector('button');
  btn.click();
  await settle();

  document.querySelector('.loading-modal-cancel').click();
  await settle();
  assert.equal(streamSignal.aborted, true, 'the request is aborted');
  assert.deepEqual(saved, []);
  const alert = wrap.querySelector('.inline-error');
  assert.ok(!alert || alert.hidden, 'a cancel is not an error');
  assert.equal(btn.disabled, false);
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
  answer = server;
  btn.click();
  await settle();
  assert.ok(alert.hidden || !alert.textContent, 'cleared on success');
});

test('a failure inside the stream is the server sentence under the row', async () => {
  answer = (url) =>
    url.includes('/stream')
      ? new Response(
          'event: error\ndata: {"message":"The export browser could not start; try again.","error":"browser_unavailable"}\n\n',
          { status: 200 },
        )
      : server(url);
  open();
  const wrap = rows().PowerPoint.parentElement;
  wrap.querySelector('button').click();
  await settle();
  const alert = wrap.querySelector('.inline-error');
  assert.ok(alert && !alert.hidden);
  assert.match(alert.textContent, /export browser could not start/);
  assert.deepEqual(saved, []);
});
