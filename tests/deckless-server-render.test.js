/**
 * A server-rendered slide type gets a thumbnail without a deck (B278).
 *
 * Fork types, fork overrides of a core name and published database types are
 * drawn by the server. `renderSlideElement()` used to start that render only
 * with a `presentationId`, so the surfaces that have no deck — the settings
 * curation grid and the slide-type picker's preview tiles — kept the bare
 * `slide-loading` placeholder: an empty tile for every such type.
 *
 * Without a deck the runtime now asks `POST /api/render-slide`, stating the
 * theme and language it renders against; with a deck it keeps the deck route.
 * Both routes share one server render (`serveSlideRender`).
 *
 * Which route is not inferred from what else a mount was given: the surface
 * declares it as `renderVia` (B287, D114), one route per kind, and a missing or
 * unknown kind refuses rather than falling back. The anonymous kinds' server
 * half is in `tests/anon-follow-and-share-surfaces.test.js`, the guard that no
 * anonymous view declares a post-gate kind in
 * `tests/render-via-declaration.test.js`.
 *
 * The client half simulates a fork override the way the app shell announces
 * one (`window.__DECK_SERVER_RENDERED_TYPES__`) and answers the request with
 * the shared renderer's markup. The server half drives the real handlers.
 *
 * Run with: node --test tests/deckless-server-render.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/settings',
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

const { SLIDE_TYPES, renderSlideHtml } =
  await import('../shared/slide-types.js');
const { renderSlideElement, slideRendered, NO_DECK_LANG, RENDER_VIA_THEME } =
  await import('../client/lib/slide-runtime/slide-render.js');
const { createCurationThumbnail } =
  await import('../client/views/settings/tabs/slide-types-tab/curation-thumbnails.js');
const { createSlideTypePicker } =
  await import('../client/views/editor/slide-type-picker/index.js');
const prefs =
  await import('../client/views/editor/slide-type-picker/preferences.js');

const SERVER_TYPE = 'title-slide';
window.__DECK_SERVER_RENDERED_TYPES__ = [SERVER_TYPE];

const UUID = '2b8ff646-0a51-4bbf-9304-fbfc09903bbc';
/** A database theme as the client holds it: slug as `id`, UUID beside it. */
const DB_THEME = { id: 'acme', _customThemeId: UUID, cssVars: {} };

/** Answer every render request with the shared renderer's markup. */
function installServer() {
  const requests = [];
  globalThis.fetch = async (path, opts) => {
    const body = JSON.parse(opts.body);
    requests.push({ path, body });
    // The anonymous kinds send the slide's id; the server renders its own copy.
    const slide = body.slide || { id: body.slideId, type: 'content-slide' };
    const html = renderSlideHtml(slide, { mode: body.mode });
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json; charset=utf-8' },
      json: async () => ({ html }),
    };
  };
  return requests;
}

// --- client --------------------------------------------------------------

test('curation: a server-rendered type renders its sample without a deck', async () => {
  const requests = installServer();
  const wrap = createCurationThumbnail(
    SERVER_TYPE,
    'slide-type-curation-thumb',
    DB_THEME,
  );
  document.body.append(wrap);
  const el = wrap.firstElementChild;
  assert.equal(el.dataset.needsServerRender, '1', 'starts as a placeholder');

  assert.equal(
    await slideRendered(el),
    true,
    'the empty tile: nothing rendered the placeholder without a deck',
  );
  assert.ok(!el.classList.contains('slide-loading'));
  assert.equal(el.dataset.needsServerRender, undefined);

  assert.equal(requests.length, 1);
  const [req] = requests;
  assert.equal(req.path, '/api/render-slide');
  assert.equal(req.body.slide.type, SERVER_TYPE);
  assert.equal(req.body.mode, 'thumb');
  assert.equal(req.body.theme, UUID, 'a database theme is sent by its UUID');
  assert.ok(
    Object.hasOwn(req.body, 'lang') && req.body.lang === null,
    'the language is stated, as NO_DECK_LANG',
  );
  wrap.remove();
});

test('picker: a server-rendered type fills its preview tile without a deck', async () => {
  const requests = installServer();
  localStorage.clear();
  prefs.persistViewMode('preview');
  const mount = document.createElement('div');
  document.body.append(mount);
  const { renderSlideTypePicker } = createSlideTypePicker({
    SLIDE_TYPES,
    theme: { id: 'deckyard', cssVars: {} },
    insertSlide: () => {},
    disabledSlideTypes: [],
  });
  renderSlideTypePicker(mount, {});

  const tile = mount.querySelector(
    `.ps-type-thumb[data-thumb-type="${SERVER_TYPE}"] .slide`,
  );
  assert.ok(tile, 'the tile hydrated');
  assert.equal(await slideRendered(tile), true);
  assert.ok(!tile.classList.contains('slide-loading'));

  const sent = requests.filter((r) => r.body.slide.type === SERVER_TYPE);
  assert.ok(sent.length >= 1);
  for (const r of sent) {
    assert.equal(r.path, '/api/render-slide');
    assert.equal(r.body.theme, 'deckyard');
    assert.equal(r.body.lang, null);
  }
  mount.remove();
  localStorage.clear();
});

test('renderVia: each declared kind has exactly one route', async () => {
  const slide = { id: 'd1', type: SERVER_TYPE, content: { title: 'Deck' } };
  const rows = [
    [
      { kind: 'deck', id: 'p1' },
      '/api/presentations/p1/render-slide',
      { slide, mode: 'thumb' },
    ],
    [
      RENDER_VIA_THEME,
      '/api/render-slide',
      { slide, mode: 'thumb', theme: UUID, lang: 'nl' },
    ],
    [
      { kind: 'share', token: 'tok', grant: 'g1' },
      '/api/share/tok/render-slide',
      { slideId: 'd1', mode: 'thumb', grant: 'g1' },
    ],
    [
      { kind: 'follow', id: 'p1' },
      '/api/follow/p1/render-slide',
      { slideId: 'd1', mode: 'thumb', lang: 'nl' },
    ],
    [
      { kind: 'session', id: 's1' },
      '/api/live-sessions/s1/render-slide',
      { slideId: 'd1', mode: 'thumb' },
    ],
  ];
  for (const [renderVia, path, body] of rows) {
    const requests = installServer();
    const el = renderSlideElement(slide, {
      mode: 'thumb',
      theme: DB_THEME,
      // A presentationId beside a non-deck kind changes nothing: it is what a
      // client renderer links to, not what the viewer may call.
      presentationId: 'p1',
      renderVia,
      lang: 'nl',
    });
    document.body.append(el);
    assert.equal(await slideRendered(el), true, renderVia.kind);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, path);
    assert.deepEqual(requests[0].body, body, renderVia.kind);
    el.remove();
  }
});

test('renderVia: a missing or unknown kind refuses — no request, no fallback', async () => {
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    for (const renderVia of [
      undefined,
      { kind: 'bogus', id: 'p1' },
      { kind: 'deck' },
      { kind: 'share', grant: 'g1' },
    ]) {
      const requests = installServer();
      errors.length = 0;
      const el = renderSlideElement(
        { id: 'd1', type: SERVER_TYPE, content: { title: 'Deck' } },
        { mode: 'thumb', presentationId: 'p1', renderVia, lang: NO_DECK_LANG },
      );
      document.body.append(el);
      assert.equal(
        await slideRendered(el),
        false,
        JSON.stringify(renderVia ?? null),
      );
      assert.equal(requests.length, 0, 'nothing was asked of the server');
      assert.ok(el.classList.contains('slide-loading'));
      assert.match(String(errors[0]?.[1]?.message), /renderVia/);
      el.remove();
    }
  } finally {
    console.error = originalError;
  }
});

// --- server --------------------------------------------------------------

const { handleRenderSlide } =
  await import('../server/routes/api/render-slide.js');

/** Drive `POST /api/render-slide` with `body`; resolve { status, json }. */
async function postRender(body, { organizationId = null } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  let status = 0;
  let text = '';
  const res = {
    headersSent: false,
    setHeader() {},
    writeHead(s) {
      status = s;
      this.headersSent = true;
    },
    end(chunk) {
      if (chunk) text += chunk;
    },
  };
  const handled = await handleRenderSlide({
    repoRoot,
    storageScope: { organizationId, repoRoot },
    req,
    res,
    url: new URL('http://localhost/api/render-slide'),
    authedUser: { email: 'a@example.com' },
  });
  return { handled, status, json: text ? JSON.parse(text) : null };
}

test('route: renders against the theme and language in the body', async () => {
  const out = await postRender({
    slide: { id: 's', type: 'content-slide', content: { title: 'Hi' } },
    mode: 'thumb',
    theme: 'deckyard',
    lang: 'en',
  });
  assert.equal(out.status, 200);
  assert.match(out.json.html, /class="slide/);
  assert.match(out.json.html, /Hi/);
});

test('route: theme and lang may be null, but must be stated', async () => {
  const slide = { id: 's', type: 'content-slide', content: { title: 'Hi' } };
  assert.equal(
    (await postRender({ slide, theme: null, lang: null })).status,
    200,
  );
  for (const body of [
    { slide, lang: null },
    { slide, theme: null },
    { slide, theme: null, lang: 'xx' },
    { slide, theme: 42, lang: null },
    { theme: null, lang: null },
  ]) {
    const out = await postRender(body);
    assert.equal(out.status, 400, JSON.stringify(body));
  }
});

// The deck route and this one are one render: the deck handler has no
// `renderSlideHtml` of its own left to drift.
test('route: the deck route leans on the shared render', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    join(repoRoot, 'server/routes/api/presentations/render-slide.js'),
    'utf8',
  );
  assert.match(src, /serveSlideRender\(/);
  assert.doesNotMatch(src, /renderSlideHtml|buildMergedSlideTypes/);
});
