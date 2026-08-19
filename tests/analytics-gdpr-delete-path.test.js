/**
 * The GDPR data-access routes of the analytics stack (test-coverage gap map, PR 4).
 *
 * `server/routes/api/analytics/gdpr.js` exposes two endpoints on
 * `/api/analytics/my-data` — `GET` (right to access / export) and `DELETE`
 * (right to erasure) — over `server/storage/analytics/view-sessions-gdpr.js`.
 *
 * Three rules carry this surface and are stated here as assertions:
 *
 *   1. **The endpoint is self-service and identifies you by your own email.**
 *      Both handlers refuse a request without `authedUser.email` (401) and, when
 *      admitted, act only on rows whose `viewer_email` equals that address. There
 *      is deliberately no "wrong role" negative test: the endpoint has no role
 *      dimension — identity *is* the scope, so there is no privileged vs.
 *      unprivileged caller to distinguish, only "you" vs. "not authenticated".
 *   2. **The data subject is the scope; the organization plays no part.** An
 *      export or erasure covers this person's sessions across the whole
 *      instance, whatever organization the caller happens to be acting in and
 *      whatever organization the viewed deck belongs to. This is the form chosen
 *      in the A1(a) defects PR: the previous organization filter matched
 *      `view_sessions.organization_id` — a column the *viewer's browser* filled
 *      in — against the *authenticated caller's* organization, so under
 *      multi-organization an erasure deleted nothing and reported success anyway.
 *      The column is gone (migration 065); rule R2 in
 *      `docs/reference/tenant-isolation.md` says a view session inherits its
 *      organization from its presentation and carries no copy of it.
 *   3. **Erasure hard-deletes, and identifies nobody by device.** A delete
 *      removes the matched `view_sessions` and their `slide_views` and reports
 *      how many; it does not anonymize (the IP-anonymization retention job
 *      `anonymizeOldIpAddresses` is a separate path this endpoint never calls),
 *      and it never matches on `device_id`. A device id is not a secret — the
 *      viewer's own browser generates it and puts it in the request body — so
 *      it cannot authorize an export or an erasure, and the storage refuses an
 *      identifier that has nothing else in it. (The session-list endpoint used
 *      to hand the raw value to every reader of the deck as well; it returns a
 *      per-deck HMAC label now, see
 *      `tests/analytics-session-device-label.test.js`. That narrowed the
 *      exposure without changing the rule here.)
 *
 * House shape (see `tests/authz-organization-scope.test.js`,
 * `tests/auth-routes-reset-and-magic-link.test.js`): the exported handler is
 * called directly with a req/res double over `tests/helpers/fake-db.js`. No HTTP
 * server, no browser — the suite has no e2e harness and this item introduces
 * none. The erasure runs inside `db.transaction()`, whose all-or-nothing
 * behaviour the double models (see the `transaction()` note in fake-db.js).
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
const { AUTH_RATE_LIMITS } = await import('../server/config/rate-limits.js');
const { handleExportMyData, handleDeleteMyData } =
  await import('../server/routes/api/analytics/gdpr.js');
const { exportUserAnalyticsData, deleteUserAnalyticsData } =
  await import('../server/storage/analytics/view-sessions.js');

const ORG_A = 'org-aaaa';
const ORG_B = 'org-bbbb';
// Two decks that live in different organizations. Nothing on the row says so any
// more — the organization is a property of the presentation — which is exactly
// the point these tests pin.
const DECK_IN_A = 'deck-in-org-a';
const DECK_IN_B = 'deck-in-org-b';
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
 * A `view_sessions` row in the shape `createViewSession` writes — no
 * organization column (migration 065). `viewer_email` is stored lowercase,
 * exactly as the write path normalizes it, so the lowercasing the query does is
 * exercised rather than accidentally bypassed.
 * @param {Object} spec
 * @returns {Object}
 */
function sessionRow({
  id,
  deck = DECK_IN_A,
  email = null,
  device = null,
  startedAt = '2026-01-01T00:00:00.000Z',
}) {
  return {
    id,
    presentation_id: deck,
    session_token: `tok-${id}`,
    source_type: 'share_link',
    source_id: null,
    viewer_type: email ? 'authenticated' : 'anonymous',
    viewer_email: email ? email.toLowerCase() : null,
    device_id: device,
    started_at: startedAt,
    last_activity_at: startedAt,
    ended_at: null,
    duration_seconds: 0,
    exit_slide_index: null,
    ip_address: '203.0.113.5',
    user_agent: 'UA/1.0',
    attribution_allowed: false,
    created_at: startedAt,
  };
}

/** A `slide_views` row belonging to one session. */
function slideViewRow({
  id,
  sessionId,
  deck = DECK_IN_A,
  slideId = 'slide-1',
  index = 0,
}) {
  return {
    id,
    view_session_id: sessionId,
    presentation_id: deck,
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

const sessionIds = (db) =>
  (db.__tables.view_sessions || []).map((r) => r.id).sort();
const slideViewIds = (db) =>
  (db.__tables.slide_views || []).map((r) => r.id).sort();

test.beforeEach(() => {
  resetRateLimitBuckets();
});

// ---------------------------------------------------------------------------
// GET /api/analytics/my-data — export (right to access)
// ---------------------------------------------------------------------------

test('export returns the caller’s own sessions and slide views', async () => {
  seed({
    sessions: [sessionRow({ id: 's1', email: ALICE })],
    slideViews: [
      slideViewRow({ id: 'v1', sessionId: 's1', index: 0 }),
      slideViewRow({ id: 'v2', sessionId: 's1', index: 1 }),
    ],
  });

  const { res, handled } = await invoke(handleExportMyData, {
    email: ALICE,
    organizationId: ORG_A,
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.totalSessions, 1);
  assert.equal(res.body.totalSlideViews, 2);
  assert.equal(res.body.sessions[0].viewerEmail, ALICE);
  assert.equal(res.body.identifier.email, ALICE);
});

test('export refuses an unauthenticated caller and reads nothing', async () => {
  const db = seed({ sessions: [sessionRow({ id: 's1', email: ALICE })] });

  const { res, handled } = await invoke(handleExportMyData, {
    organizationId: ORG_A,
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, {
    ok: false,
    error: 'unauthorized',
    message: 'Authentication required',
  });
  assert.deepEqual(
    db.__queryLog,
    [],
    'the 401 is returned before storage is touched — no query is issued',
  );
});

test('export covers the caller’s rows in every organization, and no one else’s', async () => {
  seed({
    sessions: [
      sessionRow({ id: 'mine-a', deck: DECK_IN_A, email: ALICE }),
      sessionRow({ id: 'mine-b', deck: DECK_IN_B, email: ALICE }), // her view of another organization's deck
      sessionRow({ id: 'bob', deck: DECK_IN_A, email: BOB }), // someone else — never hers
      sessionRow({ id: 'anon', deck: DECK_IN_A, device: 'dev-1' }), // no email — not addressable here
    ],
  });

  const { res } = await invoke(handleExportMyData, {
    email: ALICE,
    organizationId: ORG_A,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.totalSessions, 2, 'both of Alice’s sessions come back');
  assert.deepEqual(res.body.sessions.map((s) => s.presentationId).sort(), [
    DECK_IN_A,
    DECK_IN_B,
  ]);
  assert.deepEqual(
    [...new Set(res.body.sessions.map((s) => s.viewerEmail))],
    [ALICE],
    'no other person’s rows are exported',
  );
});

test('export ignores which organization the caller is acting in', async () => {
  const rows = [
    sessionRow({ id: 'mine-a', deck: DECK_IN_A, email: ALICE }),
    sessionRow({ id: 'mine-b', deck: DECK_IN_B, email: ALICE }),
  ];

  seed({ sessions: rows });
  const actingInA = await invoke(handleExportMyData, {
    email: ALICE,
    organizationId: ORG_A,
  });

  resetRateLimitBuckets();
  seed({ sessions: rows });
  const actingInB = await invoke(handleExportMyData, {
    email: ALICE,
    organizationId: ORG_B,
  });

  resetRateLimitBuckets();
  seed({ sessions: rows });
  const noOrg = await invoke(handleExportMyData, { email: ALICE });

  for (const { res } of [actingInA, actingInB, noOrg]) {
    assert.equal(res.statusCode, 200);
    assert.equal(
      res.body.totalSessions,
      2,
      'the acting organization does not narrow the answer',
    );
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/analytics/my-data — erasure (right to be forgotten)
// ---------------------------------------------------------------------------

test('delete erases the caller’s rows in every organization, and their slide views', async () => {
  const db = seed({
    sessions: [
      sessionRow({ id: 'mine-a', deck: DECK_IN_A, email: ALICE }),
      sessionRow({ id: 'mine-b', deck: DECK_IN_B, email: ALICE }),
      sessionRow({ id: 'bob', deck: DECK_IN_A, email: BOB }), // other person — must survive
    ],
    slideViews: [
      slideViewRow({ id: 'v-mine-a', sessionId: 'mine-a', deck: DECK_IN_A }),
      slideViewRow({ id: 'v-mine-b', sessionId: 'mine-b', deck: DECK_IN_B }),
      slideViewRow({ id: 'v-bob', sessionId: 'bob', deck: DECK_IN_A }),
    ],
  });

  const { res, handled } = await invoke(handleDeleteMyData, {
    email: ALICE,
    organizationId: ORG_A,
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.deleted, { sessions: 2, slideViews: 2 });
  assert.equal(res.body.message, 'Your analytics data has been deleted');

  assert.deepEqual(
    sessionIds(db),
    ['bob'],
    'both of Alice’s sessions are gone; the other person’s survives',
  );
  assert.deepEqual(
    slideViewIds(db),
    ['v-bob'],
    'the deleted sessions’ slide views go with them, and only those',
  );
});

test('delete refuses an unauthenticated caller and removes nothing', async () => {
  const db = seed({
    sessions: [sessionRow({ id: 's1', email: ALICE })],
    slideViews: [slideViewRow({ id: 'v1', sessionId: 's1' })],
  });

  const { res, handled } = await invoke(handleDeleteMyData, {
    email: '',
    organizationId: ORG_A,
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, {
    ok: false,
    error: 'unauthorized',
    message: 'Authentication required',
  });
  assert.deepEqual(sessionIds(db), ['s1'], 'nothing was deleted');
  assert.deepEqual(
    db.__queryLog,
    [],
    'the 401 short-circuits before any query',
  );
});

test('delete does not sweep up sessions that carry no email', async () => {
  const db = seed({
    sessions: [
      sessionRow({ id: 'mine', email: ALICE, device: 'dev-1' }),
      // Same browser, but tracked anonymously: no email on the row. It is not
      // the caller's to erase through this endpoint, and matching it on the
      // device id would mean trusting an identifier every deck owner can read.
      sessionRow({ id: 'anon-same-device', device: 'dev-1' }),
    ],
    slideViews: [
      slideViewRow({ id: 'v-mine', sessionId: 'mine' }),
      slideViewRow({ id: 'v-anon', sessionId: 'anon-same-device' }),
    ],
  });

  const { res } = await invoke(handleDeleteMyData, {
    email: ALICE,
    organizationId: ORG_A,
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.deleted, { sessions: 1, slideViews: 1 });
  assert.deepEqual(
    sessionIds(db),
    ['anon-same-device'],
    'the device-only row is untouched',
  );
  assert.deepEqual(slideViewIds(db), ['v-anon']);
});

test('delete reports a zeroed count when the caller has no data (no false erasure)', async () => {
  const db = seed({ sessions: [sessionRow({ id: 'bob', email: BOB })] });

  const { res } = await invoke(handleDeleteMyData, {
    email: ALICE,
    organizationId: ORG_A,
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.deleted, { sessions: 0, slideViews: 0 });
  assert.deepEqual(
    sessionIds(db),
    ['bob'],
    'an unrelated session is left in place',
  );
});

// ---------------------------------------------------------------------------
// The storage contract underneath: an email, or nothing
// ---------------------------------------------------------------------------

test('the storage helpers refuse an identifier that is not an email', async () => {
  const db = seed({ sessions: [sessionRow({ id: 'anon', device: 'dev-1' })] });

  // A device id is client-generated, so producing one proves nothing about
  // whose device it is; the helpers take an email and nothing else.
  assert.deepEqual(await exportUserAnalyticsData({ deviceId: 'dev-1' }), {
    ok: false,
    reason: 'No identifier provided',
  });
  assert.deepEqual(await deleteUserAnalyticsData({ deviceId: 'dev-1' }), {
    ok: false,
    reason: 'No identifier provided',
  });
  assert.deepEqual(await deleteUserAnalyticsData({}), {
    ok: false,
    reason: 'No identifier provided',
  });

  assert.deepEqual(sessionIds(db), ['anon'], 'the refusals touched nothing');
  assert.deepEqual(db.__queryLog, [], 'and issued no query at all');
});

// ---------------------------------------------------------------------------
// The GDPR-specific expensive-op rate limit gates each endpoint
// ---------------------------------------------------------------------------

test('export is rate-limited once the expensive-op bucket is spent', async () => {
  seed({ sessions: [sessionRow({ id: 's1', email: ALICE })] });
  const user = { email: ALICE, organizationId: ORG_A };

  for (let i = 0; i < EXPENSIVE_CAP; i++) {
    const { res } = await invoke(handleExportMyData, user);
    assert.equal(
      res.statusCode,
      200,
      `call ${i + 1} within the burst is allowed`,
    );
  }

  const { res } = await invoke(handleExportMyData, user);
  assert.equal(res.statusCode, 429, 'the call past the burst is refused');
  assert.equal(res.headers['Retry-After'], '5');
  assert.equal(res.body.error, 'rate_limited');
  assert.match(res.body.message, /Rate limit/);
});

test('delete is rate-limited once the expensive-op bucket is spent', async () => {
  seed({ sessions: [sessionRow({ id: 's1', email: BOB })] });
  const user = { email: BOB, organizationId: ORG_A };

  for (let i = 0; i < EXPENSIVE_CAP; i++) {
    const { res } = await invoke(handleDeleteMyData, user);
    assert.equal(
      res.statusCode,
      200,
      `call ${i + 1} within the burst is allowed`,
    );
  }

  const { res } = await invoke(handleDeleteMyData, user);
  assert.equal(res.statusCode, 429, 'the call past the burst is refused');
  assert.equal(res.headers['Retry-After'], '5');
  assert.equal(res.body.error, 'rate_limited');
  assert.match(res.body.message, /Rate limit/);
});
