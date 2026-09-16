/**
 * Every render surface declares where a server-rendered type is fetched from,
 * and no anonymous surface declares a route behind the login gate (B287, D114).
 *
 * The bug this pins: the share-link viewer, the follow audience and the notes
 * companion hold no session, yet `serverRenderRequest` picked the deck route
 * for them because they passed a `presentationId`. That route sits behind the
 * login gate, so a fork type, a fork override of a core name or a published
 * database type answered 401 and stayed a `slide-loading` placeholder — on
 * slides.ciiic.nl, the first slide of every shared deck. The theme had the same
 * defect one layer up (`tests/anon-custom-theme-payload.test.js`); both were a
 * view reaching for a post-gate route it could never call.
 *
 * Two source guards:
 *
 *   1. Presence, like `lang` in `tests/slide-copy-language.test.js`: every
 *      client call of `renderSlideElement` / `mountSlideInto` states
 *      `renderVia`. There is no default to fall back on, by design.
 *   2. The gate: the views `client/app.js` mounts before it asks for a user are
 *      the anonymous ones. Every render call reachable from them declares a
 *      kind whose route, as `serverRenderRequest` builds it, is matched by a
 *      route table mounted before the login gate in `server/routes/api/index.js`.
 *
 * Both derive their sets from the sources — which views are anonymous, which
 * tables are pre-gate — so a new anonymous view or a moved mount is covered
 * without editing this file.
 *
 * Run with: node --test tests/render-via-declaration.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import {
  RENDER_ENTRYPOINTS,
  declaredObject,
  renderCallSites,
  renderCallSitesIn,
  stripComments,
} from './helpers/render-call-sites.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;

const { serverRenderRequest } =
  await import('../client/lib/slide-runtime/slide-render.js');
const { PUBLIC_ROUTES: SHARE_PUBLIC_ROUTES } =
  await import('../server/routes/api/share-links/index.js');
const { ROUTES: FOLLOW_ROUTES } =
  await import('../server/routes/api/follow/index.js');
const { ROUTES: SESSION_ROUTES } =
  await import('../server/routes/api/live-session-audience.js');

/** The client entrypoints only: `renderSlideHtml` never asks the server. */
const CLIENT_ENTRYPOINTS = RENDER_ENTRYPOINTS.filter(
  (e) => e.name !== 'renderSlideHtml',
);

const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

// --- 1. Presence -----------------------------------------------------------

test('every client render call states renderVia, explicitly', () => {
  const offenders = [];
  for (const entry of CLIENT_ENTRYPOINTS) {
    for (const site of renderCallSites(repoRoot, entry, ['client'])) {
      const options = optionsText(site);
      if (options === null) {
        offenders.push(`${site.where} (options object is not declared here)`);
      } else if (!/(^|[\s,{])renderVia\s*[:,}\n]/.test(options)) {
        offenders.push(site.where);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `every render call must say where a server-rendered type comes from — { kind: 'deck', id } with a session, RENDER_VIA_THEME without a deck, or the capability an anonymous view holds:\n${offenders.join('\n')}`,
  );
});

/** A call site's options, with a same-file identifier resolved to its literal. */
function optionsText(site) {
  if (!/^[A-Za-z_$][\w$]*$/.test(site.options)) return site.options;
  return declaredObject(site.src, site.options);
}

// --- 2. The gate -----------------------------------------------------------

/**
 * The route tables mounted before the login gate, pinned by position in the API
 * dispatcher: a table only counts if its handler is called before
 * `unauthorized(res)`.
 */
function preGateTables() {
  const src = stripComments(read('server/routes/api/index.js'));
  const gate = src.indexOf('return unauthorized(res)');
  assert.ok(gate > 0, 'the login gate is where this guard expects it');
  const tables = [
    ['handleSharePublic', SHARE_PUBLIC_ROUTES],
    ['handleFollowPublic', FOLLOW_ROUTES],
    ['handleLiveSessionsPublic', SESSION_ROUTES],
  ];
  for (const [handler] of tables) {
    const at = src.indexOf(`${handler}(`);
    assert.ok(
      at > 0 && at < gate,
      `${handler} is mounted before the login gate`,
    );
  }
  return tables.map(([, routes]) => routes);
}

function matchesPreGate(tables, method, pathname) {
  return tables.some((routes) =>
    routes.some(
      (r) =>
        (!r.method || r.method === method) &&
        (typeof r.pattern === 'string'
          ? r.pattern === pathname
          : r.pattern.test(pathname)),
    ),
  );
}

/** The path a declared kind is rendered through, with placeholder values. */
function routeOf(kind) {
  return serverRenderRequest({
    slide: { id: 'slide-1', type: 'fork-type' },
    renderVia: {
      kind,
      id: '00000000-0000-4000-8000-000000000001',
      token: 'share-token',
      grant: 'grant',
    },
    mode: 'thumb',
    theme: null,
    lang: null,
  }).path;
}

/**
 * The views `client/app.js` mounts before it resolves a user: whatever
 * `render*` it mounts ahead of `if (!user)` is reachable without a login.
 */
function anonymousViewModules() {
  const src = stripComments(read('client/app.js'));
  const gate = src.search(/if \(!user\)/);
  assert.ok(gate > 0, 'app.js still asks for a user before the app routes');
  const mounted = [
    ...src.slice(0, gate).matchAll(/mount\(\s*(render\w+)\(/g),
  ].map((m) => m[1]);
  return mounted.map((name) => {
    const imp = new RegExp(
      `import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'([^']+)'`,
    ).exec(src);
    assert.ok(imp, `${name} is imported in app.js`);
    return resolve(repoRoot, 'client', imp[1]);
  });
}

/** Every client module statically or dynamically imported from `entries`. */
function reachableClientModules(entries) {
  const clientDir = join(repoRoot, 'client');
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !file.startsWith(clientDir) || !existsSync(file))
      continue;
    seen.add(file);
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(
      /(?:from\s*|import\s*\(\s*)'(\.{1,2}\/[^']+\.js)'/g,
    )) {
      queue.push(resolve(dirname(file), m[1]));
    }
  }
  return [...seen];
}

/** The kind a call site declares, when it is written down literally. */
function declaredKind(site) {
  const options = optionsText(site);
  if (options === null) return null;
  let via = /renderVia\s*:\s*(\{[^}]*\}|[A-Za-z_$][\w$]*)/.exec(options)?.[1];
  if (via === undefined && /(^|[\s,{])renderVia\s*[,}\n]/.test(options)) {
    via = 'renderVia';
  }
  if (!via) return null;
  if (!via.startsWith('{')) {
    if (via === 'RENDER_VIA_THEME') return 'theme';
    via = declaredObject(site.src, via) || '';
  }
  return /kind\s*:\s*'([\w-]+)'/.exec(via)?.[1] || null;
}

/**
 * Offending render calls in `files`: a kind that is not written down, or one
 * whose route no pre-gate table serves.
 */
function gateOffenders(files, tables) {
  const offenders = [];
  for (const { raw, where } of files) {
    for (const entry of CLIENT_ENTRYPOINTS) {
      for (const site of renderCallSitesIn(raw, where, entry)) {
        const kind = declaredKind(site);
        if (!kind) {
          offenders.push(`${site.where} (no literal renderVia kind)`);
          continue;
        }
        let path;
        try {
          path = routeOf(kind);
        } catch (err) {
          offenders.push(`${site.where} (${err.message})`);
          continue;
        }
        if (!matchesPreGate(tables, 'POST', path)) {
          offenders.push(`${site.where} (kind '${kind}' → POST ${path})`);
        }
      }
    }
  }
  return offenders;
}

test('no anonymous view renders through a route behind the login gate', () => {
  const tables = preGateTables();
  const files = reachableClientModules(anonymousViewModules()).map((file) => ({
    raw: readFileSync(file, 'utf8'),
    where: relative(repoRoot, file),
  }));
  assert.deepEqual(
    gateOffenders(files, tables),
    [],
    'an anonymous view must declare the capability it holds (share, follow, session)',
  );
});

test('the gate guard reaches the anonymous surfaces it was written for', () => {
  const anon = anonymousViewModules().map((f) => relative(repoRoot, f));
  for (const view of [
    'client/views/share-viewer.js',
    'client/views/follow.js',
    'client/views/notes.js',
  ]) {
    assert.ok(anon.includes(view), `${view} is found as an anonymous view`);
  }
  const reachable = reachableClientModules(anonymousViewModules()).map((f) =>
    relative(repoRoot, f),
  );
  for (const file of [
    'client/views/share-viewer/index.js',
    'client/views/follow/render-slide.js',
    'client/views/notes/index.js',
  ]) {
    assert.ok(reachable.includes(file), `${file} is scanned`);
  }
});

test('the gate guard tells the kinds apart, and would catch the old share viewer', () => {
  const tables = preGateTables();
  for (const kind of ['share', 'follow', 'session']) {
    assert.ok(matchesPreGate(tables, 'POST', routeOf(kind)), kind);
  }
  for (const kind of ['deck', 'theme']) {
    assert.ok(!matchesPreGate(tables, 'POST', routeOf(kind)), kind);
  }

  const imports =
    "import { renderSlideElement } from '../../lib/slide-runtime/slide-render.js';\n";
  const old = `${imports}renderSlideElement(slide, { mode: 'thumb', theme, presentationId: presentation.id, lang });`;
  const deck = `${imports}renderSlideElement(slide, { theme, renderVia: { kind: 'deck', id: presentation.id }, lang });`;
  const share = `${imports}renderSlideElement(slide, { theme, renderVia: { kind: 'share', token, grant }, lang });`;
  assert.equal(
    gateOffenders([{ raw: old, where: 'old-share-viewer.js' }], tables).length,
    1,
    'the pre-B287 share viewer declared nothing',
  );
  assert.equal(
    gateOffenders([{ raw: deck, where: 'deck.js' }], tables).length,
    1,
    'a deck route on an anonymous view',
  );
  assert.deepEqual(
    gateOffenders([{ raw: share, where: 'share.js' }], tables),
    [],
  );
});
