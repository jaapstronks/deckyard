/**
 * Default theme and theme allowlist per organization, with MULTI_ORG_ENABLED
 * (B423; Done when 2 of the dreamkit-slides briefing "multi-org live, drie
 * naden").
 *
 * #1336 (B332) moved `defaultThemeId` / `enabledThemes` from the `app_settings`
 * singleton to `organizations.settings`. The single-organization mechanics are
 * pinned in tests/theme-settings-organization.test.js; this file pins the
 * three things a multi-organization instance adds on top:
 *
 *   - an organization that sets nothing resolves the instance values
 *     (`DEFAULT_THEME`, `ENABLED_THEMES`) while its neighbour keeps its own;
 *   - a member sees only the allowlist of the organization the session is in;
 *   - the write goes through the organization-admin gate (instance admin *and*
 *     admin/owner of the active organization, shared/organization-role.js,
 *     D67), lands on the active organization only, and cannot name another
 *     organization's theme.
 *
 * MULTI_ORG_ENABLED is set before anything is imported; node --test gives each
 * file its own process.
 *
 * Run with: node --test tests/theme-settings-organization-multi-org.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MULTI_ORG_ENABLED = 'true';
process.env.DEFAULT_ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';

const A = process.env.DEFAULT_ORGANIZATION_ID;
const B = '22222222-2222-4222-8222-222222222222';
const BRAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EDITORIAL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AMETHYST = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OWN_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWN_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { getDefaultThemeId, getEnabledThemeIds } =
  await import('../server/storage/settings.js');
const { clearCustomThemeCache } = await import('../server/utils/themes.js');
const { handleThemes } = await import('../server/routes/api/themes.js');
const { handleSettings } = await import('../server/routes/api/settings.js');
const { isMultiOrgEnabled } = await import('../server/config/features.js');

const theme = (id, slug, org = null) => ({
  id,
  slug,
  organization_id: org,
  label: slug,
  colors: {},
  fonts: {},
  config: { version: 1 },
  is_default: false,
});
const scope = (organizationId) => ({ organizationId, repoRoot: process.cwd() });
const user = (id, email, role) => ({
  id,
  organization_id: A,
  email,
  name: id,
  role,
  auth_source: 'database',
  created_at: '2026-01-01T00:00:00.000Z',
  settings: {},
});
const membership = (userId, organizationId, role) => ({
  id: `${userId}-${organizationId}`,
  user_id: userId,
  organization_id: organizationId,
  role,
  is_designer: false,
  joined_at: '2026-01-01T00:00:00.000Z',
});

// alice: instance admin, owner of A, plain member of B.
// bob:   admin of A, not an instance admin.
// carol: instance admin, admin of B.
// dave:  plain member of A.
const alice = { email: 'alice@example.com', isAdmin: true };
const bob = { email: 'bob@example.com', isAdmin: false };
const carol = { email: 'carol@example.com', isAdmin: true };
const dave = { email: 'dave@example.com', isAdmin: false };

const oldEnv = {};
for (const name of ['DEFAULT_THEME', 'ENABLED_THEMES'])
  oldEnv[name] = process.env[name];

let db;
const settingsOf = (id) =>
  db.__tables.organizations.find((row) => row.id === id).settings;

test.beforeEach(async () => {
  process.env.DEFAULT_THEME = 'editorial';
  process.env.ENABLED_THEMES = 'brand,editorial';
  db = createFakeDb({
    organizations: [
      {
        id: A,
        name: 'A',
        slug: 'a',
        settings: { defaultThemeId: OWN_A, enabledThemes: [BRAND, OWN_A] },
      },
      { id: B, name: 'B', slug: 'b', settings: {} },
    ],
    themes: [
      theme(BRAND, 'brand'),
      theme(EDITORIAL, 'editorial'),
      theme(AMETHYST, 'amethyst'),
      theme(OWN_A, 'a-theme', A),
      theme(OWN_B, 'b-theme', B),
    ],
    users: [
      user('alice', alice.email, 'admin'),
      user('bob', bob.email, 'user'),
      user('carol', carol.email, 'admin'),
      user('dave', dave.email, 'user'),
    ],
    user_organizations: [
      membership('alice', A, 'owner'),
      membership('alice', B, 'member'),
      membership('bob', A, 'admin'),
      membership('carol', B, 'admin'),
      membership('dave', A, 'member'),
    ],
  });
  __setTestDb(db);
  clearCustomThemeCache();
  await initializeStorage();
});

test.after(() => {
  clearCustomThemeCache();
  __resetStorageForTests();
  __setTestDb(null);
  for (const [name, value] of Object.entries(oldEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    writeHead(code) {
      this.statusCode = code;
      return this;
    },
    end(value) {
      this.body = value ? JSON.parse(value) : null;
      return this;
    },
  };
}

/** GET /api/themes as `who`, inside `organizationId`. */
async function pickerIds(who, organizationId) {
  const res = fakeRes();
  await handleThemes({
    repoRoot: process.cwd(),
    storageScope: scope(organizationId),
    req: { method: 'GET', headers: { host: 'localhost' } },
    res,
    url: new URL('http://localhost/api/themes'),
    authedUser: { ...who, organizationId },
  });
  assert.equal(res.statusCode, 200);
  return res.body.themes.map((item) => item.id).sort();
}

/** PATCH /api/settings/organization as `who`, inside `organizationId`. */
async function patchOrgSettings(who, organizationId, body) {
  const res = fakeRes();
  const payload = JSON.stringify(body);
  await handleSettings({
    req: {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
      },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(payload);
      },
    },
    res,
    url: new URL('http://localhost/api/settings/organization'),
    storageScope: scope(organizationId),
    authedUser: { ...who, organizationId },
  });
  return res.statusCode;
}

test('multi-organization flag is on for this file', () => {
  assert.equal(isMultiOrgEnabled(), true);
});

test('an organization without its own setting resolves the instance values; its neighbour keeps its own', async () => {
  assert.equal(await getDefaultThemeId(scope(B)), EDITORIAL);
  assert.deepEqual(await getEnabledThemeIds(scope(B)), [BRAND, EDITORIAL]);
  assert.equal(await getDefaultThemeId(scope(A)), OWN_A);
  assert.deepEqual(await getEnabledThemeIds(scope(A)), [BRAND, OWN_A]);
});

test('a member sees only the allowlist of the organization the session is in', async () => {
  assert.deepEqual(await pickerIds(dave, A), [BRAND, OWN_A].sort());
  // alice is in both; what she is offered follows the active organization.
  assert.deepEqual(await pickerIds(alice, A), [BRAND, OWN_A].sort());
  assert.deepEqual(await pickerIds(alice, B), [BRAND, EDITORIAL].sort());
});

test('an organization admin who is an instance admin sets default and allowlist for the active organization only', async () => {
  assert.equal(
    await patchOrgSettings(carol, B, {
      defaultThemeId: OWN_B,
      enabledThemes: [AMETHYST, OWN_B],
    }),
    200,
  );
  assert.equal(await getDefaultThemeId(scope(B)), OWN_B);
  assert.deepEqual(await getEnabledThemeIds(scope(B)), [AMETHYST, OWN_B]);
  assert.deepEqual(await pickerIds(alice, B), [AMETHYST, OWN_B].sort());
  // A is untouched.
  assert.deepEqual(settingsOf(A), {
    defaultThemeId: OWN_A,
    enabledThemes: [BRAND, OWN_A],
  });
  assert.deepEqual(await pickerIds(dave, A), [BRAND, OWN_A].sort());
});

test("another organization's theme cannot be named, not as default and not in the allowlist", async () => {
  assert.equal(
    await patchOrgSettings(carol, B, { defaultThemeId: OWN_A }),
    400,
  );
  assert.equal(
    await patchOrgSettings(carol, B, { enabledThemes: [BRAND, OWN_A] }),
    400,
  );
  assert.deepEqual(settingsOf(B), {});
});

test('clearing the organization setting falls back to the instance values again', async () => {
  assert.equal(
    await patchOrgSettings(alice, A, { defaultThemeId: '', enabledThemes: [] }),
    200,
  );
  assert.equal(await getDefaultThemeId(scope(A)), EDITORIAL);
  assert.deepEqual(await getEnabledThemeIds(scope(A)), [BRAND, EDITORIAL]);
});

test('the write is refused without both halves of the organization-admin gate', async () => {
  const body = { defaultThemeId: BRAND };
  // Instance admin, plain member of the active organization.
  assert.equal(await patchOrgSettings(alice, B, body), 403);
  // Organization admin, not an instance admin (D67: the membership role only
  // narrows the instance role, it never widens it).
  assert.equal(await patchOrgSettings(bob, A, body), 403);
  // Plain member.
  assert.equal(await patchOrgSettings(dave, A, body), 403);
  assert.deepEqual(settingsOf(B), {});
  assert.equal(settingsOf(A).defaultThemeId, OWN_A);
});
