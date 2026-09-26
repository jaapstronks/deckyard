/**
 * B486: every create path checks the theme the way v1 does.
 *
 * v1-create/PUT and `/change-theme` looked the theme up through `findTheme()`
 * (one spelling, unknown = 400), but the editor-create, the MCP create tools
 * and the import/convert paths handed their theme to `createPresentation`
 * unchecked, and the factory trimmed it without a word. The factory now runs
 * `settleNewDeckTheme()` on every create: absent is the installation default
 * (`default`, D232), anything else must be a theme this instance has in its
 * one spelling, or the create is refused with 400 `invalid`, `details.field` =
 * `theme`, and nothing is written.
 *
 * Run with: node --test tests/create-theme-check.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testScope } from './helpers/storage-scope.js';
import {
  sessionFor,
  userIdFor,
  userRows,
} from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b486']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { listPresentations } =
  await import('../server/storage/presentations/index.js');
const { handlePresentations } =
  await import('../server/routes/api/presentations/index.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      users: userRows(OWNER),
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/** POST `body` to an app route under /api/presentations. */
function appPost(pathname, body) {
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  const res = {
    statusCode: null,
    body: null,
    setHeader() {},
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
  return handlePresentations({
    repoRoot: process.cwd(),
    storageScope: testScope(process.cwd()),
    req: {
      method: 'POST',
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield buf;
      },
    },
    res,
    url: new URL(`http://test.local${pathname}`),
    authedUser: sessionFor(OWNER, { isAdmin: false }),
  }).then(() => res);
}

/** Call `create_presentation_from_slides` the way an agent does. */
function mcpCreate(args) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const tool = server.tools.get('create_presentation_from_slides');
  return tool.handler(
    {
      title: 'Van een agent',
      slides: [{ type: 'title-slide', content: { title: 'Hoi' } }],
      ...args,
    },
    { ownerEmail: OWNER, organizationId: ORG, userId: userIdFor(OWNER) },
  );
}

async function deckCount() {
  return (await listPresentations(testScope(process.cwd()))).length;
}

/** A theme this instance does not have, and two other spellings of one it does. */
const REFUSED = ['no-such-theme', 'Midnight', ' midnight', 'midnight ', ''];

for (const theme of REFUSED) {
  test(`app create refuses theme ${JSON.stringify(theme)} and writes nothing`, async () => {
    const before = await deckCount();
    const res = await appPost('/api/presentations', { title: 'Dek', theme });

    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, 'invalid');
    assert.deepEqual(res.body.details, { field: 'theme' });
    assert.equal(await deckCount(), before);
  });
}

test('app create stores a known theme as named', async () => {
  const res = await appPost('/api/presentations', {
    title: 'Dek',
    theme: 'midnight',
  });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.theme, 'midnight');
});

test('app create without a theme, or with `default`, stores `default` (D232)', async () => {
  for (const body of [
    { title: 'Zonder' },
    { title: 'Null', theme: null },
    { title: 'Default', theme: 'default' },
  ]) {
    const res = await appPost('/api/presentations', body);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(res.body.theme, 'default', JSON.stringify(body));
  }
});

test('MCP create refuses an unknown or respelled theme and writes nothing', async () => {
  const before = await deckCount();
  for (const theme of ['no-such-theme', 'Midnight']) {
    await assert.rejects(
      () => mcpCreate({ theme }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.deepEqual(err.details, { field: 'theme' });
        return true;
      },
    );
  }
  assert.equal(await deckCount(), before);
});

test('MCP create stores a known theme, and `default` when none is named', async () => {
  const named = await mcpCreate({ theme: 'amethyst' });
  const unnamed = await mcpCreate({});
  const byId = new Map(
    (await listPresentations(testScope(process.cwd()))).map((p) => [p.id, p]),
  );
  assert.equal(byId.get(named.id).theme, 'amethyst');
  assert.equal(byId.get(unnamed.id).theme, 'default');
});

test('a JSON import naming a theme this instance lacks is refused, not defaulted', async () => {
  const before = await deckCount();
  const res = await appPost('/api/presentations/import/json', {
    deck: {
      title: 'Van elders',
      theme: 'ciiic',
      lang: 'nl',
      slides: [{ type: 'title-slide', content: { title: 'Hoi' } }],
    },
  });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.deepEqual(res.body.details, { field: 'theme' });
  assert.equal(await deckCount(), before);
});

test('a markdown import checks the request theme, then the front matter', async () => {
  const before = await deckCount();
  const refused = await appPost('/api/presentations/import/markdown', {
    markdown: '---\ntheme: no-such-theme\n---\n\n# Hoi\n',
    lang: 'nl',
  });
  assert.equal(refused.statusCode, 400, JSON.stringify(refused.body));
  assert.deepEqual(refused.body.details, { field: 'theme' });
  assert.equal(await deckCount(), before);

  const named = await appPost('/api/presentations/import/markdown', {
    markdown: '---\ntheme: no-such-theme\n---\n\n# Hoi\n',
    lang: 'nl',
    theme: 'midnight',
  });
  assert.equal(named.statusCode, 201, JSON.stringify(named.body));
  assert.equal(named.body.theme, 'midnight');
});
