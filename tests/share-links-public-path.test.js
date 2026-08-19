/**
 * The anonymous public share-link path (test-coverage gap map, PR 1).
 *
 * `server/routes/api/share-links/public.js` is the only part of the share-link
 * feature that runs with no session at all: five endpoints mounted before the
 * authentication branch in `server/routes/api/index.js`, reachable by anyone
 * holding a token. It had no tests. This file pins what that surface hands out
 * and — more to the point — what it refuses.
 *
 * The rule the whole surface rests on is that **the token is the
 * authorization**: nothing here takes a presentation id, so the only deck an
 * anonymous caller can name is the one their token was minted for. The
 * negative half of this file is that rule stated as assertions — a spent,
 * expired or revoked token buys nothing, a wrong password buys nothing (and
 * costs the link nothing), a guest session minted for one link does not
 * authenticate against another, and a deck with no live link is unreachable by
 * any request this module answers.
 *
 * These are route-level tests in the house shape (see
 * `tests/authz-organization-scope.test.js`): the exported handler is called
 * directly with a req/res double over `tests/helpers/fake-db.js`. No HTTP
 * server, no browser — the suite has no e2e harness and this item does not
 * introduce one.
 *
 * No production code changes with this file. One test-double gap did have to
 * close: `.set((eb) => …)`, which is how the use counter is incremented, used
 * to compile to an empty SET clause in the double, so "the link is spent now"
 * would have passed without the counter ever moving.
 *
 * Run with: node --test tests/share-links-public-path.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
// The guest-verification mail is fire-and-forget; without a key the Brevo
// client answers `{ ok: false }` before it reaches the network.
delete process.env.BREVO_API_KEY;
// An empty allow-list lets `buildRequestUrl()` accept the test's Host header,
// which the guest redirect and the verification URL both need.
delete process.env.ALLOWED_HOSTS;
delete process.env.TRUST_PROXY;
delete process.env.SECURE_COOKIES;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
// `__resetStorageForTests` rather than `closeStorage`: the double is not a real
// Kysely handle, so closing it would call a `destroy()` it does not have.
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { hashPassword } = await import('../server/utils/password-hash.js');
const { resetRateLimitBuckets } = await import('../server/utils/rate-limit.js');
const { handleSharePublic } =
  await import('../server/routes/api/share-links/index.js');

const HOST = 'decks.example.test';
const PASSWORD = 'correct horse battery';

/** The decks. `deck-private` is never shared; nothing here may reach it. */
const DECKS = ['deck-shared', 'deck-other', 'deck-private'];

let passwordHash;
/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  passwordHash = await hashPassword(PASSWORD);
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * A stored deck, in the shape the presentations adapter reads.
 * @param {string} id - Deck id, doubling as its title.
 * @returns {Object}
 */
function deckRow(id) {
  return {
    id,
    organization_id: ORG,
    title: `Title of ${id}`,
    owner_email: 'author@example.com',
    created_by: 'author@example.com',
    updated_by: 'author@example.com',
    visibility: 'private',
    theme: 'default',
    lang: 'nl',
    revision: 1,
    is_view_only: false,
    slides: [{ id: 's1', type: 'content-slide', content: { title: 'Secret' } }],
    i18n: null,
    settings: {},
    created_at: '2026-02-01T00:00:00.000Z',
    modified_at: '2026-02-01T00:00:00.000Z',
    trashed_at: null,
  };
}

/**
 * A share link row, with the column defaults the migrations give it.
 * @param {Object} overrides - Row fields that matter to the test at hand.
 * @returns {Object}
 */
function linkRow(overrides) {
  return {
    organization_id: ORG,
    presentation_id: 'deck-shared',
    label: null,
    permission: 'view',
    password_hash: null,
    expires_at: null,
    max_uses: null,
    use_count: 0,
    created_by: 'author@example.com',
    created_at: '2026-02-01T00:00:00.000Z',
    last_used_at: null,
    revoked_at: null,
    revoked_by: null,
    revocation_message: null,
    registration_mode: 'invite_only',
    ...overrides,
  };
}

const HOUR = 60 * 60 * 1000;
const past = () => new Date(Date.now() - HOUR).toISOString();

/**
 * Reinstall a freshly seeded double. Every test starts from this, so a use
 * counter one test spends is full again in the next.
 * @returns {ReturnType<typeof createFakeDb>}
 */
function seed() {
  // The verify throttle keys an in-memory token bucket per IP; every test
  // drives the same client IP, so clear the buckets or one test's guesses
  // would spill into the next.
  resetRateLimitBuckets();
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    presentations: DECKS.map(deckRow),
    presentation_share_links: [
      linkRow({ id: 'link-view', token: 'tok-view', label: 'For the client' }),
      linkRow({
        id: 'link-password',
        token: 'tok-password',
        password_hash: passwordHash,
      }),
      linkRow({ id: 'link-limited', token: 'tok-limited', max_uses: 2 }),
      linkRow({ id: 'link-expired', token: 'tok-expired', expires_at: past() }),
      linkRow({
        id: 'link-revoked',
        token: 'tok-revoked',
        revoked_at: past(),
        revoked_by: 'author@example.com',
        revocation_message: 'This deck moved.',
      }),
      linkRow({
        id: 'link-open',
        token: 'tok-open',
        permission: 'comment',
        registration_mode: 'open',
      }),
      linkRow({
        id: 'link-invite',
        token: 'tok-invite',
        permission: 'comment',
      }),
      linkRow({
        id: 'link-other',
        token: 'tok-other',
        presentation_id: 'deck-other',
      }),
    ],
    share_link_guests: [],
    share_link_access_log: [],
  });
  __setTestDb(db);
  return db;
}

// ---------------------------------------------------------------------------
// Driving the handler
// ---------------------------------------------------------------------------

/**
 * Call the public share-link handler the way `routes/api/index.js` does.
 *
 * @param {string} method - HTTP method.
 * @param {string} path - Request path.
 * @param {Object} [options]
 * @param {Object|string} [options.body] - Request body; a string is sent verbatim.
 * @param {string} [options.cookie] - Cookie header.
 * @returns {Promise<{handled: boolean, status: number|null, headers: Object|null,
 *   body: Object|null, raw: string|null}>}
 */
async function call(method, path, { body, cookie } = {}) {
  const payload =
    body === undefined
      ? ''
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);
  const req = {
    method,
    headers: {
      host: HOST,
      'user-agent': 'test-agent/1.0',
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };

  const res = {
    status: null,
    headers: null,
    chunks: [],
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers || null;
      return this;
    },
    end(chunk) {
      if (chunk) this.chunks.push(chunk);
    },
  };

  const handled = await handleSharePublic({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL(`http://${HOST}${path}`),
  });

  const raw = res.chunks.length ? res.chunks.join('') : null;
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  return {
    handled,
    status: res.status,
    headers: res.headers,
    body: parsed,
    raw,
  };
}

/** The stored share-link row behind a token. */
const link = (token) =>
  db.__tables.presentation_share_links.find((r) => r.token === token);
/** The single stored guest row, once a request has minted one. */
const guests = () => db.__tables.share_link_guests;
/** Access-log rows written so far. */
const accessLog = () => db.__tables.share_link_access_log || [];

/** Walk a guest all the way to a live session, through the real endpoints. */
async function guestSession(
  token,
  { email = 'guest@example.com', name = 'Gwen' } = {},
) {
  const requested = await call('POST', `/api/share/${token}/guest/request`, {
    body: { email, name },
  });
  assert.equal(requested.status, 200, 'guest verification was requested');
  const verificationToken = guests().find(
    (g) => g.email === email,
  ).verification_token;
  const verified = await call(
    'GET',
    `/api/share/${token}/guest/verify/${verificationToken}`,
  );
  assert.equal(
    verified.status,
    302,
    'the verification link redirects back to the deck',
  );
  return {
    sessionToken: guests().find((g) => g.email === email).session_token,
    verified,
  };
}

// ---------------------------------------------------------------------------
// GET /api/share/:token — what a valid token buys, and nothing else
// ---------------------------------------------------------------------------

test('a live token yields the shared deck and the link settings, nothing more', async () => {
  seed();
  const res = await call('GET', '/api/share/tok-view');

  assert.equal(res.handled, true);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    presentationId: 'deck-shared',
    permission: 'view',
    requiresPassword: false,
    label: 'For the client',
  });
});

test('the validation response carries no deck content and no link secrets', async () => {
  seed();
  const res = await call('GET', '/api/share/tok-password');

  assert.equal(
    res.body.requiresPassword,
    true,
    'the client is told a password is needed',
  );
  assert.deepEqual(
    Object.keys(res.body).sort(),
    ['label', 'permission', 'presentationId', 'requiresPassword'],
    'the anonymous caller learns the deck id and the terms of the link, no more',
  );
  // Stated as a property of the wire bytes too: the deck's title, its owner and
  // the password hash are all in reach of this handler, and none may leave it.
  assert.doesNotMatch(res.raw, /Title of|author@example\.com|Secret|scrypt|\$/);
});

test('each token names its own deck; there is no crosstalk', async () => {
  seed();
  const shared = await call('GET', '/api/share/tok-view');
  const other = await call('GET', '/api/share/tok-other');

  assert.equal(shared.body.presentationId, 'deck-shared');
  assert.equal(other.body.presentationId, 'deck-other');
});

test('a deck id is not a token, so an unshared deck stays unreachable', async () => {
  seed();
  for (const deckId of DECKS) {
    const res = await call('GET', `/api/share/${deckId}`);
    assert.equal(
      res.status,
      404,
      `${deckId} is not addressable as a share token`,
    );
    assert.equal(res.body.error, 'not_found');
  }
});

test('an unknown token is a bare 404 that describes nothing', async () => {
  seed();
  const res = await call('GET', '/api/share/tok-does-not-exist');

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { ok: false, error: 'not_found' });
});

test('an expired token is gone, and says only that', async () => {
  seed();
  const res = await call('GET', '/api/share/tok-expired');

  assert.equal(res.status, 410);
  assert.deepEqual(res.body, { ok: false, error: 'expired' });
});

test('a revoked token returns the revocation notice for its own deck only', async () => {
  seed();
  const res = await call('GET', '/api/share/tok-revoked');

  assert.equal(res.status, 410);
  assert.equal(res.body.error, 'revoked');
  assert.equal(res.body.message, 'This deck moved.');
  // The holder of a revoked link is told which deck it was, which is the
  // deliberate design — they had the token. It is still only *that* deck.
  assert.equal(res.body.presentationTitle, 'Title of deck-shared');
  assert.equal(
    res.body.presentationId,
    undefined,
    'the deck id is not handed back',
  );
});

// ---------------------------------------------------------------------------
// POST /api/share/:token/verify — the password gate and the use counter
// ---------------------------------------------------------------------------

test('a link without a password verifies, is counted, and is logged', async () => {
  seed();
  const res = await call('POST', '/api/share/tok-view/verify', { body: {} });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    presentationId: 'deck-shared',
    permission: 'view',
    token: 'tok-view',
  });
  assert.equal(link('tok-view').use_count, 1, 'the access is counted');
  assert.equal(link('tok-view').last_used_at != null, true);
  assert.deepEqual(
    accessLog().map((row) => ({ link: row.share_link_id, ip: row.ip_address })),
    [{ link: 'link-view', ip: '203.0.113.9' }],
    'the access log records the attempt against this link',
  );
});

test('the right password opens the link; the response carries no hash', async () => {
  seed();
  const res = await call('POST', '/api/share/tok-password/verify', {
    body: { password: PASSWORD },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.presentationId, 'deck-shared');
  assert.deepEqual(Object.keys(res.body).sort(), [
    'permission',
    'presentationId',
    'token',
  ]);
  assert.equal(link('tok-password').use_count, 1);
});

test('a missing or wrong password buys nothing and costs the link nothing', async () => {
  seed();

  const missing = await call('POST', '/api/share/tok-password/verify', {
    body: {},
  });
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error, 'password_required');

  const wrong = await call('POST', '/api/share/tok-password/verify', {
    body: { password: 'not it' },
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, 'invalid_password');
  assert.equal(
    wrong.body.presentationId,
    undefined,
    'a failed attempt names no deck',
  );

  assert.equal(
    link('tok-password').use_count,
    0,
    'a refused attempt is not a use',
  );
  assert.deepEqual(accessLog(), [], 'and it is not logged as an access');
});

test('an unparseable body is a bad request, not a password attempt', async () => {
  seed();
  const res = await call('POST', '/api/share/tok-password/verify', {
    body: '{nope',
  });

  // Since A7.19 C6 a broken body is answered as such rather than silently read
  // as `{}`. An *absent* body still means "no password given" (the test above)
  // — absent and malformed are different requests.
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'bad_request');
  assert.equal(
    link('tok-password').use_count,
    0,
    'a refused attempt is not a use',
  );
});

test('a use-limited link stops working once it is spent', async () => {
  seed();

  for (const use of [1, 2]) {
    const res = await call('POST', '/api/share/tok-limited/verify', {
      body: {},
    });
    assert.equal(res.status, 200, `use ${use} of 2 is allowed`);
    assert.equal(link('tok-limited').use_count, use);
  }

  const spent = await call('POST', '/api/share/tok-limited/verify', {
    body: {},
  });
  assert.equal(spent.status, 410);
  assert.equal(spent.body.error, 'max_uses_exceeded');
  assert.equal(
    link('tok-limited').use_count,
    2,
    'a refused use is not counted either',
  );

  const validated = await call('GET', '/api/share/tok-limited');
  assert.equal(validated.status, 410, 'the link is gone for validation too');
});

test('a revoked or expired token cannot be verified into access', async () => {
  seed();

  for (const token of ['tok-revoked', 'tok-expired']) {
    const res = await call('POST', `/api/share/${token}/verify`, { body: {} });
    assert.equal(res.status, 410, `${token} is refused`);
    assert.equal(res.body.presentationId, undefined);
  }
  assert.deepEqual(accessLog(), [], 'a dead link writes no access log');
});

// ---------------------------------------------------------------------------
// The password gate is rate-limited (B42(b)): an anonymous endpoint that
// checks a secret is a guessing port, so guesses are capped per IP — the same
// 3/hour and `rate_limited`/429 the guest-verification path uses next door.
// ---------------------------------------------------------------------------

test('password guessing is throttled to three tries per IP, then 429', async () => {
  seed();

  // Three wrong guesses are each answered on their own merits...
  for (const attempt of [1, 2, 3]) {
    const res = await call('POST', '/api/share/tok-password/verify', {
      body: { password: 'not it' },
    });
    assert.equal(res.status, 401, `guess ${attempt} is judged, not throttled`);
    assert.equal(res.body.error, 'invalid_password');
  }

  // ...the fourth is refused before the password is ever checked.
  const blocked = await call('POST', '/api/share/tok-password/verify', {
    body: { password: 'not it' },
  });
  assert.equal(blocked.status, 429);
  assert.equal(
    blocked.body.error,
    'rate_limited',
    'the same code the guest path returns',
  );
  assert.equal(blocked.headers['Retry-After'], '3600');

  // Even the *right* password is refused while the bucket is empty: the gate
  // is shut, not the password wrong.
  const correctButBlocked = await call(
    'POST',
    '/api/share/tok-password/verify',
    {
      body: { password: PASSWORD },
    },
  );
  assert.equal(correctButBlocked.status, 429);
  assert.equal(
    link('tok-password').use_count,
    0,
    'a throttled attempt is never a use',
  );
  assert.deepEqual(accessLog(), [], 'and it is never logged as access');
});

test('the throttle is scoped to the guessing surface: a no-password link is not capped', async () => {
  seed();

  // Far more than three opens of a link that guards nothing — all allowed,
  // because there is no secret to guess and the anonymous happy path must
  // stay open.
  for (const open of [1, 2, 3, 4, 5]) {
    const res = await call('POST', '/api/share/tok-view/verify', { body: {} });
    assert.equal(res.status, 200, `open ${open} is not throttled`);
    assert.equal(
      link('tok-view').use_count,
      open,
      'each open is a real, counted use',
    );
  }
});

// ---------------------------------------------------------------------------
// The guest chain: request → verify → session
// ---------------------------------------------------------------------------

test('a guest on an open comment link verifies into a session', async () => {
  seed();
  const { sessionToken, verified } = await guestSession('tok-open');

  assert.equal(
    verified.headers.Location,
    `http://${HOST}/s/tok-open?guest_verified=true`,
    'the guest lands back on the deck they were invited to',
  );
  const cookie = verified.headers['Set-Cookie'];
  assert.match(cookie, /^share_guest_session=/);
  assert.match(cookie, /HttpOnly/, 'the session is not readable from script');
  assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(
    cookie,
    /Secure/,
    'plain HTTP in the test, so no Secure flag',
  );

  const me = await call('GET', '/api/share/tok-open/guest/me', {
    cookie: `share_guest_session=${sessionToken}`,
  });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, {
    authenticated: true,
    email: 'guest@example.com',
    name: 'Gwen',
    permission: 'comment',
    canComment: true,
  });
});

test('a view-only link admits no guests at all', async () => {
  seed();
  const res = await call('POST', '/api/share/tok-view/guest/request', {
    body: { email: 'guest@example.com' },
  });

  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden');
  assert.deepEqual(guests(), [], 'nothing is recorded for a refused request');
});

test('an invite-only link refuses someone who was never invited', async () => {
  seed();
  const res = await call('POST', '/api/share/tok-invite/guest/request', {
    body: { email: 'stranger@example.com' },
  });

  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'not_invited');
  assert.deepEqual(
    guests(),
    [],
    'no verification token is minted for a stranger',
  );
});

test('an invited guest passes the same invite-only link', async () => {
  seed();
  db.__tables.share_link_guests.push({
    id: 'guest-invited',
    organization_id: ORG,
    share_link_id: 'link-invite',
    email: 'invited@example.com',
    name: 'Ivy',
    invited_at: '2026-02-01T00:00:00.000Z',
    invited_by: 'author@example.com',
    created_at: '2026-02-01T00:00:00.000Z',
  });

  const res = await call('POST', '/api/share/tok-invite/guest/request', {
    body: { email: 'invited@example.com' },
  });
  assert.equal(res.status, 200);
  assert.equal(
    typeof guests().find((g) => g.email === 'invited@example.com')
      .verification_token,
    'string',
  );
});

test('a guest request against a dead link is refused before any mail', async () => {
  seed();
  for (const [token, status] of [
    ['tok-revoked', 410],
    ['tok-expired', 410],
    ['tok-nonexistent', 404],
  ]) {
    const res = await call('POST', `/api/share/${token}/guest/request`, {
      body: { email: 'guest@example.com' },
    });
    assert.equal(res.status, status, `${token} is refused`);
  }
  assert.deepEqual(guests(), []);
});

test('a guest request without a usable email is a 400', async () => {
  seed();
  for (const body of [{}, { email: 'not-an-email' }, { email: '   ' }]) {
    const res = await call('POST', '/api/share/tok-open/guest/request', {
      body,
    });
    assert.equal(res.status, 400, `${JSON.stringify(body)} is refused`);
  }
  assert.deepEqual(guests(), []);
});

test('an unknown verification token redirects with an error and sets no cookie', async () => {
  seed();
  const res = await call('GET', '/api/share/tok-open/guest/verify/not-a-token');

  assert.equal(res.status, 302);
  assert.equal(
    res.headers.Location,
    `http://${HOST}/s/tok-open?guest_error=invalid_token`,
  );
  assert.equal(
    res.headers['Set-Cookie'],
    undefined,
    'no session is handed out',
  );
});

test('an expired verification token is refused the same way', async () => {
  seed();
  await call('POST', '/api/share/tok-open/guest/request', {
    body: { email: 'guest@example.com' },
  });
  const guest = guests()[0];
  guest.verification_token_expires_at = past();

  const res = await call(
    'GET',
    `/api/share/tok-open/guest/verify/${guest.verification_token}`,
  );
  assert.equal(res.status, 302);
  assert.match(res.headers.Location, /guest_error=token_expired$/);
  assert.equal(res.headers['Set-Cookie'], undefined);
  assert.equal(guest.session_token, undefined, 'no session token is minted');
});

// ---------------------------------------------------------------------------
// GET /api/share/:token/guest/me — a session is bound to one link
// ---------------------------------------------------------------------------

test('without a cookie the caller is anonymous but learns the link permission', async () => {
  seed();
  const res = await call('GET', '/api/share/tok-open/guest/me');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { authenticated: false, permission: 'comment' });
});

test('a session minted for one link does not authenticate against another', async () => {
  seed();
  const { sessionToken } = await guestSession('tok-open');

  const elsewhere = await call('GET', '/api/share/tok-other/guest/me', {
    cookie: `share_guest_session=${sessionToken}`,
  });
  assert.deepEqual(
    elsewhere.body,
    { authenticated: false, permission: 'view' },
    'the session belongs to tok-open; against tok-other it is worth nothing',
  );
});

test('an unknown session cookie is simply not authenticated', async () => {
  seed();
  const res = await call('GET', '/api/share/tok-open/guest/me', {
    cookie: 'share_guest_session=made-up',
  });

  assert.deepEqual(res.body, { authenticated: false, permission: 'comment' });
});

test('revoking the link drops the guest session that hung off it', async () => {
  seed();
  const { sessionToken } = await guestSession('tok-open');

  link('tok-open').revoked_at = past();

  const res = await call('GET', '/api/share/tok-open/guest/me', {
    cookie: `share_guest_session=${sessionToken}`,
  });
  assert.deepEqual(
    res.body,
    { authenticated: false },
    'a revoked link reports no permission at all, not even the old one',
  );
});

test('a guest session is not a session against an unknown link', async () => {
  seed();
  const { sessionToken } = await guestSession('tok-open');

  const res = await call('GET', '/api/share/tok-nonexistent/guest/me', {
    cookie: `share_guest_session=${sessionToken}`,
  });
  assert.deepEqual(res.body, { authenticated: false });
});

// ---------------------------------------------------------------------------
// What this module does not answer
// ---------------------------------------------------------------------------

test('the handler declines everything outside its five endpoints', async () => {
  seed();
  const declined = [
    ['POST', '/api/share/tok-view'],
    ['DELETE', '/api/share/tok-view'],
    ['GET', '/api/share/tok-view/verify'],
    ['POST', '/api/share/tok-view/guest/me'],
    ['GET', '/api/share/tok-view/guest/request'],
    ['GET', '/api/share/tok-view/guest/verify'],
    ['GET', '/api/share'],
    ['GET', '/api/presentations/deck-shared'],
  ];

  for (const [method, path] of declined) {
    const res = await call(method, path);
    assert.equal(res.handled, false, `${method} ${path} is not this module's`);
    assert.equal(res.status, null, 'and nothing was written to the response');
  }
});
