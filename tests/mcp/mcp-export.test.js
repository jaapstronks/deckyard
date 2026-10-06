/** MCP export links and the editable PowerPoint's image-slide report. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { userIdFor, userRows } from '../helpers/identity-fixtures.js';
import { seedRow } from '../helpers/theme-seed.js';
import { healthKeys } from '../helpers/instance-health.js';

process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.APP_URL = 'https://deckyard.example';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const ID = 'd0000008-0000-4000-8000-000000000008';
const { createFakeDb } = await import('../helpers/fake-db.js');
const { __setTestDb } = await import('../../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../../server/storage/lifecycle.js');
const { McpServer } = await import('../../server/mcp/protocol.js');
const { registerTools } = await import('../../server/mcp/tools.js');
const { handleExports } = await import('../../server/routes/api/export.js');

const native = {
  id: 'title',
  type: 'title-slide',
  content: { title: 'Editable title' },
};
const raster = { id: 'diagram', type: 'process-slide', content: {} };
const live = { id: 'invite', type: 'follow-invite-slide', content: {} };

async function setup(slides = [native, live, raster], i18n = {}) {
  __resetStorageForTests();
  const theme = await seedRow('amethyst');
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER, 'other@example.com'),
    themes: [theme],
    presentations: [
      {
        id: ID,
        organization_id: ORG,
        owner_email: OWNER,
        owner_user_id: userIdFor(OWNER),
        created_by_user_id: userIdFor(OWNER),
        updated_by_user_id: userIdFor(OWNER),
        title: 'MCP export',
        theme: theme.id,
        lang: 'nl',
        visibility: 'private',
        revision: 1,
        settings: {},
        slides,
        i18n,
        trashed_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        modified_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  const server = new McpServer();
  registerTools(server);
  const call = (args = {}, context = {}) =>
    server.tools
      .get('export_presentation')
      .handler(
        { presentationId: ID, format: 'pptx-editable', ...args },
        { ownerEmail: OWNER, organizationId: ORG, ...context },
      );
  return { db, call };
}

after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

test('editable link reports image slides after removing live-only slides, without counting a download', async () => {
  const { call, db } = await setup();
  const result = await call();
  assert.equal(
    result.downloadUrl,
    `https://deckyard.example/api/presentations/${ID}/export/pptx-editable`,
  );
  assert.deepEqual(result.imageSlides, [2]);
  assert.deepEqual(await healthKeys(db, 'export'), []);
});

test('image-slide numbering and download URL use the requested language', async () => {
  const { call } = await setup([native], {
    dominant: 'nl',
    active: 'nl',
    versions: {
      nl: { title: 'Dutch', slides: [native] },
      'en-GB': {
        title: 'English',
        slides: [live, raster, native, { ...raster, id: 'diagram-2' }],
      },
    },
  });
  const result = await call({ lang: 'en-GB' });
  assert.equal(new URL(result.downloadUrl).searchParams.get('lang'), 'en-GB');
  assert.deepEqual(result.imageSlides, [1, 3]);
  assert.deepEqual((await call()).imageSlides, []);
});

test('pixel-perfect PPTX keeps its existing route and response shape', async () => {
  const { call } = await setup();
  const result = await call({ format: 'pptx', lang: 'nl' });
  assert.equal(
    result.downloadUrl,
    `https://deckyard.example/api/presentations/${ID}/export/pptx?lang=nl`,
  );
  assert.equal(Object.hasOwn(result, 'imageSlides'), false);
});

test('editable export keeps access refusals and unsupported-format errors', async () => {
  const { call } = await setup();
  await assert.rejects(call({}, { ownerEmail: 'other@example.com' }), {
    statusCode: 403,
  });
  await assert.rejects(
    call({ presentationId: 'd0000009-0000-4000-8000-000000000009' }),
    { statusCode: 404 },
  );
  await assert.rejects(call({ format: 'unknown' }), /Unsupported format/);
});

test('missing public origin returns the configuration note', async () => {
  const { call } = await setup();
  const appUrl = process.env.APP_URL;
  const domain = process.env.DOMAIN;
  delete process.env.APP_URL;
  delete process.env.DOMAIN;
  try {
    const result = await call();
    assert.match(result.note, /cannot generate a download URL/);
    assert.equal(Object.hasOwn(result, 'downloadUrl'), false);
    assert.equal(Object.hasOwn(result, 'imageSlides'), false);
  } finally {
    process.env.APP_URL = appUrl;
    if (domain !== undefined) process.env.DOMAIN = domain;
  }
});

test('following the editable link produces a PPTX with editable text', async () => {
  const { call } = await setup([native, live]);
  const result = await call();
  assert.deepEqual(result.imageSlides, []);
  const res = {
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
  const url = new URL(result.downloadUrl);
  url.searchParams.set('sync', '1');
  await handleExports({
    req: { method: 'GET' },
    res,
    url,
    repoRoot: process.cwd(),
    storageScope: { repoRoot: process.cwd(), organizationId: ORG },
    authedUser: { id: userIdFor(OWNER), email: OWNER, organizationId: ORG },
  });
  assert.equal(res.status, 200, String(res.body));
  assert.match(res.headers['Content-Disposition'], /-editable\.pptx/);
  const zip = await JSZip.loadAsync(res.body);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(xml, /<a:t>Editable title<\/a:t>/);
  assert.equal(zip.file('ppt/slides/slide2.xml'), null);
});
