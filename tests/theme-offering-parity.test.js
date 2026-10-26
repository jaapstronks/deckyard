/** Offered theme policy through the real browser, v1 and MCP adapters (B845). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';

process.env.MULTI_ORG_ENABLED = 'true';
process.env.DEFAULT_ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const A = process.env.DEFAULT_ORGANIZATION_ID;
const B = '22222222-2222-4222-8222-222222222222';
const BRAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EDITORIAL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WITHDRAWN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OWN_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWN_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { handleThemes } = await import('../server/routes/api/themes.js');
const { handleResources } =
  await import('../server/routes/public-api/v1/resources.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const { listThemes } = await import('../server/storage/themes.js');
const server = new McpServer();
registerTools(server);
let db;
const scope = (organizationId) => ({ organizationId, repoRoot: process.cwd() });
const theme = (id, slug, organization_id = null) => ({
  id,
  slug,
  organization_id,
  label: slug,
  colors: {},
  fonts: {},
  config: {},
});

test.beforeEach(async () => {
  delete process.env.SANDBOX_MODE;
  delete process.env.ENABLED_THEMES;
  process.env.DEFAULT_THEME = 'brand';
  db = createFakeDb({
    organizations: [
      {
        id: A,
        name: 'A',
        slug: 'a',
        settings: { defaultThemeId: OWN_A, enabledThemes: [EDITORIAL] },
      },
      {
        id: B,
        name: 'B',
        slug: 'b',
        settings: { defaultThemeId: BRAND, enabledThemes: [OWN_B] },
      },
    ],
    themes: [
      theme(BRAND, 'brand'),
      theme(EDITORIAL, 'editorial'),
      theme(WITHDRAWN, 'withdrawn'),
      theme(OWN_A, 'a-theme', A),
      theme(OWN_B, 'b-theme', B),
    ],
  });
  __setTestDb(db);
  await initializeStorage();
});
test.after(() => __setTestDb(null));

async function catalog(
  surface,
  org,
  { query = '', designer = false, args = {} } = {},
) {
  if (surface === 'mcp') {
    return (
      await server.tools.get('list_themes').handler(args, {
        organizationId: org,
        ownerEmail: 'reader@example.test',
      })
    ).themes;
  }
  const res = createMockRes();
  const path = surface === 'browser' ? '/api/themes' : '/api/v1/themes';
  const ctx = {
    req: createMockReq(),
    res,
    url: new URL(`http://localhost${path}${query}`),
    repoRoot: process.cwd(),
    storageScope: scope(org),
    authedUser: {
      email: 'reader@example.test',
      organizationId: org,
      isDesigner: designer,
    },
    apiKey: { permissions: ['read'], organizationId: org, tier: 'free' },
  };
  assert.equal(
    await (surface === 'browser' ? handleThemes(ctx) : handleResources(ctx)),
    true,
  );
  assert.equal(res.statusCode, 200);
  const body = res.json();
  if (surface === 'v1') assert.equal(body.count, body.themes.length);
  return body.themes;
}
const ids = (themes) => themes.map((theme) => theme.id).sort();
const settings = (org) =>
  db.__tables.organizations.find((row) => row.id === org).settings;

for (const surface of ['browser', 'v1', 'mcp']) {
  test(`${surface}: configured offer and default follow the active organization`, async () => {
    assert.deepEqual(ids(await catalog(surface, A)), [EDITORIAL, OWN_A].sort());
    assert.deepEqual(ids(await catalog(surface, B)), [BRAND, OWN_B].sort());
    assert.deepEqual(
      ids(await catalog(surface, A)),
      [EDITORIAL, OWN_A].sort(),
      'switching back does not reuse B policy',
    );
  });
  test(`${surface}: empty stored list inherits env, nonempty stored list wins`, async () => {
    settings(B).enabledThemes = [];
    process.env.ENABLED_THEMES = 'editorial,unknown,editorial';
    assert.deepEqual(ids(await catalog(surface, B)), [BRAND, EDITORIAL].sort());
    assert.deepEqual(ids(await catalog(surface, A)), [EDITORIAL, OWN_A].sort());
  });
  test(`${surface}: empty effective list offers all scoped themes`, async () => {
    settings(A).enabledThemes = [];
    assert.deepEqual(
      ids(await catalog(surface, A)),
      [BRAND, EDITORIAL, WITHDRAWN, OWN_A].sort(),
    );
    settings(B).enabledThemes = [];
    assert.deepEqual(
      ids(await catalog(surface, B)),
      [BRAND, EDITORIAL, WITHDRAWN, OWN_B].sort(),
    );
  });
  test(`${surface}: sandbox offers only seed records, including for browser exceptions`, async () => {
    process.env.SANDBOX_MODE = 'true';
    settings(A).enabledThemes = [];
    assert.deepEqual(
      ids(
        await catalog(surface, A, {
          query: `?all=1&current=${OWN_A}`,
          designer: true,
        }),
      ),
      [BRAND, EDITORIAL, WITHDRAWN].sort(),
    );
    settings(A).enabledThemes = [EDITORIAL];
    assert.deepEqual(ids(await catalog(surface, A)), [EDITORIAL]);
  });
}

test('only browser keeps current or offers the manager catalog; raw storage stays complete', async () => {
  assert.deepEqual(
    ids(
      await catalog('browser', A, {
        query: `?current=%20${WITHDRAWN.toUpperCase()}%20`,
      }),
    ),
    [EDITORIAL, OWN_A, WITHDRAWN].sort(),
  );
  assert.deepEqual(
    ids(await catalog('browser', A, { query: `?current=${OWN_B}` })),
    [EDITORIAL, OWN_A].sort(),
    'current never adds a foreign record',
  );
  assert.deepEqual(
    ids(await catalog('browser', A, { query: '?all=1' })),
    [EDITORIAL, OWN_A].sort(),
  );
  assert.deepEqual(
    ids(await catalog('browser', A, { query: '?all=1', designer: true })),
    [BRAND, EDITORIAL, WITHDRAWN, OWN_A].sort(),
  );
  assert.deepEqual(
    ids(
      await catalog('v1', A, {
        query: `?all=1&current=${WITHDRAWN}`,
        designer: true,
      }),
    ),
    [EDITORIAL, OWN_A].sort(),
  );
  assert.deepEqual(
    ids(await catalog('mcp', A, { args: { all: true, current: WITHDRAWN } })),
    [EDITORIAL, OWN_A].sort(),
  );
  assert.deepEqual(
    ids(await listThemes(scope(A))),
    [BRAND, EDITORIAL, WITHDRAWN, OWN_A].sort(),
  );
});

test('browser and v1 mark the offered organization default', async () => {
  for (const surface of ['browser', 'v1']) {
    assert.deepEqual(
      (await catalog(surface, A))
        .filter((theme) => theme.isDefault)
        .map((theme) => theme.id),
      [OWN_A],
    );
  }
});

test('all three catalog adapters use the domain offer, never a raw storage list', async () => {
  for (const path of [
    'server/routes/api/themes.js',
    'server/routes/public-api/v1/resources.js',
    'server/mcp/tools.js',
  ]) {
    const source = await readFile(
      new URL(`../${path}`, import.meta.url),
      'utf8',
    );
    assert.match(
      source,
      /import\s*\{[^}]*\blistOfferedThemes\b[^}]*\}\s*from\s*['"][^'"]*services\/theme\.js['"]/,
    );
    assert.doesNotMatch(source, /\blistThemes\s*\(/);
  }
});
