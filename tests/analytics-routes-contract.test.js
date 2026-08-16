/**
 * The analytics route layer beyond the GDPR self-service path (test-coverage
 * gap map, B40 — surface 1, "analytics-rest").
 *
 * `server/routes/api/analytics/{dashboard,metrics,reports,public}.js` are the
 * dashboards, the per-deck metric readers, the shareable-report CRUD and the
 * public report viewer. The storage beneath them is exercised elsewhere; the
 * route layer — who may read a deck's analytics, who may mint and revoke a
 * report share-link, and what the anonymous report viewer will and will not
 * serve — was not. The GDPR endpoints (`analytics/gdpr.js`) already have their
 * own file (`tests/analytics-gdpr-delete-path.test.js`, PR #627) and the
 * session device-label narrowing has `tests/analytics-session-device-label.js`;
 * neither is repeated here.
 *
 * Two rules carry this surface and are stated here as assertions:
 *
 *   1. **A deck's analytics inherit the deck's authorization.** Every
 *      per-presentation reader and every report route loads the deck through
 *      `withPresentationAuth` first: a missing deck is a 404, a deck the caller
 *      cannot read is a 401, and *managing reports is writing* — creating,
 *      updating, deleting or re-tokenising a report needs write access, which a
 *      view-only collaborator does not have even though they may read the same
 *      deck's metrics. The org dashboards additionally refuse an
 *      unauthenticated caller outright (401) before any query.
 *   2. **The report share token is the whole authorization on the public path,
 *      and it is not enough on its own.** `GET /api/analytics/reports/:token`
 *      serves a report only when the token is well-formed (64 hex), names a
 *      *public* report that has not expired, and whose deck still exists and is
 *      not private — a report share-link goes dark the moment its deck is
 *      deleted or set to private.
 *
 * Feasibility note (opt-out, logged in briefs/test-coverage-gaps.md): the
 * dashboard and per-slide metric happy paths run analytical SQL — `date_trunc`,
 * `COUNT(DISTINCT …)`, `GROUP BY` (server/storage/analytics/{dashboard,
 * aggregations}.js) — that the in-memory double deliberately does not model and
 * throws on. So those handlers are pinned here at their authorization and
 * validation gates only (the branches before storage); the aggregation result
 * shapes are a `.pgtest.js`/e2e concern, the same class as the browser-only
 * PPTX path and the LLM vendor seam already opted out in the brief. The report
 * CRUD, the public report viewer and the session list use only simple queries
 * and are pinned end to end. Two further scope notes: `realtime.js` (SSE) is
 * left out with the other stream endpoints, and the handlers are driven
 * directly, so the module-level dispatch table and the `analytics:auth` rate
 * limit in `index.js` are not pinned here.
 *
 * House shape (see `tests/collaborators-permission-model.test.js`): the exported
 * handler is called directly with a req/res double over `tests/helpers/fake-db.js`,
 * with the same `createStorageScope(authedUser, { repoRoot })` scope the router
 * builds. No HTTP server, no browser.
 *
 * Run with: node --test tests/analytics-routes-contract.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } = await import(
  '../server/storage/adapters/index.js'
);
const { createStorageScope } = await import('../server/utils/context.js');
const { invalidatePermission } = await import(
  '../server/storage/cache/permission-cache.js'
);
const { resetRateLimitBuckets } = await import('../server/utils/rate-limit.js');
const { AUTH_RATE_LIMITS } = await import('../server/config/rate-limits.js');
const { handleDashboard, handlePresentationsList } = await import(
  '../server/routes/api/analytics/dashboard.js'
);
const { handleOverview, handleSlides, handleHeatmap, handleJourney, handleSessions } =
  await import('../server/routes/api/analytics/metrics.js');
const {
  handleListReports,
  handleGetReport,
  handleCreateReport,
  handleUpdateReport,
  handleDeleteReport,
  handleRegenerateToken,
} = await import('../server/routes/api/analytics/reports.js');
const { handleAnalyticsReportPublic } = await import(
  '../server/routes/api/analytics/index.js'
);

// ---------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------

/** @typedef {{email: string, name: string, organizationId: string}} Actor */

const ACTORS = {
  owner: { email: 'owner@example.com', name: 'Olive', organizationId: ORG },
  viewer: { email: 'viewer@example.com', name: 'Vera', organizationId: ORG },
  stranger: { email: 'stranger@example.com', name: 'Sam', organizationId: ORG },
  outsider: { email: 'outsider@other.example', name: 'Otto', organizationId: OTHER_ORG },
};

// Decks used across the file. `deck-owned` is a private deck Olive owns;
// `deck-org` is an organization-visible deck (so the public report path can
// serve a report about it); `deck-foreign` lives in another organization.
const DECKS = ['deck-owned', 'deck-org', 'deck-foreign', 'ghost-deck'];

// Well-formed (64-hex) report share tokens. `PUBLIC_TOKEN` names the one live,
// public report; the others exercise the ways the public path still refuses a
// valid-looking token.
const PUBLIC_TOKEN = 'a1b2c3d4'.repeat(8);
const GHOST_DECK_TOKEN = 'b'.repeat(64); // report whose deck no longer exists
const PRIVATE_DECK_TOKEN = 'c'.repeat(64); // report whose deck went private
const EXPIRED_TOKEN = 'd'.repeat(64); // public report past its expiry
const UNKNOWN_TOKEN = 'e'.repeat(64); // well-formed, never minted

const PUBLIC_CAP = AUTH_RATE_LIMITS.publicReport.capacity;

const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default', slug: 'default' }] }));
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

test.beforeEach(() => {
  resetRateLimitBuckets();
});

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/** @param {Actor} actor */
function userRow(actor) {
  return {
    id: `user-${actor.email.split('@')[0]}`,
    organization_id: actor.organizationId,
    email: actor.email,
    name: actor.name,
    role: 'user',
    auth_source: 'database',
    password_hash: null,
    settings: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

/** A stored deck, in the shape the presentations adapter reads. */
function deckRow(overrides) {
  return {
    organization_id: ORG,
    title: `Title of ${overrides.id}`,
    owner_email: ACTORS.owner.email,
    created_by: ACTORS.owner.email,
    updated_by: ACTORS.owner.email,
    visibility: 'private',
    theme: 'default',
    lang: 'nl',
    revision: 1,
    is_view_only: false,
    slides: [],
    i18n: null,
    settings: {},
    created_at: '2026-02-01T00:00:00.000Z',
    modified_at: '2026-02-01T00:00:00.000Z',
    trashed_at: null,
    ...overrides,
  };
}

/** An `analytics_reports` row, in the shape `createAnalyticsReport` writes. */
function reportRow(overrides) {
  return {
    id: overrides.id,
    organization_id: ORG,
    presentation_id: 'deck-owned',
    title: `Report ${overrides.id}`,
    report_type: 'summary',
    start_date: '2026-01-01',
    end_date: '2026-01-31',
    share_token: null,
    share_expires_at: null,
    is_public: false,
    report_data: { overview: {} },
    generated_at: '2026-02-01T00:00:00.000Z',
    created_by: ACTORS.owner.email,
    created_at: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A `view_sessions` row for the session-list happy path. */
function sessionRow({ id, deck = 'deck-owned', email = null, device = null }) {
  return {
    id,
    presentation_id: deck,
    session_token: `tok-${id}`,
    source_type: 'share_link',
    source_id: null,
    viewer_type: email ? 'authenticated' : 'anonymous',
    viewer_email: email,
    device_id: device,
    started_at: '2026-01-02T00:00:00.000Z',
    last_activity_at: '2026-01-02T00:00:00.000Z',
    ended_at: null,
    duration_seconds: 0,
    exit_slide_index: null,
    ip_address: '203.0.113.5',
    user_agent: 'UA/1.0',
    attribution_allowed: false,
    created_at: '2026-01-02T00:00:00.000Z',
  };
}

/**
 * Reinstall a freshly seeded double and drop the collaborator permission cache
 * for every (deck, person) pair, so a grant one test relies on cannot answer a
 * lookup in the next (five-minute TTL; see the note in the collaborators file).
 * @returns {Promise<ReturnType<typeof createFakeDb>>}
 */
async function seed() {
  db = createFakeDb({
    organizations: [
      { id: ORG, name: 'Default', slug: 'default' },
      { id: OTHER_ORG, name: 'Other', slug: 'other' },
    ],
    users: Object.values(ACTORS).map(userRow),
    presentations: [
      deckRow({ id: 'deck-owned' }),
      deckRow({ id: 'deck-org', visibility: 'organization' }),
      deckRow({
        id: 'deck-foreign',
        organization_id: OTHER_ORG,
        owner_email: ACTORS.outsider.email,
        created_by: ACTORS.outsider.email,
        updated_by: ACTORS.outsider.email,
      }),
    ],
    presentation_collaborators: [
      {
        id: 'c-viewer',
        organization_id: ORG,
        presentation_id: 'deck-owned',
        user_id: null,
        user_email: ACTORS.viewer.email,
        permission: 'view',
        invited_by: ACTORS.owner.email,
        invited_at: '2026-02-01T00:00:00.000Z',
        accepted_at: null,
        revoked_at: null,
        revoked_by: null,
        revocation_message: null,
      },
    ],
    analytics_reports: [
      reportRow({ id: 'r-1' }),
      reportRow({ id: 'r-2', title: 'Report r-2' }),
      // The live public report: a public deck, a real token, no expiry.
      reportRow({
        id: 'r-pub',
        presentation_id: 'deck-org',
        is_public: true,
        share_token: PUBLIC_TOKEN,
      }),
      // Public, but its deck no longer exists.
      reportRow({
        id: 'r-ghost',
        presentation_id: 'ghost-deck',
        is_public: true,
        share_token: GHOST_DECK_TOKEN,
      }),
      // Public, but its deck is private.
      reportRow({
        id: 'r-priv',
        presentation_id: 'deck-owned',
        is_public: true,
        share_token: PRIVATE_DECK_TOKEN,
      }),
      // Public, but expired.
      reportRow({
        id: 'r-exp',
        presentation_id: 'deck-org',
        is_public: true,
        share_token: EXPIRED_TOKEN,
        share_expires_at: PAST,
      }),
    ],
    view_sessions: [
      sessionRow({ id: 's-auth', email: 'someone@example.com', device: 'dev-1' }),
      sessionRow({ id: 's-anon', device: 'dev-2' }),
    ],
    slide_views: [],
  });
  __setTestDb(db);

  for (const deck of DECKS) {
    for (const actor of Object.values(ACTORS)) {
      await invalidatePermission(deck, actor.email);
    }
  }
  return db;
}

// ---------------------------------------------------------------------------
// Driving the handlers
// ---------------------------------------------------------------------------

/** A response double capturing the status/headers/body the helpers write. */
function makeRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
      return this;
    },
  };
}

/**
 * Call an authenticated analytics handler the way `dispatchRoutes` does — the
 * regex captures (presentationId, reportId) arrive as trailing positional args.
 *
 * @param {Function} handler
 * @param {string} method
 * @param {string} path
 * @param {Object} [options]
 * @param {Actor|null} [options.as] - Acting user; omit for anonymous.
 * @param {Object} [options.body] - JSON request body.
 * @param {Array<string>} [options.args] - Path captures for the handler.
 * @returns {Promise<{handled: *, res: Object}>}
 */
async function call(handler, method, path, { as = null, body, args = [] } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = {
    method,
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };
  const res = makeRes();
  const authedUser = as || undefined;
  const handled = await handler(
    {
      repoRoot: process.cwd(),
      storageScope: createStorageScope(authedUser, { repoRoot: process.cwd() }),
      req,
      res,
      url: new URL(`http://decks.example.test${path}`),
      authedUser,
    },
    ...args
  );
  return { handled, res };
}

/** Call the anonymous public-report entry the way `routes/api/index.js` does. */
async function callPublic(method, token) {
  const req = {
    method,
    headers: { host: 'decks.example.test' },
    socket: { remoteAddress: '198.51.100.7' },
  };
  const res = makeRes();
  const handled = await handleAnalyticsReportPublic({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL(`http://decks.example.test/api/analytics/reports/${token}`),
  });
  return { handled, res };
}

const reportsTable = () => db.__tables.analytics_reports;
const reportById = (id) => reportsTable().find((r) => r.id === id);

// ===========================================================================
// dashboard.js — the org dashboards refuse an anonymous caller, then validate
// ===========================================================================

test('dashboard refuses an unauthenticated caller with a 401', async () => {
  await seed();
  const { res } = await call(handleDashboard, 'GET', '/api/analytics/dashboard');

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'unauthorized');
  assert.deepEqual(db.__queryLog, [], 'the 401 is returned before any query');
});

test('dashboard rejects an unknown period with a 400', async () => {
  await seed();
  const { res } = await call(handleDashboard, 'GET', '/api/analytics/dashboard?period=all-time', {
    as: ACTORS.owner,
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad_request');
});

test('presentations list refuses an unauthenticated caller with a 401', async () => {
  await seed();
  const { res } = await call(handlePresentationsList, 'GET', '/api/analytics/presentations');

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'unauthorized');
});

test('presentations list rejects an unknown period and an unknown sort', async () => {
  await seed();
  const badPeriod = await call(handlePresentationsList, 'GET', '/api/analytics/presentations?period=x', {
    as: ACTORS.owner,
  });
  assert.equal(badPeriod.res.statusCode, 400);

  const badSort = await call(handlePresentationsList, 'GET', '/api/analytics/presentations?sort=alphabetical', {
    as: ACTORS.owner,
  });
  assert.equal(badSort.res.statusCode, 400);
});

// ===========================================================================
// metrics.js — every reader inherits the deck's read authorization
// ===========================================================================

// The five per-presentation readers gate identically through
// `withPresentationAuth(read)`; the check is repeated per handler, so it is
// pinned per handler rather than once.
const READERS = [
  ['overview', handleOverview],
  ['slides', handleSlides],
  ['heatmap', handleHeatmap],
  ['journey', handleJourney],
  ['sessions', handleSessions],
];

for (const [name, handler] of READERS) {
  test(`${name} is a 404 when the deck does not exist`, async () => {
    await seed();
    const { res } = await call(handler, 'GET', `/api/presentations/nope/analytics/${name}`, {
      as: ACTORS.owner,
      args: ['nope'],
    });

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'not_found');
  });

  test(`${name} is a 401 for someone who cannot read the deck`, async () => {
    await seed();
    const { res } = await call(handler, 'GET', `/api/presentations/deck-owned/analytics/${name}`, {
      as: ACTORS.stranger,
      args: ['deck-owned'],
    });

    assert.equal(res.statusCode, 401, 'a same-org non-collaborator has no read access to a private deck');
    assert.equal(res.body.error, 'unauthorized');
  });
}

test('org visibility stops at the org boundary: an outsider cannot read metrics', async () => {
  await seed();
  const { res } = await call(handleOverview, 'GET', '/api/presentations/deck-org/analytics/overview', {
    as: ACTORS.outsider,
    args: ['deck-org'],
  });

  // The outsider's storage scope is their own organization, so the deck does
  // not resolve at all: a 404, which also refuses to confirm the deck exists.
  assert.equal(res.statusCode, 404, 'organization visibility never crosses into another organization');
});

test('sessions returns the deck’s sessions with the session token stripped', async () => {
  await seed();
  const { res } = await call(handleSessions, 'GET', '/api/presentations/deck-owned/analytics/sessions', {
    as: ACTORS.owner,
    args: ['deck-owned'],
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sessions.length, 2);
  for (const session of res.body.sessions) {
    assert.ok(!('sessionToken' in session), 'the proof-of-possession token never reaches a reader');
  }
});

// ===========================================================================
// reports.js — reading a report needs read, managing one needs write
// ===========================================================================

test('list reports returns the deck’s reports for a reader', async () => {
  await seed();
  const { res } = await call(handleListReports, 'GET', '/api/presentations/deck-owned/analytics/reports', {
    as: ACTORS.owner,
    args: ['deck-owned'],
  });

  assert.equal(res.statusCode, 200);
  // deck-owned carries r-1, r-2 and the (public, private-deck) r-priv.
  assert.equal(res.body.total, 3, 'every report on this deck is counted, org-scoped');
  assert.deepEqual(res.body.reports.map((r) => r.id).sort(), ['r-1', 'r-2', 'r-priv']);
});

test('list reports is a 401 for someone who cannot read the deck', async () => {
  await seed();
  const { res } = await call(handleListReports, 'GET', '/api/presentations/deck-owned/analytics/reports', {
    as: ACTORS.stranger,
    args: ['deck-owned'],
  });

  assert.equal(res.statusCode, 401);
});

test('get report returns one report for a reader', async () => {
  await seed();
  const { res } = await call(handleGetReport, 'GET', '/api/presentations/deck-owned/analytics/reports/r-1', {
    as: ACTORS.owner,
    args: ['deck-owned', 'r-1'],
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.id, 'r-1');
  assert.equal(res.body.presentationId, 'deck-owned');
});

test('get report is a 404 for a report id that does not exist', async () => {
  await seed();
  const { res } = await call(handleGetReport, 'GET', '/api/presentations/deck-owned/analytics/reports/nope', {
    as: ACTORS.owner,
    args: ['deck-owned', 'nope'],
  });

  assert.equal(res.statusCode, 404);
});

test('get report is a 404 when the report belongs to another deck', async () => {
  await seed();
  // r-pub belongs to deck-org; asking for it under deck-owned must not leak it.
  const { res } = await call(handleGetReport, 'GET', '/api/presentations/deck-owned/analytics/reports/r-pub', {
    as: ACTORS.owner,
    args: ['deck-owned', 'r-pub'],
  });

  assert.equal(res.statusCode, 404, 'a report is only reachable under its own presentation');
});

// Write access on one deck must not reach another deck's reports: without the
// belongs-to-presentation check, write access anywhere in the org would let a
// caller rename, delete or even publish (regenerate sets is_public) any report
// in the org. Same-deck coverage of these three lives in the writer tests below.
test('update is a 404 when the report belongs to another deck', async () => {
  await seed();
  const { res } = await call(
    handleUpdateReport,
    'PATCH',
    '/api/presentations/deck-owned/analytics/reports/r-pub',
    { as: ACTORS.owner, args: ['deck-owned', 'r-pub'], body: { title: 'Hijacked' } }
  );

  assert.equal(res.statusCode, 404, 'a foreign report cannot be updated through this deck');
  assert.equal(reportById('r-pub').title, 'Report r-pub', 'the report is untouched');
});

test('delete is a 404 when the report belongs to another deck', async () => {
  await seed();
  const { res } = await call(
    handleDeleteReport,
    'DELETE',
    '/api/presentations/deck-owned/analytics/reports/r-pub',
    { as: ACTORS.owner, args: ['deck-owned', 'r-pub'] }
  );

  assert.equal(res.statusCode, 404, 'a foreign report cannot be deleted through this deck');
  assert.ok(reportById('r-pub'), 'the report survives');
});

test('regenerate is a 404 when the report belongs to another deck', async () => {
  await seed();
  const { res } = await call(
    handleRegenerateToken,
    'POST',
    '/api/presentations/deck-owned/analytics/reports/r-pub/regenerate-token',
    { as: ACTORS.owner, args: ['deck-owned', 'r-pub'] }
  );

  assert.equal(res.statusCode, 404, 'a foreign report cannot be re-tokenised through this deck');
  assert.equal(reportById('r-pub').share_token, PUBLIC_TOKEN, 'the token did not rotate');
});

test('creating a report needs write access, not merely read', async () => {
  await seed();
  const { res } = await call(handleCreateReport, 'POST', '/api/presentations/deck-owned/analytics/reports', {
    as: ACTORS.viewer, // a view-only collaborator can read the deck but not manage it
    args: ['deck-owned'],
    body: { title: 'Q1', startDate: '2026-01-01', endDate: '2026-01-31' },
  });

  assert.equal(res.statusCode, 401, 'managing reports is writing');
});

test('create rejects a body missing required fields with a 400', async () => {
  await seed();
  const { res } = await call(handleCreateReport, 'POST', '/api/presentations/deck-owned/analytics/reports', {
    as: ACTORS.owner,
    args: ['deck-owned'],
    body: { startDate: '2026-01-01', endDate: '2026-01-31' }, // no title
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad_request');
});

test('create rejects an unknown report type with a 400', async () => {
  await seed();
  const { res } = await call(handleCreateReport, 'POST', '/api/presentations/deck-owned/analytics/reports', {
    as: ACTORS.owner,
    args: ['deck-owned'],
    body: { title: 'Q1', reportType: 'wall-of-text', startDate: '2026-01-01', endDate: '2026-01-31' },
  });

  assert.equal(res.statusCode, 400);
});

test('create is rate-limited once the expensive-op bucket is spent', async () => {
  await seed();
  const expensiveCap = AUTH_RATE_LIMITS.expensive.capacity;
  // Each rejected create still spends a token: the bucket is checked first.
  for (let i = 0; i < expensiveCap; i++) {
    const { res } = await call(handleCreateReport, 'POST', '/api/presentations/deck-owned/analytics/reports', {
      as: ACTORS.owner,
      args: ['deck-owned'],
      body: {}, // reaches the limiter, then fails validation — the token is gone either way
    });
    assert.equal(res.statusCode, 400, `call ${i + 1} within the burst passes the limiter`);
  }

  const { res } = await call(handleCreateReport, 'POST', '/api/presentations/deck-owned/analytics/reports', {
    as: ACTORS.owner,
    args: ['deck-owned'],
    body: {},
  });
  assert.equal(res.statusCode, 429, 'the call past the burst is refused before validation');
  assert.equal(res.body.error, 'rate_limited');
});

test('updating a report needs write access', async () => {
  await seed();
  const { res } = await call(handleUpdateReport, 'PATCH', '/api/presentations/deck-owned/analytics/reports/r-1', {
    as: ACTORS.viewer,
    args: ['deck-owned', 'r-1'],
    body: { title: 'Renamed' },
  });

  assert.equal(res.statusCode, 401);
});

test('update renames a report for a writer', async () => {
  await seed();
  const { res } = await call(handleUpdateReport, 'PATCH', '/api/presentations/deck-owned/analytics/reports/r-1', {
    as: ACTORS.owner,
    args: ['deck-owned', 'r-1'],
    body: { title: 'Renamed' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(reportById('r-1').title, 'Renamed');
});

test('turning a report public mints a share token', async () => {
  await seed();
  assert.equal(reportById('r-1').share_token, null, 'starts private, no token');

  const { res } = await call(handleUpdateReport, 'PATCH', '/api/presentations/deck-owned/analytics/reports/r-1', {
    as: ACTORS.owner,
    args: ['deck-owned', 'r-1'],
    body: { isPublic: true },
  });

  assert.equal(res.statusCode, 200);
  const token = reportById('r-1').share_token;
  assert.match(token || '', /^[a-f0-9]{64}$/, 'a 64-hex share token now exists');
  assert.equal(reportById('r-1').is_public, true);
});

test('deleting a report needs write access', async () => {
  await seed();
  const { res } = await call(handleDeleteReport, 'DELETE', '/api/presentations/deck-owned/analytics/reports/r-1', {
    as: ACTORS.viewer,
    args: ['deck-owned', 'r-1'],
  });

  assert.equal(res.statusCode, 401);
  assert.ok(reportById('r-1'), 'the report survives a refused delete');
});

test('delete removes a report for a writer', async () => {
  await seed();
  const { res } = await call(handleDeleteReport, 'DELETE', '/api/presentations/deck-owned/analytics/reports/r-1', {
    as: ACTORS.owner,
    args: ['deck-owned', 'r-1'],
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(reportById('r-1'), undefined, 'the report is gone');
});

test('regenerating the share token needs write access', async () => {
  await seed();
  const { res } = await call(
    handleRegenerateToken,
    'POST',
    '/api/presentations/deck-owned/analytics/reports/r-priv/regenerate-token',
    { as: ACTORS.viewer, args: ['deck-owned', 'r-priv'] }
  );

  assert.equal(res.statusCode, 401);
});

test('regenerate mints a fresh token for a writer', async () => {
  await seed();
  const before = reportById('r-priv').share_token;
  const { res } = await call(
    handleRegenerateToken,
    'POST',
    '/api/presentations/deck-owned/analytics/reports/r-priv/regenerate-token',
    { as: ACTORS.owner, args: ['deck-owned', 'r-priv'] }
  );

  assert.equal(res.statusCode, 200);
  assert.match(res.body.shareToken, /^[a-f0-9]{64}$/);
  assert.notEqual(res.body.shareToken, before, 'the token actually rotated');
});

// ===========================================================================
// public.js — the token is the authorization, and it is not enough alone
// ===========================================================================

test('a well-formed token for a live public report returns it', async () => {
  await seed();
  const { res, handled } = await callPublic('GET', PUBLIC_TOKEN);

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.id, 'r-pub');
  assert.equal(res.body.shareToken, PUBLIC_TOKEN);
});

test('a malformed token is a 400, not a database lookup', async () => {
  await seed();
  const { res } = await callPublic('GET', 'not-a-real-token');

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad_request');
});

test('a well-formed but unminted token is a 404', async () => {
  await seed();
  const { res } = await callPublic('GET', UNKNOWN_TOKEN);

  assert.equal(res.statusCode, 404);
});

test('an expired public report is a 404', async () => {
  await seed();
  const { res } = await callPublic('GET', EXPIRED_TOKEN);

  assert.equal(res.statusCode, 404);
});

test('a public report whose deck no longer exists is a 404', async () => {
  await seed();
  const { res } = await callPublic('GET', GHOST_DECK_TOKEN);

  assert.equal(res.statusCode, 404);
});

test('a public report whose deck went private is a 403', async () => {
  await seed();
  const { res } = await callPublic('GET', PRIVATE_DECK_TOKEN);

  assert.equal(res.statusCode, 403, 'a report share-link goes dark when its deck is set private');
  assert.equal(res.body.error, 'forbidden');
});

test('the public report path is rate-limited per IP', async () => {
  await seed();
  for (let i = 0; i < PUBLIC_CAP; i++) {
    const { res } = await callPublic('GET', UNKNOWN_TOKEN);
    assert.equal(res.statusCode, 404, `call ${i + 1} within the burst reaches the lookup`);
  }

  const { res } = await callPublic('GET', UNKNOWN_TOKEN);
  assert.equal(res.statusCode, 429, 'the call past the burst is refused');
  assert.equal(res.headers['Retry-After'], '5');
});

test('the public report path only answers GET', async () => {
  await seed();
  const { handled, res } = await callPublic('POST', PUBLIC_TOKEN);

  assert.equal(handled, false, 'a non-GET method falls through unmatched');
  assert.equal(res.statusCode, null, 'and nothing was written to the response');
});
