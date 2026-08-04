/**
 * The GDPR data-access routes of the analytics stack (test-coverage gap map, PR 4).
 *
 * `server/routes/api/analytics/gdpr.js` exposes two endpoints on
 * `/api/analytics/my-data` — `GET` (right to access / export) and `DELETE`
 * (right to erasure) — over `server/storage/analytics/view-sessions-gdpr.js`.
 * The storage helpers below them had no route-level coverage: who is allowed to
 * ask, what an erasure actually removes, and — the security-relevant part —
 * that neither endpoint reaches across an organization boundary.
 *
 * Two rules carry this surface and are stated here as assertions:
 *
 *   1. **The endpoint is self-service and identifies you by your own email.**
 *      Both handlers refuse a request without `authedUser.email` (401) and, when
 *      admitted, act only on rows whose `viewer_email` equals that address. There
 *      is deliberately no "wrong role" negative test: the endpoint has no role
 *      dimension — identity *is* the scope, so there is no privileged vs.
 *      unprivileged caller to distinguish, only "you" vs. "not authenticated".
 *   2. **Erasure is org-scoped and hard-deletes, it does not anonymize.** The
 *      handler passes `authedUser.organizationId`, so a delete removes the acting
 *      user's `view_sessions` (and their `slide_views`) *in that org only*; rows
 *      for another email, or for the same email under a different org, survive
 *      untouched. What comes back is a count of what was removed, not an
 *      anonymized shadow — the IP-anonymization retention job
 *      (`anonymizeOldIpAddresses`) is a separate path this endpoint never calls.
 *
 * House shape (see `tests/authz-organization-scope.test.js`,
 * `tests/auth-routes-reset-and-magic-link.test.js`): the exported handler is
 * called directly with a req/res double over `tests/helpers/fake-db.js`. No HTTP
 * server, no browser — the suite has no e2e harness and this item introduces
 * none. The erasure runs inside `db.transaction()`, whose all-or-nothing
 * behaviour the double now models (see the `transaction()` note in fake-db.js).
 *
 * No production code changes with this file; only the db double gained a
 * `transaction()` shim, in the same spirit as the fake-db extensions that PR 1
 * and PR 2 of this track landed.
 *
 * Run with: node --test tests/analytics-gdpr-delete-path.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { resetRateLimitBuckets } = await import('../server/utils/rate-limit.js');
// The expensive-op bucket the GDPR endpoints use; its capacity bounds the
// rate-limit tests below without hard-coding the number twice.
const { AUTH_RATE_LIMITS } = await import('../server/analytics/helpers.js');
const { handleExportMyData, handleDeleteMyData } = await import(
  '../server/routes/api/analytics/gdpr.js'
);

const ORG_A = 'org-aaaa';
const ORG_B = 'org-bbbb';
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const MY_DATA_URL = new URL('http://localhost/api/analytics/my-data');
const EXPENSIVE_CAP = AUTH_RATE_LIMITS.expensive.capacity;

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/** A minimal response double capturing the status/body the helpers write. */
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

/** Invoke a GDPR handler the way the router does, returning res + result. */
async function invoke(handler, authedUser) {
  const res = makeRes();
  const handled = await handler({ res, url: MY_DATA_URL, authedUser });
  return { res, handled };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * A `view_sessions` row in the shape `createViewSession` writes. `viewer_email`
 * is stored lowercase, exactly as the write path normalizes it, so the
 * lowercasing the query does is exercised rather than accidentally bypassed.
 * @param {Object} spec
 * @returns {Object}
 */
function sessionRow({ id, org, email = null, device = null, startedAt = '2026-01-01T00:00:00.000Z' }) {
  return {
    id,
    organization_id: org,
    presentation_id: 'deck-1',
    session_token: `tok-${id}`,
    source_type: 'share_link',
    source_id: null,
    viewer_type: 'authenticated',
    viewer_email: email ? email.toLowerCase() : null,
    device_id: device,
    started_at: startedAt,
    last_activity_at: startedAt,
    ended_at: null,
    duration_seconds: 0,
    exit_slide_index: null,
    ip_address: '203.0.113.5',
    user_agent: 'UA/1.0',
    is_internal: false,
    attribution_allowed: false,
    created_at: startedAt,
  };
}

/** A `slide_views` row belonging to one session. */
function slideViewRow({ id, sessionId, slideId = 'slide-1', index = 0 }) {
  return {
    id,
    view_session_id: sessionId,
    presentation_id: 'deck-1',
    slide_id: slideId,
    slide_index: index,
    entered_at: '2026-01-01T00:00:00.000Z',
    exited_at: null,
    duration_seconds: 0,
    visit_number: 1,
  };
}

/** Install a fresh double seeded with the given rows, and hand it back. */
function seed({ sessions = [], slideViews = [] } = {}) {
  const db = createFakeDb({ view_sessions: sessions, slide_views: slideViews });
  __setTestDb(db);
  return db;
}

const sessionIds = (db) => (db.__tables.view_sessions || []).map((r) => r.id).sort();
const slideViewIds = (db) => (db.__tables.slide_views || []).map((r) => r.id).sort();

test.beforeEach(() => {
  resetRateLimitBuckets();
});

// ---------------------------------------------------------------------------
// GET /api/analytics/my-data — export (right to access)
// ---------------------------------------------------------------------------

test('export returns the caller’s own sessions and slide views', async () => {
  seed({
    sessions: [sessionRow({ id: 's1', org: ORG_A, email: ALICE })],
    slideViews: [
      slideViewRow({ id: 'v1', sessionId: 's1', index: 0 }),
      slideViewRow({ id: 'v2', sessionId: 's1', index: 1 }),
    ],
  });

  const { res, handled } = await invoke(handleExportMyData, { email: ALICE, organizationId: ORG_A });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.totalSessions, 1);
  assert.equal(res.body.totalSlideViews, 2);
  assert.equal(res.body.sessions[0].viewerEmail, ALICE);
  assert.equal(res.body.identifier.email, ALICE);
});

test('export refuses an unauthenticated caller and reads nothing', async () => {
  const db = seed({ sessions: [sessionRow({ id: 's1', org: ORG_A, email: ALICE })] });

  const { res, handled } = await invoke(handleExportMyData, { organizationId: ORG_A });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Authentication required' });
  assert.deepEqual(
    db.__queryLog,
    [],
    'the 401 is returned before storage is touched — no query is issued'
  );
});

test('export is scoped to the caller’s org and email — no cross-org, no cross-user leak', async () => {
  seed({
    sessions: [
      sessionRow({ id: 'mine', org: ORG_A, email: ALICE }),
      sessionRow({ id: 'other-org', org: ORG_B, email: ALICE }), // same person, different org
      sessionRow({ id: 'other-user', org: ORG_A, email: BOB }), // same org, different person
    ],
  });

  const { res } = await invoke(handleExportMyData, { email: ALICE, organizationId: ORG_A });

  assert.equal(res.statusCode, 200);
  const returned = res.body.sessions.map((s) => s.viewerEmail);
  assert.equal(res.body.totalSessions, 1, 'only the ORG_A alice row is exported');
  assert.deepEqual(returned, [ALICE]);
});

// ---------------------------------------------------------------------------
// DELETE /api/analytics/my-data — erasure (right to be forgotten)
// ---------------------------------------------------------------------------

test('delete erases the caller’s org rows and their slide views, nothing else', async () => {
  const db = seed({
    sessions: [
      sessionRow({ id: 'mine', org: ORG_A, email: ALICE }),
      sessionRow({ id: 'mine-org-b', org: ORG_B, email: ALICE }), // same person, other org — must survive
      sessionRow({ id: 'bob', org: ORG_A, email: BOB }), // other person, same org — must survive
    ],
    slideViews: [
      slideViewRow({ id: 'v-mine', sessionId: 'mine' }),
      slideViewRow({ id: 'v-mine-b', sessionId: 'mine-org-b' }),
      slideViewRow({ id: 'v-bob', sessionId: 'bob' }),
    ],
  });

  const { res, handled } = await invoke(handleDeleteMyData, { email: ALICE, organizationId: ORG_A });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.deleted, { sessions: 1, slideViews: 1 });
  assert.equal(res.body.message, 'Your analytics data has been deleted');

  assert.deepEqual(
    sessionIds(db),
    ['bob', 'mine-org-b'],
    'the ORG_A alice session is gone; the other-org and other-user sessions survive'
  );
  assert.deepEqual(
    slideViewIds(db),
    ['v-bob', 'v-mine-b'],
    'only the deleted session’s slide views go with it'
  );
});

test('delete refuses an unauthenticated caller and removes nothing', async () => {
  const db = seed({
    sessions: [sessionRow({ id: 's1', org: ORG_A, email: ALICE })],
    slideViews: [slideViewRow({ id: 'v1', sessionId: 's1' })],
  });

  const { res, handled } = await invoke(handleDeleteMyData, { email: '', organizationId: ORG_A });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Authentication required' });
  assert.deepEqual(sessionIds(db), ['s1'], 'nothing was deleted');
  assert.deepEqual(db.__queryLog, [], 'the 401 short-circuits before any query');
});

test('delete cannot reach the caller’s data in another org', async () => {
  const db = seed({
    sessions: [sessionRow({ id: 'mine-org-b', org: ORG_B, email: ALICE })],
    slideViews: [slideViewRow({ id: 'v-b', sessionId: 'mine-org-b' })],
  });

  // Alice is acting in ORG_A; her data lives in ORG_B.
  const { res } = await invoke(handleDeleteMyData, { email: ALICE, organizationId: ORG_A });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.deleted, { sessions: 0, slideViews: 0 });
  assert.deepEqual(sessionIds(db), ['mine-org-b'], 'the ORG_B row is untouched');
  assert.deepEqual(slideViewIds(db), ['v-b']);
});

test('delete reports a zeroed count when the caller has no data (no false erasure)', async () => {
  const db = seed({ sessions: [sessionRow({ id: 'bob', org: ORG_A, email: BOB })] });

  const { res } = await invoke(handleDeleteMyData, { email: ALICE, organizationId: ORG_A });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.deleted, { sessions: 0, slideViews: 0 });
  assert.deepEqual(sessionIds(db), ['bob'], 'an unrelated session is left in place');
});

// ---------------------------------------------------------------------------
// The GDPR-specific expensive-op rate limit gates each endpoint
// ---------------------------------------------------------------------------

test('export is rate-limited once the expensive-op bucket is spent', async () => {
  seed({ sessions: [sessionRow({ id: 's1', org: ORG_A, email: ALICE })] });
  const user = { email: ALICE, organizationId: ORG_A };

  for (let i = 0; i < EXPENSIVE_CAP; i++) {
    const { res } = await invoke(handleExportMyData, user);
    assert.equal(res.statusCode, 200, `call ${i + 1} within the burst is allowed`);
  }

  const { res } = await invoke(handleExportMyData, user);
  assert.equal(res.statusCode, 429, 'the call past the burst is refused');
  assert.equal(res.headers['Retry-After'], '5');
  assert.match(res.body.error, /Rate limit/);
});

test('delete is rate-limited once the expensive-op bucket is spent', async () => {
  seed({ sessions: [sessionRow({ id: 's1', org: ORG_A, email: BOB })] });
  const user = { email: BOB, organizationId: ORG_A };

  for (let i = 0; i < EXPENSIVE_CAP; i++) {
    const { res } = await invoke(handleDeleteMyData, user);
    assert.equal(res.statusCode, 200, `call ${i + 1} within the burst is allowed`);
  }

  const { res } = await invoke(handleDeleteMyData, user);
  assert.equal(res.statusCode, 429, 'the call past the burst is refused');
  assert.equal(res.headers['Retry-After'], '5');
  assert.match(res.body.error, /Rate limit/);
});
