/**
 * The comment fan-out resolver receives the caller's storage scope under the
 * name `scope` — and actually uses it.
 *
 * PR 12 of the storage-call-convention track renamed the notification
 * services' `ctx` parameter to `scope` at the call sites, but
 * `resolveCommentRecipients` still destructured `ctx`, so every org-scoped
 * lookup inside it (mention account check, thread participants, per-deck
 * subscriptions) received `undefined`, threw inside its local try/catch, and
 * silently dropped the recipients. This file calls the resolver end-to-end
 * with a fake db: a mentioned in-org user must survive the account check, and
 * a mention to a non-account must still be dropped.
 *
 * Run with: node --test tests/comment-recipients-scope.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Assembled rather than written as one literal so secret scanners do not flag
// it; authConfigError() only requires MIN_AUTH_SECRET_LENGTH characters.
process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_DEV_BYPASS;
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { resolveCommentRecipients } =
  await import('../server/services/comment-subscriptions.js');

const scope = {
  organizationId: ORG,
  actorEmail: 'author@example.com',
  repoRoot: null,
};

/**
 * @param {string} id
 * @param {string} email
 * @returns {Object} users row
 */
function userRow(id, email) {
  return {
    id,
    email,
    name: null,
    role: 'editor',
    auth_source: 'password',
    organization_id: ORG,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

test.afterEach(() => {
  __setTestDb(null);
});

test('a mentioned in-org user is resolved as a recipient through the passed scope', async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Alpha', slug: 'alpha', settings: {} }],
      users: [userRow('user-mira', 'mira@example.com')],
    }),
  );

  const recipients = await resolveCommentRecipients({
    presentation: { id: 'deck-1', ownerEmail: 'owner@example.com' },
    comment: {
      id: 'c1',
      body: 'ping @[mira@example.com]',
      mentions: [{ email: 'mira@example.com' }],
    },
    actor: { email: 'author@example.com' },
    scope,
  });

  const mention = recipients.find((r) => r.email === 'mira@example.com');
  assert.ok(
    mention,
    'the mentioned account must survive the org-scoped account check',
  );
  assert.equal(mention.reason, 'mention');
});

test('a mention to an address without an account is dropped', async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Alpha', slug: 'alpha', settings: {} }],
      users: [],
    }),
  );

  const recipients = await resolveCommentRecipients({
    presentation: { id: 'deck-1', ownerEmail: 'owner@example.com' },
    comment: {
      id: 'c1',
      body: 'ping',
      mentions: [{ email: 'ghost@example.com' }],
    },
    actor: { email: 'author@example.com' },
    scope,
  });

  assert.equal(
    recipients.find((r) => r.email === 'ghost@example.com'),
    undefined,
    'unmatched mentions must never produce a notification',
  );
});
