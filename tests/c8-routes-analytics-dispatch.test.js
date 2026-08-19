/**
 * A7.19 C8 fase 2 — analytics family route-table migration.
 *
 * Three modules (docs/reference/route-dispatch.md), all Form A (every route is
 * method-bearing; a method mismatch falls through — the original if-chains sent
 * no 405):
 *
 *   - `analytics/index.js`  — the authenticated surface, spanning both
 *     `/api/analytics/*` and the per-presentation `/api/presentations/:id/
 *     analytics/*` sub-tree. No prefix guard; the module-wide rate limit runs
 *     in the entry function before dispatch.
 *   - `analytics-track.js`  — five public POST tracking-ingest routes.
 *   - `analytics/public.js` — one public GET report-by-token route.
 *
 * Routing is asserted with `select()` over the exported tables (storage-free).
 * The public entry functions are invoked for a wrong method to prove
 * fall-through without reaching a handler (the authed entry runs a rate-limit
 * check before dispatch, so its routing is asserted structurally only).
 *
 * Run with: node --test tests/c8-routes-analytics-dispatch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ROUTES as INDEX_ROUTES } from '../server/routes/api/analytics/index.js';
import {
  ROUTES as TRACK_ROUTES,
  handleAnalyticsTrack,
} from '../server/routes/api/analytics-track.js';
import {
  ROUTES as PUBLIC_ROUTES,
  handleAnalyticsReportPublic,
} from '../server/routes/api/analytics/public.js';

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

function named(routes, method, path, handlerName) {
  const route = select(routes, method, path);
  assert.ok(route, `${method} ${path} matches a route`);
  assert.equal(
    route.handler.name,
    handlerName,
    `${method} ${path} → ${handlerName}`,
  );
}

function ctx(method, pathname) {
  return {
    repoRoot: '/tmp',
    req: { method, headers: {} },
    res: {},
    url: { pathname, searchParams: new URLSearchParams() },
  };
}

// ─── analytics/index.js (authenticated; two path prefixes) ───

test('analytics(index): dashboard + GDPR routes resolve in order', () => {
  named(INDEX_ROUTES, 'GET', '/api/analytics/dashboard', 'handleDashboard');
  named(
    INDEX_ROUTES,
    'GET',
    '/api/analytics/presentations',
    'handlePresentationsList',
  );
  named(INDEX_ROUTES, 'GET', '/api/analytics/my-data', 'handleExportMyData');
  named(INDEX_ROUTES, 'DELETE', '/api/analytics/my-data', 'handleDeleteMyData');
});

test('analytics(index): per-presentation metrics routes resolve with the id capture', () => {
  named(
    INDEX_ROUTES,
    'GET',
    '/api/presentations/p-1/analytics',
    'handleOverview',
  );
  named(
    INDEX_ROUTES,
    'GET',
    '/api/presentations/p-1/analytics/slides',
    'handleSlides',
  );
  named(
    INDEX_ROUTES,
    'GET',
    '/api/presentations/p-1/analytics/heatmap',
    'handleHeatmap',
  );
  named(
    INDEX_ROUTES,
    'GET',
    '/api/presentations/p-1/analytics/journey',
    'handleJourney',
  );
  named(
    INDEX_ROUTES,
    'GET',
    '/api/presentations/p-1/analytics/sessions',
    'handleSessions',
  );
  named(
    INDEX_ROUTES,
    'GET',
    '/api/presentations/p-1/analytics/realtime',
    'handleRealtime',
  );

  const overview = select(
    INDEX_ROUTES,
    'GET',
    '/api/presentations/p-1/analytics',
  );
  assert.deepEqual(
    overview.pattern.exec('/api/presentations/p-1/analytics').slice(1),
    ['p-1'],
  );
});

test('analytics(index): report CRUD splits by method on the same pattern, in order', () => {
  named(
    INDEX_ROUTES,
    'GET',
    '/api/presentations/p-1/analytics/reports',
    'handleListReports',
  );
  named(
    INDEX_ROUTES,
    'POST',
    '/api/presentations/p-1/analytics/reports',
    'handleCreateReport',
  );
  named(
    INDEX_ROUTES,
    'GET',
    '/api/presentations/p-1/analytics/reports/r-1',
    'handleGetReport',
  );
  named(
    INDEX_ROUTES,
    'PATCH',
    '/api/presentations/p-1/analytics/reports/r-1',
    'handleUpdateReport',
  );
  named(
    INDEX_ROUTES,
    'DELETE',
    '/api/presentations/p-1/analytics/reports/r-1',
    'handleDeleteReport',
  );
  named(
    INDEX_ROUTES,
    'POST',
    '/api/presentations/p-1/analytics/reports/r-1/regenerate-token',
    'handleRegenerateToken',
  );

  const item = select(
    INDEX_ROUTES,
    'GET',
    '/api/presentations/p-1/analytics/reports/r-1',
  );
  assert.deepEqual(
    item.pattern.exec('/api/presentations/p-1/analytics/reports/r-1').slice(1),
    ['p-1', 'r-1'],
  );
});

test('analytics(index): overlapping report patterns do not swallow one another', () => {
  // The reports collection pattern must not match a report item or the
  // regenerate-token sub-path (the `([^/]+)` captures never span a slash).
  assert.equal(
    select(INDEX_ROUTES, 'GET', '/api/presentations/p-1/analytics/reports')
      ?.handler.name,
    'handleListReports',
  );
  assert.equal(
    select(INDEX_ROUTES, 'GET', '/api/presentations/p-1/analytics/reports/r-1')
      ?.handler.name,
    'handleGetReport',
  );
  // regenerate-token is POST-only; a GET on that path matches nothing.
  assert.equal(
    select(
      INDEX_ROUTES,
      'GET',
      '/api/presentations/p-1/analytics/reports/r-1/regenerate-token',
    ),
    null,
  );
});

test('analytics(index): a wrong method on a report path matches no route (falls through, no 405)', () => {
  // DELETE on the collection, PUT on an item — the original chain fell to false.
  assert.equal(
    select(INDEX_ROUTES, 'DELETE', '/api/presentations/p-1/analytics/reports'),
    null,
  );
  assert.equal(
    select(INDEX_ROUTES, 'PUT', '/api/presentations/p-1/analytics/reports/r-1'),
    null,
  );
  assert.equal(select(INDEX_ROUTES, 'POST', '/api/analytics/dashboard'), null);
});

// ─── analytics-track.js (public POST ingest; Form A) ───

test('analytics-track: the five tracking routes resolve to their named handlers', () => {
  named(
    TRACK_ROUTES,
    'POST',
    '/api/track/session/start',
    'handleTrackSessionStart',
  );
  named(
    TRACK_ROUTES,
    'POST',
    '/api/track/session/heartbeat',
    'handleTrackSessionHeartbeat',
  );
  named(
    TRACK_ROUTES,
    'POST',
    '/api/track/session/end',
    'handleTrackSessionEnd',
  );
  named(TRACK_ROUTES, 'POST', '/api/track/slide/view', 'handleTrackSlideView');
  named(
    TRACK_ROUTES,
    'POST',
    '/api/track/my-data/erase',
    'handleTrackMyDataErase',
  );
});

test('analytics-track: a wrong method falls through without touching a handler', async () => {
  // GET on a POST-only ingest path never reaches allowRequest/storage.
  for (const path of [
    '/api/track/session/start',
    '/api/track/session/heartbeat',
    '/api/track/session/end',
    '/api/track/slide/view',
    '/api/track/my-data/erase',
  ]) {
    assert.equal(
      select(TRACK_ROUTES, 'GET', path),
      null,
      `GET ${path} matches no route`,
    );
    assert.equal(
      await handleAnalyticsTrack(ctx('GET', path)),
      false,
      `GET ${path} → false`,
    );
  }
  assert.equal(
    await handleAnalyticsTrack(ctx('POST', '/api/track/unknown')),
    false,
  );
});

// ─── analytics/public.js (public GET report-by-token; Form A) ───

test('analytics-public: the report-by-token route resolves with the token capture', () => {
  named(
    PUBLIC_ROUTES,
    'GET',
    '/api/analytics/reports/abc123',
    'handlePublicReport',
  );
  const route = select(PUBLIC_ROUTES, 'GET', '/api/analytics/reports/abc123');
  assert.deepEqual(
    route.pattern.exec('/api/analytics/reports/abc123').slice(1),
    ['abc123'],
  );
});

test('analytics-public: a wrong method or unknown path falls through', async () => {
  assert.equal(
    select(PUBLIC_ROUTES, 'POST', '/api/analytics/reports/abc123'),
    null,
  );
  assert.equal(
    await handleAnalyticsReportPublic(
      ctx('POST', '/api/analytics/reports/abc123'),
    ),
    false,
  );
  assert.equal(
    await handleAnalyticsReportPublic(ctx('GET', '/api/analytics/other')),
    false,
  );
});
