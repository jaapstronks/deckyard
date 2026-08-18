/**
 * Two identifiers stop at the response boundary of the session list.
 *
 * `GET /api/presentations/:id/analytics/sessions` is readable by every reader
 * of a deck (`withPresentationAuth permission: 'read'`), and it used to hand
 * out `view_sessions.device_id` verbatim: a browser-generated 32-hex value that
 * is the *same string on every deck that browser visits*. Two deck owners could
 * therefore compare their viewer lists and establish that one visitor is one
 * person — an instance-wide identifier handed to anyone with read access.
 *
 * `handleSessions` now maps that field through `publicDeviceLabel`
 * (`server/analytics/helpers.js`): `HMAC-SHA256(AUTH_SECRET, deviceId ‖
 * presentationId)`, truncated to 12 hex. Same field name, derived value — the
 * viewer list keeps the one property it actually uses (two visits from one
 * browser to *this* deck look the same) and loses the one nobody should have
 * (the same browser looks the same across decks). The raw id stays in the
 * database, where the erasure path and the `COUNT(DISTINCT device_id)`
 * aggregations need it.
 *
 * The same boundary also drops `sessionToken` entirely. The token is the
 * proof-of-possession a viewer's own browser uses to update or (under the
 * erasure path) delete its session; handing it to every reader of the deck
 * would let any reader act on a session that isn't theirs. Unlike `deviceId`
 * the response has no use for it at all, so it is omitted rather than derived.
 * The raw token stays in the storage mapper (`rowToSession`), where the
 * internal heartbeat/end/lookup-by-token callers need it.
 *
 * Four rules are pinned here, in the order they matter:
 *
 *   1. **One browser, two decks → two unrelated labels.** This is the whole
 *      point: cross-deck correlation is broken.
 *   2. **One browser, two sessions in one deck → one label.** The property the
 *      UI still relies on (`viewer-list.js` shows the first eight characters as
 *      a returning-viewer marker) survives.
 *   3. **No field of the response is a raw device id in any shape.** Asserted
 *      over every string in the payload rather than over `deviceId` alone, so a
 *      future field that leaks the raw value fails this test too.
 *   4. **No session token, in any field, reaches the response.** Asserted the
 *      same way — over every string and over the `sessionToken` field by name —
 *      so a future re-spread of the raw row fails here.
 *
 * House shape (see `tests/analytics-gdpr-delete-path.test.js`,
 * `tests/collaborator-cross-org-endpoints.test.js`): the exported handler is
 * called directly with a req/res double over `tests/helpers/fake-db.js`. No
 * HTTP server, no browser.
 *
 * AUTH_SECRET is set before the imports so the default-path tests derive
 * against a stable, known key; the helper reads it at call time, so the
 * secretless-boot tests at the bottom delete it around their own calls to
 * exercise the ephemeral-key fallback (B48/D7). This file relies on node --test
 * giving it its own process.
 *
 * Run with: node --test tests/analytics-session-device-label.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'test-secret-for-device-labels-0123456789';
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

/** The single organization both decks and the caller live in. */
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } = await import(
  '../server/storage/lifecycle.js'
);
const { publicDeviceLabel, deviceLabelKeySource } = await import(
  '../server/analytics/helpers.js'
);
const { handleSessions } = await import('../server/routes/api/analytics/metrics.js');
const { createStorageScope } = await import('../server/utils/context.js');

/** Two decks owned by the same person, so authorization is never the variable. */
const DECK_ONE = 'deck-one';
const DECK_TWO = 'deck-two';
const OWNER = {
  email: 'owner@example.test',
  name: 'Otto',
  role: 'admin',
  organizationId: ORG,
};
/** One browser: the same 32-hex value the tracker would send to both decks. */
const DEVICE = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
/** A 32-hex value in any field is the shape rule 3 forbids. */
const RAW_DEVICE_ID_SHAPE = /^[a-f0-9]{32}$/i;
/** A live session token, in the 64-hex shape `generateSessionToken` writes. */
const TOKEN = 'f00dfeed'.repeat(8);
/** A 64-hex value in any field is the shape rule 4 forbids. */
const SESSION_TOKEN_SHAPE = /^[a-f0-9]{64}$/i;

// ---------------------------------------------------------------------------
// Doubles and seeding
// ---------------------------------------------------------------------------

/** A stored deck, in the shape the presentations adapter reads. */
function deckRow(id) {
  return {
    id,
    organization_id: ORG,
    title: `Deck ${id}`,
    owner_email: OWNER.email,
    created_by: OWNER.email,
    updated_by: OWNER.email,
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
  };
}

/** A `view_sessions` row in the shape `createViewSession` writes. */
function sessionRow({
  id,
  deck,
  device = DEVICE,
  token = TOKEN,
  startedAt = '2026-03-01T10:00:00.000Z',
}) {
  return {
    id,
    presentation_id: deck,
    session_token: token,
    source_type: 'share_link',
    source_id: null,
    viewer_type: 'anonymous',
    viewer_email: null,
    device_id: device,
    started_at: startedAt,
    last_activity_at: startedAt,
    ended_at: null,
    duration_seconds: 0,
    exit_slide_id: null,
    exit_slide_index: null,
    ip_address: '203.0.113.5',
    user_agent: 'UA/1.0',
    attribution_allowed: false,
    created_at: startedAt,
  };
}

/** Install a fresh double holding both decks and the given sessions. */
function seed(sessions) {
  const db = createFakeDb({
    presentations: [deckRow(DECK_ONE), deckRow(DECK_TWO)],
    presentation_collaborators: [],
    view_sessions: sessions,
    slide_views: [],
  });
  __setTestDb(db);
  return db;
}

/**
 * Call the handler the way `routes/api/index.js` does and parse the payload.
 * @param {string} deck - The presentation id to ask about.
 * @returns {Promise<{status: number|null, body: Object|null}>}
 */
async function callSessions(deck) {
  const res = {
    status: null,
    chunks: [],
    writeHead(status) {
      this.status = status;
      return this;
    },
    setHeader() {},
    end(chunk) {
      if (chunk) this.chunks.push(chunk);
    },
  };

  await handleSessions(
    {
      repoRoot: process.cwd(),
      storageScope: createStorageScope(OWNER, { repoRoot: process.cwd() }),
      res,
      url: new URL(`http://decks.example.test/api/presentations/${deck}/analytics/sessions`),
      authedUser: OWNER,
    },
    deck
  );

  const raw = res.chunks.length ? res.chunks.join('') : null;
  return { status: res.status, body: raw ? JSON.parse(raw) : null };
}

test.before(async () => {
  __setTestDb(createFakeDb({}));
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

// ---------------------------------------------------------------------------
// Rule 1 — one browser is two strangers across two decks
// ---------------------------------------------------------------------------

test('the same device reads as a different label in each deck', async () => {
  seed([
    sessionRow({ id: 's-one', deck: DECK_ONE }),
    sessionRow({ id: 's-two', deck: DECK_TWO }),
  ]);

  const first = await callSessions(DECK_ONE);
  const second = await callSessions(DECK_TWO);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const labelOne = first.body.sessions[0].deviceId;
  const labelTwo = second.body.sessions[0].deviceId;

  assert.match(labelOne, /^[a-f0-9]{12}$/, 'a 12-hex label, not the raw id');
  assert.notEqual(
    labelOne,
    labelTwo,
    'two deck owners cannot line up their lists and find the same visitor'
  );
  // Neither label is a truncation of the raw id — that is the cheap
  // alternative, and it would have preserved exactly this correlation.
  for (const label of [labelOne, labelTwo]) {
    assert.notEqual(label, DEVICE.slice(0, 12), 'the label is derived, not a prefix');
  }
});

// ---------------------------------------------------------------------------
// Rule 2 — within one deck, a returning viewer still looks like one
// ---------------------------------------------------------------------------

test('two visits from one device to one deck carry one label', async () => {
  seed([
    sessionRow({ id: 'visit-1', deck: DECK_ONE, startedAt: '2026-03-01T10:00:00.000Z' }),
    sessionRow({ id: 'visit-2', deck: DECK_ONE, startedAt: '2026-03-02T10:00:00.000Z' }),
  ]);

  const { status, body } = await callSessions(DECK_ONE);

  assert.equal(status, 200);
  assert.equal(body.sessions.length, 2);
  assert.equal(
    body.sessions[0].deviceId,
    body.sessions[1].deviceId,
    'the returning-viewer signal the list is built on survives'
  );
  assert.equal(
    body.sessions[0].deviceId,
    publicDeviceLabel(DEVICE, DECK_ONE),
    'and it is the label the helper derives, not some other stable string'
  );
});

test('a session without a device id keeps a null label', async () => {
  seed([sessionRow({ id: 'no-device', deck: DECK_ONE, device: null })]);

  const { status, body } = await callSessions(DECK_ONE);

  assert.equal(status, 200);
  assert.equal(body.sessions[0].deviceId, null, 'absent stays absent — nothing is invented');
});

// ---------------------------------------------------------------------------
// Rule 3 — the raw shape does not cross the boundary at all
// ---------------------------------------------------------------------------

test('no field of the response carries a raw device id', async () => {
  seed([
    sessionRow({ id: 's-one', deck: DECK_ONE }),
    sessionRow({ id: 'no-device', deck: DECK_ONE, device: null }),
  ]);

  const { status, body } = await callSessions(DECK_ONE);

  assert.equal(status, 200);

  /** Every string anywhere in the payload, field name included. */
  const strings = [];
  (function walk(value) {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  })(body);

  assert.ok(strings.length > 0, 'the payload was actually inspected');
  for (const value of strings) {
    assert.ok(
      !RAW_DEVICE_ID_SHAPE.test(value),
      `a 32-hex value reached the response: ${value}`
    );
  }
  assert.ok(
    !strings.includes(DEVICE),
    'and the seeded device id specifically is nowhere in the payload'
  );
});

// ---------------------------------------------------------------------------
// Rule 4 — the session token does not cross the boundary at all
// ---------------------------------------------------------------------------

test('no field of the response carries a session token', async () => {
  seed([
    sessionRow({ id: 's-one', deck: DECK_ONE }),
    sessionRow({ id: 's-two', deck: DECK_ONE }),
  ]);

  const { status, body } = await callSessions(DECK_ONE);

  assert.equal(status, 200);
  assert.equal(body.sessions.length, 2);

  // The field is gone by name, not merely renamed or nulled.
  for (const session of body.sessions) {
    assert.ok(
      !('sessionToken' in session),
      'the sessions list no longer exposes the sessionToken field'
    );
  }

  /** Every string anywhere in the payload, field name included. */
  const strings = [];
  (function walk(value) {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  })(body);

  assert.ok(strings.length > 0, 'the payload was actually inspected');
  for (const value of strings) {
    assert.ok(
      !SESSION_TOKEN_SHAPE.test(value),
      `a 64-hex session token reached the response: ${value}`
    );
  }
  assert.ok(
    !strings.includes(TOKEN),
    'and the seeded token specifically is nowhere in the payload'
  );
});

// ---------------------------------------------------------------------------
// The helper's own contract
// ---------------------------------------------------------------------------

test('the label helper refuses to guess a deck', async () => {
  assert.equal(publicDeviceLabel(null, DECK_ONE), null);
  assert.equal(publicDeviceLabel('', DECK_ONE), null);

  assert.throws(
    () => publicDeviceLabel(DEVICE, ''),
    /presentation id/,
    'a deckless label would be an instance-wide identifier again'
  );
});

// ---------------------------------------------------------------------------
// Secretless boot modes (auth-off / sandbox / demo) — B48 / D7
// ---------------------------------------------------------------------------
//
// Those modes boot without AUTH_SECRET on purpose. The helper used to throw
// when it was missing, which turned the whole session list into a 500 the
// moment any session had been tracked. It now falls back to an ephemeral
// per-boot random key: a real label, still unguessable and still per-deck, so
// the list works without a configured secret. What it must NOT do is invent a
// guessable constant — that would make the label reversible again.

test('the key source is auth-secret when one is set, ephemeral when not', () => {
  assert.deepEqual(deviceLabelKeySource(), { source: 'auth-secret' });

  const secret = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  try {
    assert.deepEqual(
      deviceLabelKeySource(),
      { source: 'ephemeral' },
      'no configured secret falls back to the ephemeral per-boot key'
    );
  } finally {
    process.env.AUTH_SECRET = secret;
  }
});

test('without a secret the helper still derives a label, and a different one', () => {
  const withSecret = publicDeviceLabel(DEVICE, DECK_ONE);

  const secret = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  try {
    const first = publicDeviceLabel(DEVICE, DECK_ONE);
    const again = publicDeviceLabel(DEVICE, DECK_ONE);

    assert.match(first, /^[a-f0-9]{12}$/, 'a real 12-hex label, not a throw');
    assert.equal(first, again, 'stable within the boot — a returning viewer still lines up');
    assert.notEqual(
      first,
      withSecret,
      'the ephemeral key is not the configured secret, nor a shared constant'
    );
    assert.notEqual(first, DEVICE.slice(0, 12), 'still derived, never a prefix of the raw id');
  } finally {
    process.env.AUTH_SECRET = secret;
  }
});

test('the session list does not 500 in a secretless boot with tracked sessions', async () => {
  seed([
    sessionRow({ id: 's-one', deck: DECK_ONE }),
    sessionRow({ id: 's-two', deck: DECK_ONE }),
  ]);

  const secret = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  try {
    const { status, body } = await callSessions(DECK_ONE);

    assert.equal(status, 200, 'the list renders instead of throwing a 500');
    assert.equal(body.sessions.length, 2);
    for (const session of body.sessions) {
      assert.match(session.deviceId, /^[a-f0-9]{12}$/, 'each session still carries a label');
      assert.ok(
        !RAW_DEVICE_ID_SHAPE.test(session.deviceId),
        'and the label is never the raw device id'
      );
    }
  } finally {
    process.env.AUTH_SECRET = secret;
  }
});
