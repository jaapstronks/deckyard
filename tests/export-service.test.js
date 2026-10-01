/**
 * The one export context (A7.4, B520): `services/exports.js` loads the deck
 * with the read right, counts the export once on the instance-health `export`
 * axis (D247), and projects, strips and themes it the same way for the
 * internal routes, the public v1 routes and the queued worker.
 *
 * Service-level over the database double; the counts land fire-and-forget,
 * so every count assertion reads through `healthKeys`, which waits for them.
 *
 * Run with: node --test tests/export-service.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testScope } from './helpers/storage-scope.js';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';
import { healthKeys } from './helpers/instance-health.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const STRANGER = 'stranger@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createPresentation } =
  await import('../server/storage/presentations/index.js');
const { prepareExportContext, prepareQueuedExportContext } =
  await import('../server/services/exports.js');
const { ForbiddenError, NotFoundError } =
  await import('../server/utils/errors.js');

let brandSeed;
let db;

test.before(async () => {
  brandSeed = await brandSeedRow();
});

test.beforeEach(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    themes: [brandSeed],
    users: userRows(OWNER, STRANGER),
  });
  __setTestDb(db);
  await initializeStorage();
});

test.afterEach(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

const actorFor = (email) => ({
  actor: { id: userIdFor(email), email, organizationId: ORG },
});
const scope = () => testScope(process.cwd(), { actorEmail: OWNER });

async function seedDeck() {
  const pres = await createPresentation(scope(), {
    title: 'Export deck',
    ownerEmail: OWNER,
    theme: 'default',
    slides: [
      { type: 'title-slide', content: { title: 'A' } },
      { type: 'follow-invite-slide', content: {} },
    ],
  });
  await healthKeys(db);
  db.__tables.instance_health = [];
  return pres;
}

test('an export someone may read is counted once and stripped of live-only slides', async () => {
  const pres = await seedDeck();
  const ctx = await prepareExportContext(scope(), actorFor(OWNER), {
    presentationId: pres.id,
    format: 'pdf',
    lang: 'nl',
  });

  assert.deepEqual(await healthKeys(db), ['export:pdf']);
  assert.equal(ctx.exportLang, 'nl');
  assert.equal(ctx.langSuffix, '-NL');
  assert.equal(ctx.title, 'Export deck');
  assert.deepEqual(
    ctx.pres.slides.map((s) => s.type),
    ['title-slide', 'follow-invite-slide'],
  );
  assert.deepEqual(
    ctx.filteredPres.slides.map((s) => s.type),
    ['title-slide'],
  );
  assert.ok(ctx.theme, 'the deck theme resolves');
  assert.ok(ctx.slideTypes['title-slide'], 'core slide types are there');
});

test('a format with every language skips the projection; stripping is the caller’s choice', async () => {
  const pres = await seedDeck();
  const ctx = await prepareExportContext(scope(), actorFor(OWNER), {
    presentationId: pres.id,
    format: 'json',
    lang: 'nl',
    allLanguages: true,
    stripLiveOnly: false,
  });
  assert.equal(ctx.exportLang, null);
  assert.equal(ctx.langSuffix, '');
  assert.equal(ctx.filteredPres, ctx.pres);
});

test('a refused export throws and counts nothing (D255)', async () => {
  const pres = await seedDeck();
  await assert.rejects(
    prepareExportContext(scope(), actorFor(STRANGER), {
      presentationId: pres.id,
      format: 'html',
    }),
    ForbiddenError,
  );
  await assert.rejects(
    prepareExportContext(scope(), actorFor(OWNER), {
      presentationId: '00000000-0000-4000-8000-000000000404',
      format: 'html',
    }),
    NotFoundError,
  );
  assert.deepEqual(await healthKeys(db), []);
});

test('the queued worker builds the same context and counts nothing', async () => {
  const pres = await seedDeck();
  const asked = await prepareExportContext(scope(), actorFor(OWNER), {
    presentationId: pres.id,
    format: 'pptx',
    lang: 'nl',
  });
  db.__tables.instance_health = [];

  const queued = await prepareQueuedExportContext(scope(), {
    presentationId: pres.id,
    lang: asked.exportLang,
  });
  assert.deepEqual(await healthKeys(db), []);
  assert.deepEqual(queued.pres, asked.pres);
  assert.deepEqual(queued.filteredPres, asked.filteredPres);
  assert.equal(queued.langSuffix, asked.langSuffix);
  assert.equal(queued.theme?.id, asked.theme?.id);

  await assert.rejects(
    prepareQueuedExportContext(scope(), {
      presentationId: '00000000-0000-4000-8000-000000000404',
    }),
    NotFoundError,
  );
});
