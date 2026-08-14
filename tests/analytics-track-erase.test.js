/**
 * The anonymous "forget me" route: POST /api/track/my-data/erase.
 *
 * This is the public, device-only counterpart of DELETE /api/analytics/my-data
 * (which identifies a logged-in person by email — see
 * `tests/analytics-gdpr-delete-path.test.js`). The anonymous viewer's browser
 * holds a live `session_token`; possession of it is the proof of identity. The
 * route resolves that token to a device id server-side and erases every session
 * of that device, instance-wide.
 *
 * Four rules carry this surface and are stated here as assertions:
 *
 *   1. **Only a valid, existing session token acts.** A malformed token is a
 *      400; a well-formed token with no session is a 404; neither deletes
 *      anything. A bare device id in the body is not an identifier at all — with
 *      no token the request is a 400 and nothing is touched.
 *   2. **A possessed token cascades to the whole device.** One erase from any of
 *      a device's sessions removes every session that device recorded, on every
 *      deck, and their slide views — identity is the scope, matching the email
 *      erasure. A wipe that stopped at the deck in hand would report success
 *      while leaving the rest behind.
 *   3. **A token with no device id erases only itself.** There is nothing to
 *      cascade across, and other sessions — even another device's — survive.
 *   4. **The route is rate-limited** by the same strict expensive-op bucket the
 *      GDPR endpoints use, keyed by IP (there is no principal here).
 *
 * House shape (see `tests/analytics-gdpr-delete-path.test.js`,
 * `tests/collaborators-permission-model.test.js`): the exported handler is
 * called directly with a req/res double over `tests/helpers/fake-db.js`. No HTTP
 * server, no browser. The erasure runs inside `db.transaction()`, whose
 * all-or-nothing behaviour the double models.
 *
 * Run with: node --test tests/analytics-track-erase.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { resetRateLimitBuckets } = await import('../server/utils/rate-limit.js');
const { AUTH_RATE_LIMITS } = await import('../server/config/rate-limits.js');
const { handleAnalyticsTrack } = await import('../server/routes/api/analytics-track.js');

const DECK_ONE = 'deck-one';
const DECK_TWO = 'deck-two';
const DEVICE = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const OTHER_DEVICE = '00112233445566778899aabbccddeeff';
/** 64-hex tokens, the shape `generateSessionToken` writes. */
const TOKEN_A = 'aaaa1111'.repeat(8);
const TOKEN_B = 'bbbb2222'.repeat(8);
const TOKEN_OLD = 'cccc3333'.repeat(8);
const TOKEN_NODEVICE = 'dddd4444'.repeat(8);
const TOKEN_OTHER = 'eeee5555'.repeat(8);
const EXPENSIVE_CAP = AUTH_RATE_LIMITS.expensive.capacity;
const CLIENT_IP = '203.0.113.7';

// ---------------------------------------------------------------------------
// Doubles and seeding
// ---------------------------------------------------------------------------

/** A `view_sessions` row in the shape `createViewSession` writes. */
function sessionRow({ id, deck = DECK_ONE, device = DEVICE, token, endedAt = null }) {
  return {
    id,
    presentation_id: deck,
    session_token: token,
    source_type: 'share_link',
    source_id: null,
    viewer_type: 'anonymous',
    viewer_email: null,
    device_id: device,
    started_at: '2026-03-01T10:00:00.000Z',
    last_activity_at: '2026-03-01T10:00:00.000Z',
    ended_at: endedAt,
    duration_seconds: 0,
    exit_slide_id: null,
    exit_slide_index: null,
    ip_address: '203.0.113.5',
    user_agent: 'UA/1.0',
    attribution_allowed: false,
    created_at: '2026-03-01T10:00:00.000Z',
  };
}

/** A `slide_views` row belonging to one session. */
function slideViewRow({ id, sessionId, deck = DECK_ONE }) {
  return {
    id,
    view_session_id: sessionId,
    presentation_id: deck,
    slide_id: 'slide-1',
    slide_index: 0,
    entered_at: '2026-03-01T10:00:00.000Z',
    exited_at: null,
    duration_seconds: 0,
    visit_number: 1,
  };
}

function seed({ sessions = [], slideViews = [] } = {}) {
  const db = createFakeDb({ view_sessions: sessions, slide_views: slideViews });
  __setTestDb(db);
  return db;
}

const sessionIds = (db) => (db.__tables.view_sessions || []).map((r) => r.id).sort();
const slideViewIds = (db) => (db.__tables.slide_views || []).map((r) => r.id).sort();

/** Call the erase route the way `routes/api/index.js` does. */
async function erase(body, { ip = CLIENT_IP } = {}) {
  const payload =
    body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const req = {
    method: 'POST',
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: ip },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };
  const res = {
    status: null,
    chunks: [],
    writeHead(status) {
      this.status = status;
      return this;
    },
    end(chunk) {
      if (chunk) this.chunks.push(chunk);
    },
  };

  const handled = await handleAnalyticsTrack({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL('http://decks.example.test/api/track/my-data/erase'),
  });

  const raw = res.chunks.length ? res.chunks.join('') : null;
  return { handled, status: res.status, body: raw ? JSON.parse(raw) : null };
}

test.beforeEach(() => {
  resetRateLimitBuckets();
});

// ---------------------------------------------------------------------------
// Rule 1 — only a valid, existing session token acts
// ---------------------------------------------------------------------------

test('a malformed token is rejected and erases nothing', async () => {
  const db = seed({
    sessions: [sessionRow({ id: 's1', token: TOKEN_A })],
    slideViews: [slideViewRow({ id: 'v1', sessionId: 's1' })],
  });

  const { handled, status, body } = await erase({ sessionToken: 'not-a-token' });

  assert.equal(handled, true);
  assert.equal(status, 400);
  assert.equal(body.error, 'bad_request');
  assert.match(body.message, /token/i);
  assert.deepEqual(sessionIds(db), ['s1'], 'nothing was deleted');
  assert.deepEqual(slideViewIds(db), ['v1']);
});

test('a well-formed token with no session is a 404 and erases nothing', async () => {
  const db = seed({ sessions: [sessionRow({ id: 's1', token: TOKEN_A })] });

  const { status, body } = await erase({ sessionToken: TOKEN_B });

  assert.equal(status, 404);
  assert.equal(body.error, 'not_found');
  assert.match(body.message, /not found/i);
  assert.deepEqual(sessionIds(db), ['s1'], 'the unrelated session survives');
});

test('a bare device id is not an identifier — no token means a 400, nothing touched', async () => {
  const db = seed({
    sessions: [sessionRow({ id: 's1', token: TOKEN_A, device: DEVICE })],
  });

  // The device id the browser knows is deliberately not accepted as input.
  const { status, body } = await erase({ deviceId: DEVICE });

  assert.equal(status, 400);
  assert.equal(body.error, 'bad_request');
  assert.match(body.message, /token/i);
  assert.deepEqual(sessionIds(db), ['s1'], "the device's session is untouched");
});

// ---------------------------------------------------------------------------
// Rule 2 — a possessed token cascades to the whole device
// ---------------------------------------------------------------------------

test('one erase wipes every session of the device, across decks, with slide views', async () => {
  const db = seed({
    sessions: [
      sessionRow({ id: 'here', deck: DECK_ONE, token: TOKEN_A }),
      sessionRow({ id: 'other-deck', deck: DECK_TWO, token: TOKEN_B }),
      sessionRow({ id: 'old', deck: DECK_ONE, token: TOKEN_OLD, endedAt: '2026-02-01T00:00:00.000Z' }),
      // A different device on the same deck must survive.
      sessionRow({ id: 'stranger', deck: DECK_ONE, device: OTHER_DEVICE, token: TOKEN_OTHER }),
    ],
    slideViews: [
      slideViewRow({ id: 'v-here', sessionId: 'here' }),
      slideViewRow({ id: 'v-other', sessionId: 'other-deck', deck: DECK_TWO }),
      slideViewRow({ id: 'v-old', sessionId: 'old' }),
      slideViewRow({ id: 'v-stranger', sessionId: 'stranger' }),
    ],
  });

  // Erasing from the session the viewer happens to be looking at (deck one)
  // reaches the deck-two session and the old ended one too.
  const { status, body } = await erase({ sessionToken: TOKEN_A });

  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true, deleted: { sessions: 3, slideViews: 3 } });
  assert.deepEqual(sessionIds(db), ['stranger'], "only the other device's session remains");
  assert.deepEqual(slideViewIds(db), ['v-stranger']);
});

// ---------------------------------------------------------------------------
// Rule 3 — a token with no device id erases only itself
// ---------------------------------------------------------------------------

test('a session with no device id erases only itself', async () => {
  const db = seed({
    sessions: [
      sessionRow({ id: 'mine', token: TOKEN_NODEVICE, device: null }),
      // Same browser once had a device id, but this row is a stranger to the
      // no-device session: with nothing to cascade on, it must survive.
      sessionRow({ id: 'stranger', token: TOKEN_OTHER, device: OTHER_DEVICE }),
    ],
    slideViews: [
      slideViewRow({ id: 'v-mine', sessionId: 'mine' }),
      slideViewRow({ id: 'v-stranger', sessionId: 'stranger' }),
    ],
  });

  const { status, body } = await erase({ sessionToken: TOKEN_NODEVICE });

  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true, deleted: { sessions: 1, slideViews: 1 } });
  assert.deepEqual(sessionIds(db), ['stranger'], 'no cascade without a device id');
  assert.deepEqual(slideViewIds(db), ['v-stranger']);
});

// ---------------------------------------------------------------------------
// Rule 4 — the expensive-op rate limit gates the route
// ---------------------------------------------------------------------------

test('the route is rate-limited once the expensive-op bucket is spent', async () => {
  seed({ sessions: [] });

  // The limit is checked before the token lookup, so unknown (but well-formed)
  // tokens exercise the gate without needing a fresh session each call: each is
  // a 404 until the bucket empties, then a 429.
  for (let i = 0; i < EXPENSIVE_CAP; i++) {
    const { status } = await erase({ sessionToken: TOKEN_A });
    assert.equal(status, 404, `call ${i + 1} within the burst reaches the lookup`);
  }

  const { status } = await erase({ sessionToken: TOKEN_A });
  assert.equal(status, 429, 'the call past the burst is refused');
});
