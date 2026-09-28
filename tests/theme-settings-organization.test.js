import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fake-db.js';
import { __setTestDb } from '../server/db/client.js';
import {
  initializeStorage,
  __resetStorageForTests,
} from '../server/storage/lifecycle.js';
import {
  getDefaultThemeId,
  getEnabledThemeIds,
} from '../server/storage/settings.js';
import {
  settleNewDeckTheme,
  loadThemeAssets,
  clearCustomThemeCache,
} from '../server/utils/themes.js';
import { handleThemes } from '../server/routes/api/themes.js';
import { handleResources } from '../server/routes/public-api/v1/resources.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const BRAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EDITORIAL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWN_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWN_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
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
let db;
const oldEnv = {};
for (const name of [
  'DEFAULT_THEME',
  'ENABLED_THEMES',
  'SANDBOX_MODE',
  'SANDBOX_DEFAULT_THEME',
])
  oldEnv[name] = process.env[name];

test.before(async () => {
  db = createFakeDb({
    organizations: [
      {
        id: A,
        name: 'A',
        slug: 'a',
        settings: { defaultThemeId: OWN_A, enabledThemes: [BRAND, OWN_A] },
      },
      {
        id: B,
        name: 'B',
        slug: 'b',
        settings: { defaultThemeId: OWN_B, enabledThemes: [EDITORIAL, OWN_B] },
      },
    ],
    themes: [
      theme(BRAND, 'brand'),
      theme(EDITORIAL, 'editorial'),
      theme(OWN_A, 'a-theme', A),
      theme(OWN_B, 'b-theme', B),
    ],
  });
  __setTestDb(db);
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

test('organizations retain independent defaults across edits; explicit decks retain their UUID', async () => {
  assert.equal(await getDefaultThemeId(scope(A)), OWN_A);
  assert.equal(await getDefaultThemeId(scope(B)), OWN_B);
  assert.equal(
    (await loadThemeAssets(process.cwd(), 'default', scope(A))).id,
    OWN_A,
  );
  assert.equal(
    (await loadThemeAssets(process.cwd(), OWN_A, scope(A))).id,
    OWN_A,
  );
  db.__tables.organizations.find(
    (row) => row.id === B,
  ).settings.defaultThemeId = EDITORIAL;
  assert.equal(await getDefaultThemeId(scope(A)), OWN_A);
  assert.equal(await getDefaultThemeId(scope(B)), EDITORIAL);
  assert.equal(
    (await loadThemeAssets(process.cwd(), OWN_B, scope(B))).id,
    OWN_B,
  );
});

test('sandbox seed handle becomes a UUID before create and renders under the same scope', async () => {
  process.env.SANDBOX_MODE = '1';
  process.env.SANDBOX_DEFAULT_THEME = 'editorial';
  const created = await settleNewDeckTheme(process.cwd(), undefined, scope(A));
  assert.equal(created.themeId, EDITORIAL);
  assert.equal(created.theme.id, EDITORIAL);
  assert.equal(
    (await loadThemeAssets(process.cwd(), created.themeId, scope(A))).id,
    EDITORIAL,
  );
  process.env.SANDBOX_DEFAULT_THEME = 'brand';
  assert.equal(
    (await settleNewDeckTheme(process.cwd(), undefined, scope(A))).themeId,
    BRAND,
  );
  delete process.env.SANDBOX_MODE;
});

test('env allowlist resolves multiple seed handles and the GET picker uses UUIDs', async () => {
  db.__tables.organizations.find((row) => row.id === A).settings.enabledThemes =
    [];
  process.env.ENABLED_THEMES = 'brand,editorial';
  assert.deepEqual(await getEnabledThemeIds(scope(A)), [BRAND, EDITORIAL]);
  const res = {
    statusCode: null,
    body: null,
    writeHead(code) {
      this.statusCode = code;
      return this;
    },
    end(value) {
      this.body = JSON.parse(value);
      return this;
    },
  };
  await handleThemes({
    repoRoot: process.cwd(),
    storageScope: scope(A),
    req: { method: 'GET', headers: { host: 'localhost' } },
    res,
    url: new URL('http://localhost/api/themes'),
    authedUser: { organizationId: A, email: 'member@example.com' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.enabledThemes, [BRAND, EDITORIAL]);
  assert.deepEqual(
    res.body.themes.map((item) => item.id).sort(),
    [BRAND, EDITORIAL, OWN_A].sort(),
  );
});

test('settings API writes only the active organization and refuses invisible IDs', async () => {
  const { handleSettings } = await import('../server/routes/api/settings.js');
  const request = async (organizationId, body, endpoint = 'organization') => {
    const res = {
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
    const payload = JSON.stringify(body);
    const req = {
      method: endpoint === 'app' ? 'PUT' : 'PATCH',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
      },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(payload);
      },
    };
    await handleSettings({
      req,
      res,
      url: new URL(`http://localhost/api/settings/${endpoint}`),
      storageScope: scope(organizationId),
      authedUser: { organizationId, email: 'admin@example.com', isAdmin: true },
    });
    return res;
  };
  const previous = db.__tables.organizations.find((row) => row.id === B)
    .settings.defaultThemeId;
  assert.equal(
    (
      await request(A, {
        defaultThemeId: EDITORIAL,
        enabledThemes: [BRAND, EDITORIAL],
      })
    ).statusCode,
    200,
  );
  assert.equal(await getDefaultThemeId(scope(A)), EDITORIAL);
  assert.equal(await getDefaultThemeId(scope(B)), previous);
  assert.equal((await request(A, { defaultThemeId: OWN_B })).statusCode, 400);
  assert.equal((await request(A, { enabledThemes: [OWN_B] })).statusCode, 400);
  assert.equal(
    (await request(A, { defaultThemeId: 'editorial' })).statusCode,
    400,
  );
  assert.equal(
    (await request(A, { defaultThemeId: EDITORIAL.toUpperCase() })).statusCode,
    400,
  );
  assert.equal(
    (await request(A, { enabledThemes: [BRAND.toUpperCase()] })).statusCode,
    400,
  );
  assert.equal(
    (await request(A, { defaultThemeId: BRAND }, 'app')).statusCode,
    400,
  );
  assert.equal(await getDefaultThemeId(scope(A)), EDITORIAL);
});

test('internal and v1 theme routes use each organization default despite stale record flags', async () => {
  const request = async (organizationId, path) => {
    const res = {
      statusCode: null,
      body: null,
      writeHead(code) {
        this.statusCode = code;
      },
      end(value) {
        this.body = value ? JSON.parse(value) : null;
      },
    };
    const ctx = {
      repoRoot: process.cwd(),
      storageScope: scope(organizationId),
      req: { method: 'GET', headers: { host: 'localhost' } },
      res,
      url: new URL(`http://localhost${path}`),
      authedUser: { organizationId, email: 'member@example.com' },
      apiKey: {
        id: `key-${organizationId}`,
        tier: 'free',
        permissions: ['read'],
      },
    };
    assert.equal(
      await (path.startsWith('/api/v1/')
        ? handleResources(ctx)
        : handleThemes(ctx)),
      true,
    );
    assert.equal(res.statusCode, 200);
    return res.body;
  };
  const defaults = (themes) =>
    themes.filter((theme) => theme.isDefault).map((theme) => theme.id);
  const assertRoutes = async (organizationId, expected) => {
    const internal = await request(organizationId, '/api/themes');
    const publicList = await request(organizationId, '/api/v1/themes');
    assert.equal(internal.defaultThemeId, expected);
    assert.deepEqual(defaults(internal.themes), [expected]);
    assert.deepEqual(defaults(publicList.themes), [expected]);
    for (const theme of publicList.themes) {
      const record = await request(organizationId, `/api/themes/${theme.id}`);
      assert.equal(record.isDefault, theme.id === expected);
    }
  };

  db.__tables.themes.find((row) => row.id === BRAND).is_default = true;
  db.__tables.themes.find((row) => row.id === OWN_B).is_default = true;
  db.__tables.organizations.find((row) => row.id === A).settings = {
    defaultThemeId: OWN_A,
    enabledThemes: [],
  };
  db.__tables.organizations.find((row) => row.id === B).settings = {
    defaultThemeId: OWN_B,
    enabledThemes: [],
  };
  await assertRoutes(A, OWN_A);
  await assertRoutes(B, OWN_B);

  db.__tables.organizations.find(
    (row) => row.id === A,
  ).settings.defaultThemeId = EDITORIAL;
  db.__tables.themes.find((row) => row.id === OWN_A).is_default = true;
  await assertRoutes(A, EDITORIAL);
  await assertRoutes(B, OWN_B);

  db.__tables.organizations.find(
    (row) => row.id === B,
  ).settings.defaultThemeId = BRAND;
  db.__tables.themes.find((row) => row.id === BRAND).is_default = false;
  await assertRoutes(A, EDITORIAL);
  await assertRoutes(B, BRAND);
});
