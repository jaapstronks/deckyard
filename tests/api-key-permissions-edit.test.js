/**
 * Changing the permissions of an existing API key (B813).
 *
 * Storage (`updateApiKeyPermissions`) is scoped exactly like revoke: the
 * caller's own, unrevoked key in the caller's organization. Validation is the
 * one creation uses. The change takes effect on the key's next request (the
 * gates re-read it through `validateApiKey`), and it leaves an activity event
 * with the before/after lists. The route answers in the internal envelope.
 *
 * Runs against the in-memory Kysely double (tests/helpers/fake-db.js).
 *
 * Run with: node --test tests/api-key-permissions-edit.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeDb } from './helpers/fake-db.js';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';
import { __setTestDb } from '../server/db/client.js';
import {
  createApiKey,
  revokeApiKey,
  updateApiKeyPermissions,
  validateApiKey,
  validatePermissions,
} from '../server/storage/api-keys.js';
import { handleApiKeys } from '../server/routes/api/api-keys.js';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const OWNER = 'owner@example.test';
const COLLEAGUE = 'colleague@example.test';

const scopeFor = (email, organizationId = ORG_A) => ({
  repoRoot: null,
  organizationId,
  actorEmail: email,
});

let db;

test.beforeEach(() => {
  db = createFakeDb({});
  __setTestDb(db);
});

test.afterEach(() => {
  __setTestDb(null);
});

async function seedKey(permissions = ['read', 'write']) {
  const created = await createApiKey(scopeFor(OWNER), {
    name: 'CI bot',
    ownerEmail: OWNER,
    permissions,
  });
  assert.equal(created.ok, true, `seed failed: ${created.reason}`);
  return created;
}

// ─── validation (shared with create) ─────────────────────────────────────────

test('validatePermissions: refuses non-arrays, empty lists and unknown scopes', () => {
  for (const bad of [undefined, null, 'read', {}, [], ['read', 'root']]) {
    const result = validatePermissions(bad);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} is refused`);
    assert.equal(result.reason, 'invalid');
    assert.equal(result.field, 'permissions');
  }
  assert.deepEqual(validatePermissions(['read', 'read', 'ai']), {
    ok: true,
    permissions: ['read', 'ai'],
  });
});

test('createApiKey now refuses an explicit empty permission list', async () => {
  const result = await createApiKey(scopeFor(OWNER), {
    name: 'Empty',
    ownerEmail: OWNER,
    permissions: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.field, 'permissions');
});

// ─── storage authorization ───────────────────────────────────────────────────

test('the owner can change the permissions of their key', async () => {
  const created = await seedKey();
  const result = await updateApiKeyPermissions(scopeFor(OWNER), created.id, [
    'read',
    'collaborators:read',
    'collaborators:write',
  ]);
  assert.equal(result.ok, true, `update failed: ${result.reason}`);
  assert.deepEqual(result.before, ['read', 'write']);
  assert.deepEqual(result.key.permissions, [
    'read',
    'collaborators:read',
    'collaborators:write',
  ]);
  assert.equal(result.key.id, created.id);
  assert.equal(result.key.name, 'CI bot');
  assert.equal(result.key.prefix, created.prefix);
  assert.equal('key_hash' in result.key, false, 'no hash in the answer');
  assert.equal('key' in result.key, false, 'no raw key in the answer');
});

test('another user in the same organization is refused', async () => {
  const created = await seedKey();
  const result = await updateApiKeyPermissions(
    scopeFor(COLLEAGUE),
    created.id,
    ['read', 'ai'],
  );
  assert.deepEqual(result, {
    ok: false,
    reason: 'not_found_or_already_revoked',
  });
  assert.equal(
    db.__tables.api_keys[0].permissions,
    JSON.stringify(['read', 'write']),
    'the stored list is untouched',
  );
});

test('the same owner acting in another organization is refused', async () => {
  const created = await seedKey();
  const result = await updateApiKeyPermissions(
    scopeFor(OWNER, ORG_B),
    created.id,
    ['read', 'ai'],
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_found_or_already_revoked');
});

test('a revoked key is refused', async () => {
  const created = await seedKey();
  const revoked = await revokeApiKey(scopeFor(OWNER), created.id, OWNER);
  assert.equal(revoked.ok, true);
  const result = await updateApiKeyPermissions(scopeFor(OWNER), created.id, [
    'read',
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_found_or_already_revoked');
});

test('invalid, empty and unknown permissions are refused with field permissions', async () => {
  const created = await seedKey();
  for (const bad of [[], ['read', 'impersonate'], 'read', undefined]) {
    const result = await updateApiKeyPermissions(
      scopeFor(OWNER),
      created.id,
      bad,
    );
    assert.equal(result.ok, false, `${JSON.stringify(bad)} is refused`);
    assert.equal(result.reason, 'invalid');
    assert.equal(result.field, 'permissions');
  }
});

test('the change takes effect on the next validateApiKey, no cache', async () => {
  const created = await seedKey(['read']);
  const before = await validateApiKey(created.key);
  assert.deepEqual(before.permissions, ['read']);

  await updateApiKeyPermissions(scopeFor(OWNER), created.id, [
    'read',
    'comments:read',
    'comments:write',
  ]);

  const after = await validateApiKey(created.key);
  assert.equal(after.ok, true);
  assert.deepEqual(after.permissions, [
    'read',
    'comments:read',
    'comments:write',
  ]);
});

// ─── route ───────────────────────────────────────────────────────────────────

async function patch(id, body, email = OWNER) {
  const res = createMockRes();
  const pathname = `/api/api-keys/${id}`;
  await handleApiKeys({
    repoRoot: null,
    storageScope: scopeFor(email),
    authedUser: { email, name: 'Owner Person' },
    req: createMockReq({ method: 'PATCH', body }),
    res,
    url: { pathname, searchParams: new URLSearchParams() },
  });
  return { status: res.statusCode, body: res.json() };
}

test('PATCH 200 answers the listed key shape and writes the activity event', async () => {
  const created = await seedKey();
  const { status, body } = await patch(created.id, {
    permissions: ['read', 'export'],
  });
  assert.equal(status, 200);
  assert.equal(body.id, created.id);
  assert.deepEqual(body.permissions, ['read', 'export']);
  assert.equal(body.prefix, created.prefix);
  assert.equal(body.key, undefined, 'never the raw key');
  assert.equal(body.revokedAt ?? null, null);

  const events = db.__tables.activity_events || [];
  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.event_type, 'api_key.permissions_changed');
  assert.equal(event.entity_type, 'api_key');
  assert.equal(event.entity_id, created.id);
  assert.equal(event.organization_id, ORG_A);
  assert.equal(event.presentation_id, null);
  const data =
    typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  assert.deepEqual(data, {
    name: 'CI bot',
    prefix: created.prefix,
    before: ['read', 'write'],
    after: ['read', 'export'],
  });
  assert.equal(
    JSON.stringify(data).includes(created.key),
    false,
    'the raw key never reaches the event',
  );
});

test('PATCH 400 names the permissions field', async () => {
  const created = await seedKey();
  for (const body of [
    { permissions: [] },
    { permissions: ['nope'] },
    { other: true },
  ]) {
    const res = await patch(created.id, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, 'invalid');
    assert.equal(res.body.details?.field, 'permissions');
  }
  assert.equal((db.__tables.activity_events || []).length, 0);
});

test('PATCH 404 for another user, an unknown id, and a revoked key', async () => {
  const created = await seedKey();
  const foreign = await patch(created.id, { permissions: ['read'] }, COLLEAGUE);
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, 'not_found_or_already_revoked');

  const unknown = await patch('00000000-0000-4000-8000-0000000000ff', {
    permissions: ['read'],
  });
  assert.equal(unknown.status, 404);

  await revokeApiKey(scopeFor(OWNER), created.id, OWNER);
  const revoked = await patch(created.id, { permissions: ['read'] });
  assert.equal(revoked.status, 404);
  assert.equal((db.__tables.activity_events || []).length, 0);
});
