/**
 * A7.19 C8 fase 2 — batch 5 route-table migration.
 *
 * Seven modules (docs/reference/route-dispatch.md): `themes` is all Form A
 * with per-route designer guards; `api-keys` mirrors its original 405 tail as
 * trailing catch-alls (Form B); `font-families` mixes Form B (collection,
 * `/:id`) with Form A (Adobe + variant paths); `stock-media` splits a public
 * status row from the authed rows across two tables, all Form B;
 * `image-library` keeps its flag-before-method paths as single no-method
 * handlers; `jobs` is GET-only Form A; `live-sessions` is Form A on purpose
 * (the GET counterparts are public capability routes) with `/state` as a
 * guard-before-method single handler.
 *
 * Routing is asserted with `select()` over the exported ROUTES (storage-free);
 * 405/401 behaviour is asserted by invoking the entry function — which for a
 * wrong method or failing guard never reaches a real storage handler.
 *
 * Run with: node --test tests/c8-routes-batch-5-dispatch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ROUTES as THEME_ROUTES, handleThemes } from '../server/routes/api/themes.js';
import { ROUTES as KEY_ROUTES, handleApiKeys } from '../server/routes/api/api-keys.js';
import { ROUTES as FF_ROUTES, handleFontFamilies } from '../server/routes/api/font-families.js';
import {
  PUBLIC_ROUTES as SM_PUBLIC_ROUTES,
  AUTHED_ROUTES as SM_AUTHED_ROUTES,
  handleStockMedia,
} from '../server/routes/api/stock-media.js';
import { ROUTES as IL_ROUTES, handleImageLibrary } from '../server/routes/api/image-library.js';
import { ROUTES as JOB_ROUTES, handleJobs } from '../server/routes/api/jobs.js';
import { ROUTES as LS_ROUTES, handleLiveSessions } from '../server/routes/api/live-sessions.js';

function select(routes, method, pathname) {
  for (const route of routes) {
    if (route.method && method !== route.method) continue;
    if (typeof route.pattern === 'string') {
      if (pathname !== route.pattern) continue;
      return route;
    }
    if (!route.pattern.exec(pathname)) continue;
    return route;
  }
  return null;
}

function mockRes() {
  return {
    statusCode: null,
    headers: {},
    writeHead(c, headers) { this.statusCode = c; Object.assign(this.headers, headers); },
    end() {},
    setHeader(k, v) { this.headers[k] = v; },
  };
}

function ctx(method, pathname, authedUser = { email: 'a@b.test' }) {
  const res = mockRes();
  return {
    res,
    ctx: {
      repoRoot: '/tmp',
      storageScope: {},
      authedUser,
      req: { method, headers: {} },
      res,
      url: { pathname, searchParams: new URLSearchParams() },
    },
  };
}

function named(routes, method, path, handlerName) {
  const route = select(routes, method, path);
  assert.ok(route, `${method} ${path} matches a route`);
  assert.equal(route.handler.name, handlerName, `${method} ${path} → ${handlerName}`);
}

// ─── themes (no module guard, per-route designer guards; all Form A) ───

test('themes: routes resolve to their named handlers in order', () => {
  named(THEME_ROUTES, 'GET', '/api/themes', 'handleThemeList');
  named(THEME_ROUTES, 'GET', '/api/themes/fonts', 'handleThemeFonts');
  named(THEME_ROUTES, 'POST', '/api/themes/custom/preview-config', 'handleThemePreviewConfig');
  named(THEME_ROUTES, 'GET', '/api/themes/custom', 'handleCustomThemeList');
  named(THEME_ROUTES, 'POST', '/api/themes/custom', 'handleCustomThemeCreate');
  named(THEME_ROUTES, 'POST', '/api/themes/custom/clear-default', 'handleCustomThemeClearDefault');
  named(THEME_ROUTES, 'GET', '/api/themes/custom/abc123', 'handleCustomThemeGet');
  named(THEME_ROUTES, 'PUT', '/api/themes/custom/abc123', 'handleCustomThemeUpdate');
  named(THEME_ROUTES, 'DELETE', '/api/themes/custom/abc123', 'handleCustomThemeDelete');
  named(THEME_ROUTES, 'POST', '/api/themes/custom/abc123/set-default', 'handleCustomThemeSetDefault');
  named(THEME_ROUTES, 'GET', '/api/themes/custom/abc123/config', 'handleCustomThemeConfig');
});

test('themes: a wrong method falls through (Form A), designer guard 403s on mutations', async () => {
  assert.equal(select(THEME_ROUTES, 'DELETE', '/api/themes'), null);
  const wrongMethod = ctx('DELETE', '/api/themes');
  assert.equal(await handleThemes(wrongMethod.ctx), false);

  // canManage fails for a plain user → 403 before any storage call.
  const nonDesigner = ctx('POST', '/api/themes/custom');
  await handleThemes(nonDesigner.ctx);
  assert.equal(nonDesigner.res.statusCode, 403, 'POST custom without canManage → 403');
});

test('themes: an unknown sub-path falls through', async () => {
  const { ctx: c } = ctx('GET', '/api/themes/nope/deep');
  assert.equal(await handleThemes(c), false);
});

// ─── api-keys (prefix + fall-through auth guard; Form B 405 tail) ───

test('api-keys: routes resolve to their named handlers in order', () => {
  named(KEY_ROUTES, 'GET', '/api/api-keys', 'handleApiKeyList');
  named(KEY_ROUTES, 'POST', '/api/api-keys', 'handleApiKeyCreate');
  named(KEY_ROUTES, 'GET', '/api/api-keys/k-1/usage', 'handleApiKeyUsage');
  named(KEY_ROUTES, 'GET', '/api/api-keys/k-1', 'handleApiKeyGet');
  named(KEY_ROUTES, 'DELETE', '/api/api-keys/k-1', 'handleApiKeyRevoke');
});

test('api-keys: a wrong method 405s with the pinned Allow list', async () => {
  for (const [method, path, allow] of [
    ['DELETE', '/api/api-keys', 'GET, POST'],
    ['PUT', '/api/api-keys/k-1', 'GET, DELETE'],
    ['POST', '/api/api-keys/k-1/usage', 'GET'],
  ]) {
    const { ctx: c, res } = ctx(method, path);
    await handleApiKeys(c);
    assert.equal(res.statusCode, 405, `${method} ${path} → 405`);
    assert.equal(res.headers.Allow, allow, `${method} ${path} → Allow: ${allow}`);
  }
});

test('api-keys: module guards — foreign prefix and unauth fall through', () => {
  const foreign = ctx('GET', '/api/api-nope');
  assert.equal(handleApiKeys(foreign.ctx), false);

  // The original guard returned false (not a 401) without a user — pinned.
  const unauth = ctx('GET', '/api/api-keys', null);
  assert.equal(handleApiKeys(unauth.ctx), false);
  assert.equal(unauth.res.statusCode, null, 'no status written for unauth');
});

// ─── font-families (per-route guards; Form B collection + /:id, Form A rest) ───

test('font-families: routes resolve to their named handlers in order', () => {
  named(FF_ROUTES, 'GET', '/api/font-families', 'handleFontFamilyList');
  named(FF_ROUTES, 'POST', '/api/font-families', 'handleFontFamilyCreate');
  named(FF_ROUTES, 'POST', '/api/font-families/discover-adobe', 'handleFontFamilyDiscoverAdobe');
  named(FF_ROUTES, 'POST', '/api/font-families/import-adobe-family', 'handleFontFamilyImportAdobe');
  named(FF_ROUTES, 'POST', '/api/font-families/abc123/upload-variant', 'handleFontFamilyUploadVariant');
  named(FF_ROUTES, 'DELETE', '/api/font-families/abc123/variants/def456', 'handleFontFamilyRemoveVariant');
  named(FF_ROUTES, 'GET', '/api/font-families/abc123', 'handleFontFamilyGet');
  named(FF_ROUTES, 'PUT', '/api/font-families/abc123', 'handleFontFamilyUpdate');
  named(FF_ROUTES, 'DELETE', '/api/font-families/abc123', 'handleFontFamilyDelete');
});

test('font-families: a wrong method 405s where the original did', async () => {
  for (const [method, path, allow] of [
    ['DELETE', '/api/font-families', 'GET, POST'],
    ['PATCH', '/api/font-families/abc123', 'GET, PUT, DELETE'],
  ]) {
    const { ctx: c, res } = ctx(method, path);
    await handleFontFamilies(c);
    assert.equal(res.statusCode, 405, `${method} ${path} → 405`);
    assert.equal(res.headers.Allow, allow, `${method} ${path} → Allow: ${allow}`);
  }
});

test('font-families: the Adobe and variant paths fall through on a wrong method (Form A)', async () => {
  assert.equal(select(FF_ROUTES, 'GET', '/api/font-families/discover-adobe'), null);
  assert.equal(select(FF_ROUTES, 'GET', '/api/font-families/abc123/upload-variant'), null);
  assert.equal(select(FF_ROUTES, 'GET', '/api/font-families/abc123/variants/def456'), null);
  const { ctx: c } = ctx('GET', '/api/font-families/discover-adobe');
  assert.equal(await handleFontFamilies(c), false);
});

test('font-families: designer guard 401s on a mutation before storage', async () => {
  const nonDesigner = ctx('POST', '/api/font-families');
  await handleFontFamilies(nonDesigner.ctx);
  assert.equal(nonDesigner.res.statusCode, 401, 'POST without canManage → 401');
});

// ─── stock-media (public status row + fall-through auth guard + authed rows) ───

test('stock-media: routes resolve to their named handlers', () => {
  named(SM_PUBLIC_ROUTES, 'GET', '/api/stock-media/status', 'handleStockMediaProviderStatus');
  named(SM_AUTHED_ROUTES, 'GET', '/api/stock-media/bundled/manifest', 'handleBundledManifest');
  named(SM_AUTHED_ROUTES, 'GET', '/api/stock-media/unsplash/search', 'handleUnsplashSearch');
  named(SM_AUTHED_ROUTES, 'POST', '/api/stock-media/unsplash/download', 'handleUnsplashDownload');
  named(SM_AUTHED_ROUTES, 'GET', '/api/stock-media/giphy/search', 'handleGiphySearch');
  named(SM_AUTHED_ROUTES, 'GET', '/api/stock-media/giphy/trending', 'handleGiphyTrending');
  named(SM_AUTHED_ROUTES, 'POST', '/api/stock-media/giphy/download', 'handleGiphyDownload');
});

test('stock-media: /status stays public and 405s on a wrong method before the auth guard', async () => {
  const { ctx: c, res } = ctx('POST', '/api/stock-media/status', null);
  await handleStockMedia(c);
  assert.equal(res.statusCode, 405, 'POST status (unauth) → 405, not fall-through');
  assert.equal(res.headers.Allow, 'GET');
});

test('stock-media: the auth guard falls through for the authed rows', async () => {
  const unauth = ctx('GET', '/api/stock-media/unsplash/search', null);
  assert.equal(await handleStockMedia(unauth.ctx), false);
  assert.equal(unauth.res.statusCode, null, 'no status written for unauth');
});

test('stock-media: a wrong method 405s with the pinned Allow list (authed)', async () => {
  for (const [method, path, allow] of [
    ['POST', '/api/stock-media/bundled/manifest', 'GET'],
    ['GET', '/api/stock-media/unsplash/download', 'POST'],
    ['POST', '/api/stock-media/giphy/trending', 'GET'],
    ['GET', '/api/stock-media/giphy/download', 'POST'],
  ]) {
    const { ctx: c, res } = ctx(method, path);
    await handleStockMedia(c);
    assert.equal(res.statusCode, 405, `${method} ${path} → 405`);
    assert.equal(res.headers.Allow, allow, `${method} ${path} → Allow: ${allow}`);
  }
});

// ─── image-library (flag-before-method single handlers; order load-bearing) ───

test('image-library: routes resolve to their named handlers in order', () => {
  named(IL_ROUTES, 'GET', '/api/image-library', 'handleImageLibraryCollection');
  named(IL_ROUTES, 'POST', '/api/image-library/generate-alts', 'handleGenerateAltsPreview');
  named(IL_ROUTES, 'GET', '/api/image-library/img-1/usage', 'handleImageUsage');
  named(IL_ROUTES, 'POST', '/api/image-library/img-1/generate-alts', 'handleItemGenerateAlts');
  named(IL_ROUTES, 'POST', '/api/image-library/img-1/replace-upload', 'handleReplaceUpload');
  named(IL_ROUTES, 'POST', '/api/image-library/img-1/favorite', 'handleToggleFavorite');
  named(IL_ROUTES, 'GET', '/api/image-library/img-1', 'handleImageItem');
});

test('image-library: the exact /generate-alts rows shadow the /:id regex (first-match order)', () => {
  // Without the exact rows first, the `[^/]+` item pattern would swallow
  // `/generate-alts` as an image id. A non-POST hits the exact catch-all
  // (405), never handleImageItem.
  named(IL_ROUTES, 'POST', '/api/image-library/generate-alts', 'handleGenerateAltsPreview');
  const wrongMethod = select(IL_ROUTES, 'GET', '/api/image-library/generate-alts');
  assert.ok(wrongMethod, 'GET generate-alts matches the catch-all row');
  assert.notEqual(wrongMethod.handler.name, 'handleImageItem', 'the /:id row never sees it');
});

test('image-library: collection-level generate-alts keeps its explicit 405', async () => {
  const { ctx: c, res } = ctx('DELETE', '/api/image-library/generate-alts');
  await handleImageLibrary(c);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('image-library: an unknown deep sub-path falls through', async () => {
  const { ctx: c } = ctx('GET', '/api/image-library/img-1/nope');
  assert.equal(await handleImageLibrary(c), false);
});

// ─── jobs (GET-only Form A; prefix guard) ───

test('jobs: routes resolve to their named handlers in order', () => {
  named(JOB_ROUTES, 'GET', '/api/jobs/export-1/download', 'handleJobDownload');
  named(JOB_ROUTES, 'GET', '/api/jobs/queue/export/stats', 'handleQueueStats');
  named(JOB_ROUTES, 'GET', '/api/jobs/export-1', 'handleGetJobStatus');
});

test('jobs: a non-GET falls through (Form A), matching the old module-wide guard', async () => {
  assert.equal(select(JOB_ROUTES, 'POST', '/api/jobs/export-1'), null);
  const { ctx: c } = ctx('POST', '/api/jobs/export-1');
  assert.equal(await handleJobs(c), false);
});

test('jobs: module guards — foreign prefix falls through, stats requires admin', async () => {
  const foreign = ctx('GET', '/api/not-jobs');
  assert.equal(await handleJobs(foreign.ctx), false);

  const nonAdmin = ctx('GET', '/api/jobs/queue/export/stats');
  await handleJobs(nonAdmin.ctx);
  assert.equal(nonAdmin.res.statusCode, 403, 'non-admin stats → 403');
});

// ─── live-sessions (presenter block; Form A on purpose, /state single handler) ───

test('live-sessions: routes resolve to their named handlers in order', () => {
  named(LS_ROUTES, 'POST', '/api/live-sessions', 'handleLiveSessionCreate');
  named(LS_ROUTES, 'PUT', '/api/live-sessions/s-1/state', 'handleLiveSessionStatePush');
  named(LS_ROUTES, 'POST', '/api/live-sessions/s-1/interactions/slide-1/open', 'handleLiveSessionInteractionAction');
  named(LS_ROUTES, 'GET', '/api/live-sessions/s-1/feedback/slide-1.csv', 'handleLiveSessionFeedbackExport');
  named(LS_ROUTES, 'POST', '/api/live-sessions/s-1/control/enable', 'handleLiveSessionControlEnable');
  named(LS_ROUTES, 'POST', '/api/live-sessions/s-1/control/disable', 'handleLiveSessionControlDisable');
  named(LS_ROUTES, 'POST', '/api/live-sessions/s-1/control', 'handleLiveSessionControlCommand');
});

test('live-sessions: /state matches any method (guard-before-method single handler)', () => {
  // The session-existence check answers 404 before the method decision; the
  // 405 for a non-POST comes from inside the handler, after that check.
  for (const method of ['POST', 'PUT', 'DELETE']) {
    named(LS_ROUTES, method, '/api/live-sessions/s-1/state', 'handleLiveSessionStatePush');
  }
});

test('live-sessions: other paths fall through on a wrong method (Form A, on purpose)', async () => {
  // Their GET counterparts are capability-based audience routes served from
  // the public block — a 405 here would shadow nothing but must not appear.
  assert.equal(select(LS_ROUTES, 'GET', '/api/live-sessions'), null);
  assert.equal(select(LS_ROUTES, 'GET', '/api/live-sessions/s-1/control'), null);
  assert.equal(select(LS_ROUTES, 'POST', '/api/live-sessions/s-1/feedback/slide-1.csv'), null);
  const { ctx: c } = ctx('GET', '/api/live-sessions');
  assert.equal(await handleLiveSessions(c), false);
});

test('live-sessions: the interaction action captures all three params', () => {
  const route = select(LS_ROUTES, 'POST', '/api/live-sessions/s-1/interactions/slide-1/reset');
  const match = route.pattern.exec('/api/live-sessions/s-1/interactions/slide-1/reset');
  assert.deepEqual(match.slice(1), ['s-1', 'slide-1', 'reset']);
});
