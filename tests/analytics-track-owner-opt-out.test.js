/**
 * The owner's analytics opt-out has one authority: the tracking route (B503).
 *
 * A deck owner can switch analytics off per deck
 * (`settings.analyticsEnabled === false`). Until B503 the share viewer read
 * that flag itself, from a copy the share payload carried, while follow read
 * only the viewer's own preference and left the owner's rule to the server
 * (D234). Two places for one rule. Now both viewers ask only the viewer's
 * preference, the share payload no longer carries the owner's flag, and
 * `POST /api/track/session/start` is where the opt-out is enforced.
 *
 * This file pins that authority for the share-link source: a valid link to an
 * opted-out deck gets no session, and the same link to a deck that allows
 * analytics does (the control, so the refusal is the opt-out and not the
 * link). The last test pins the client half: nothing hands the tracker's
 * `isAnalyticsEnabled()` a deck anymore.
 *
 * House shape (see `tests/analytics-track-erase.test.js`): the exported
 * handler is called directly with a req/res double over
 * `tests/helpers/fake-db.js`.
 *
 * Run with: node --test tests/analytics-track-owner-opt-out.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { resetRateLimitBuckets } = await import('../server/utils/rate-limit.js');
const { handleAnalyticsTrack } =
  await import('../server/routes/api/analytics-track.js');

const DECK_OPTED_OUT = '11111111-1111-4111-8111-111111111111';
const DECK_TRACKED = '22222222-2222-4222-8222-222222222222';
const DEVICE = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

/** A stored deck, in the shape the presentations adapter reads. */
function deckRow(id, settings) {
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
    slides: [{ id: 's1', type: 'content-slide', content: { title: 'Hi' } }],
    i18n: null,
    settings,
    created_at: '2026-02-01T00:00:00.000Z',
    modified_at: '2026-02-01T00:00:00.000Z',
    trashed_at: null,
  };
}

/** A live view link, with the column defaults the migrations give it. */
function linkRow(id, presentationId) {
  return {
    id,
    token: `tok-${id}`,
    organization_id: ORG,
    presentation_id: presentationId,
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
  };
}

function seed() {
  resetRateLimitBuckets();
  const db = createFakeDb({
    // Instance analytics on, so the control reaches session creation.
    app_settings: [{ id: 1, settings: { analytics: { enabled: true } } }],
    presentations: [
      deckRow(DECK_OPTED_OUT, { analyticsEnabled: false }),
      deckRow(DECK_TRACKED, {}),
    ],
    presentation_share_links: [
      linkRow('out', DECK_OPTED_OUT),
      linkRow('in', DECK_TRACKED),
    ],
    view_sessions: [],
  });
  __setTestDb(db);
  return db;
}

/** Call the session-start route the way `routes/api/index.js` does. */
async function startSession(body) {
  const payload = JSON.stringify(body);
  const req = {
    method: 'POST',
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload, 'utf8');
    },
  };
  const res = {
    status: null,
    chunks: [],
    setHeader() {},
    writeHead(status) {
      this.status = status;
      return this;
    },
    end(chunk) {
      if (chunk) this.chunks.push(chunk);
    },
  };
  await handleAnalyticsTrack({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL('http://decks.example.test/api/track/session/start'),
  });
  const raw = res.chunks.length ? res.chunks.join('') : null;
  return { status: res.status, body: raw ? JSON.parse(raw) : null };
}

test.after(() => {
  __setTestDb(null);
});

test('a share viewer of an opted-out deck is refused by the server', async () => {
  const db = seed();
  const { status, body } = await startSession({
    presentationId: DECK_OPTED_OUT,
    sourceType: 'share_link',
    sourceId: 'tok-out',
    viewerType: 'anonymous',
    deviceId: DEVICE,
  });
  assert.equal(status, 403);
  assert.equal(body.error, 'forbidden');
  assert.equal(db.__tables.view_sessions.length, 0, 'no session recorded');
});

test('the same link shape on a deck that allows analytics gets a session', async () => {
  const db = seed();
  const { status, body } = await startSession({
    presentationId: DECK_TRACKED,
    sourceType: 'share_link',
    sourceId: 'tok-in',
    viewerType: 'anonymous',
    deviceId: DEVICE,
  });
  assert.equal(status, 200);
  assert.ok(body.sessionToken, 'a session token is handed out');
  assert.equal(db.__tables.view_sessions.length, 1);
});

test('no client caller hands isAnalyticsEnabled() a deck', () => {
  // The owner's rule lives on the server; a client call with an argument is
  // the second authority this item removed.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.js')) {
        const src = readFileSync(path, 'utf8');
        if (/isAnalyticsEnabled\(\s*[^)\s]/.test(src)) offenders.push(path);
      }
    }
  };
  walk(join(process.cwd(), 'client'));
  assert.deepEqual(offenders, []);
});
