/**
 * The read-only identity resolver (T10, PR 1).
 *
 * Pins the resolver's contract against both storage shapes without a real
 * database: the in-memory double stands in for Postgres mode (a `users` table
 * to key on), and uninstalling it (`__setTestDb(null)`) reproduces file mode,
 * where there is no `users` table and every email is therefore external. The
 * matching real-PostgreSQL coverage lives in
 * tests/pg/collaborator-authz-resolution.pgtest.js.
 *
 * These are the behaviours the rest of the epic will build on, so they are
 * pinned before anything is wired onto the resolver:
 *   - a known email resolves to its stable users.id, normalized first;
 *   - an unknown email is a *defined* external identity, not a null failure;
 *   - a blank identifier is null (nothing to resolve);
 *   - a future identifier kind fails loud rather than silently mis-resolving.
 *
 * Run with: node --test tests/identity-resolver.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeDb } from './helpers/fake-db.js';
import { __setTestDb } from '../server/db/client.js';
import {
  resolveIdentity,
  resolveIdentityByEmail,
  IDENTIFIER_KINDS,
} from '../server/storage/identity-resolver.js';

const ALICE_ID = '11111111-1111-1111-1111-111111111111';
const DEFAULT_ORG = '00000000-0000-0000-0000-0000000000aa';

function seedDb() {
  const db = createFakeDb({
    organizations: [{ id: DEFAULT_ORG, name: 'Default', slug: 'default' }],
    users: [
      {
        id: ALICE_ID,
        organization_id: DEFAULT_ORG,
        email: 'alice@example.com',
        name: 'Alice',
        role: 'user',
        auth_source: 'database',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        settings: {},
      },
    ],
  });
  __setTestDb(db);
  return db;
}

describe('identity resolver — Postgres mode (users table present)', () => {
  before(() => {
    seedDb();
  });
  after(() => {
    __setTestDb(null);
  });

  it('resolves a known email to its stable users.id', async () => {
    const res = await resolveIdentityByEmail('alice@example.com');
    assert.deepEqual(res, {
      userId: ALICE_ID,
      kind: IDENTIFIER_KINDS.EMAIL,
      value: 'alice@example.com',
      resolved: true,
      external: false,
    });
  });

  it('normalizes the email before looking it up (case + whitespace)', async () => {
    const res = await resolveIdentityByEmail('  Alice@Example.COM  ');
    assert.equal(res.userId, ALICE_ID);
    assert.equal(res.value, 'alice@example.com', 'the normalized value is reported back');
    assert.equal(res.resolved, true);
  });

  it('defaults the identifier kind to email', async () => {
    const res = await resolveIdentity({ value: 'alice@example.com' });
    assert.equal(res.kind, IDENTIFIER_KINDS.EMAIL);
    assert.equal(res.userId, ALICE_ID);
  });

  it('reports an unknown email as a defined external identity, not a failure', async () => {
    const res = await resolveIdentityByEmail('stranger@external.test');
    assert.deepEqual(res, {
      userId: null,
      kind: IDENTIFIER_KINDS.EMAIL,
      value: 'stranger@external.test',
      resolved: false,
      external: true,
    });
  });

  it('returns null for a structurally absent identifier', async () => {
    assert.equal(await resolveIdentityByEmail(''), null);
    assert.equal(await resolveIdentityByEmail('   '), null);
    assert.equal(await resolveIdentityByEmail(null), null);
    assert.equal(await resolveIdentity({}), null);
    assert.equal(await resolveIdentity(), null);
  });

  it('rejects an unsupported identifier kind loudly', async () => {
    await assert.rejects(
      () => resolveIdentity({ kind: 'atproto_did', value: 'did:plc:abc123' }),
      /unsupported identifier kind/
    );
  });
});

describe('identity resolver — file mode (no users table)', () => {
  before(() => {
    __setTestDb(null); // no database available: file-mode identity lives in the deck JSON
  });

  it('resolves every well-formed email as external, since there is nothing to key on', async () => {
    const res = await resolveIdentityByEmail('alice@example.com');
    assert.deepEqual(res, {
      userId: null,
      kind: IDENTIFIER_KINDS.EMAIL,
      value: 'alice@example.com',
      resolved: false,
      external: true,
    });
  });

  it('still returns null for a blank identifier in file mode', async () => {
    assert.equal(await resolveIdentityByEmail(''), null);
  });
});
