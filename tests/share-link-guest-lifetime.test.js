/**
 * Share-link guests: the lifetime of the session token (B811).
 *
 * `share_link_guests` holds an e-mail-verified guest and, once verified, a
 * possessed session token. The anonymous-visitor register
 * (`tests/fixtures/anonymous-visitor-stores.json`) names this file as the
 * pin of that lifetime: verification sets a seven-day session, an expired
 * session or a revoked link resolves to no guest, and the author's removal
 * deletes the row.
 *
 * Run with: node --test tests/share-link-guest-lifetime.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fake-db.js';
import { __setTestDb } from '../server/db/client.js';
import {
  getGuestBySessionToken,
  removeGuest,
  verifyGuestEmail,
} from '../server/storage/share-links/guests.js';

const ORG = 'org-alpha';
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

function setup({ guest = {}, link = {} } = {}) {
  const db = createFakeDb({
    presentation_share_links: [
      {
        id: 'link-1',
        organization_id: ORG,
        presentation_id: 'deck-1',
        permission: 'comment',
        revoked_at: null,
        expires_at: null,
        ...link,
      },
    ],
    share_link_guests: [
      {
        id: 'guest-1',
        organization_id: ORG,
        share_link_id: 'link-1',
        email: 'guest@example.com',
        name: 'Guest',
        verification_token: 'verify-token',
        verification_token_expires_at: iso(DAY_MS),
        verified_at: null,
        session_token: null,
        session_expires_at: null,
        ...guest,
      },
    ],
  });
  __setTestDb(db);
  return db;
}

test.after(() => __setTestDb(null));

test('verification writes a session token that expires after seven days', async () => {
  const db = setup();
  const before = Date.now();
  const result = await verifyGuestEmail('verify-token');
  assert.equal(result.ok, true, JSON.stringify(result));

  const [row] = db.__tables.share_link_guests;
  assert.equal(row.session_token, result.sessionToken);
  assert.equal(row.verification_token, null);
  const expiresMs = new Date(row.session_expires_at).getTime() - before;
  assert.ok(
    Math.abs(expiresMs - 7 * DAY_MS) < 60_000,
    `session expires ${expiresMs} ms after verification`,
  );
});

test('a live session token on a valid link resolves to its guest', async () => {
  setup({
    guest: {
      verified_at: iso(-DAY_MS),
      session_token: 'session-token',
      session_expires_at: iso(6 * DAY_MS),
    },
  });
  const resolved = await getGuestBySessionToken('session-token');
  assert.equal(resolved?.guest.id, 'guest-1');
  assert.equal(resolved.organizationId, ORG);
});

test('an expired session token resolves to no guest', async () => {
  setup({
    guest: {
      verified_at: iso(-8 * DAY_MS),
      session_token: 'session-token',
      session_expires_at: iso(-DAY_MS),
    },
  });
  assert.equal(await getGuestBySessionToken('session-token'), null);
});

test('a live session token on a revoked link resolves to no guest', async () => {
  setup({
    guest: {
      verified_at: iso(-DAY_MS),
      session_token: 'session-token',
      session_expires_at: iso(6 * DAY_MS),
    },
    link: { revoked_at: iso(-60_000) },
  });
  assert.equal(await getGuestBySessionToken('session-token'), null);
});

test("the author's removal deletes the guest row with its session token", async () => {
  const db = setup({
    guest: {
      verified_at: iso(-DAY_MS),
      session_token: 'session-token',
      session_expires_at: iso(6 * DAY_MS),
    },
  });
  assert.deepEqual(await removeGuest({ organizationId: ORG }, 'guest-1'), {
    ok: true,
    deleted: true,
  });
  assert.deepEqual(db.__tables.share_link_guests, []);
});
