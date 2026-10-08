/**
 * B620: a loaded deck written back whole keeps the active language version.
 *
 * The write seam (`normalizeI18n`) takes top-level `title`/`slides` as the
 * buffer of `i18n.active`; a loaded deck carries the dominant version there.
 * A theme switch without a save body (the editor's `/change-theme`) and a
 * publish wrote the loaded deck back whole, so on a deck whose active
 * language is not the dominant one the dominant text landed in
 * `versions[active]`. Now the theme switch writes the stored slides as the
 * dominant buffer through `server/services/deck-versions.js`, the helper
 * `persistSlides` and the translate writers share, and a publish writes only
 * the publication column, as an unpublish does (B575).
 *
 * The store: OWNER's Dutch deck with a German version, edited last in German
 * (`active = de`). Assertions read the stored row, in the shape of B610's
 * "keeps that version" test.
 *
 * Run with: node --test tests/service-layer-b620.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { seedRow } from './helpers/theme-seed.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b620']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER_EMAIL = 'owner@example.com';
const DECK_ID = 'd0000620-0000-4000-8000-000000000001';
const REPO_ROOT = process.cwd();

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { changeTheme } = await import('../server/services/theme.js');
const { publishPresentation } =
  await import('../server/services/publish-presentation.js');
const { loadPresentationForActor } =
  await import('../server/services/presentations.js');

const OWNER = {
  id: userIdFor(OWNER_EMAIL),
  email: OWNER_EMAIL,
  name: 'owner',
  role: 'user',
  organizationId: ORG,
};
const scope = () => testScope(REPO_ROOT, { actorEmail: OWNER_EMAIL });

const slide = (id, title, type) => ({ id, type, content: { title } });
const NL = {
  title: 'Roadmap',
  slides: [
    slide('slide-1', 'Hoi', 'title-slide'),
    slide('slide-2', 'Twee', 'content-slide'),
  ],
};
const DE = {
  title: 'Fahrplan',
  slides: [
    slide('slide-1', 'Hallo', 'title-slide'),
    slide('slide-2', 'Zwei', 'content-slide'),
  ],
};

async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER_EMAIL),
    presentations: [
      {
        id: DECK_ID,
        organization_id: ORG,
        owner_email: OWNER_EMAIL,
        created_by: OWNER_EMAIL,
        updated_by: OWNER_EMAIL,
        owner_user_id: userIdFor(OWNER_EMAIL),
        created_by_user_id: userIdFor(OWNER_EMAIL),
        updated_by_user_id: userIdFor(OWNER_EMAIL),
        title: NL.title,
        description: null,
        theme: 'default',
        lang: 'nl',
        visibility: 'private',
        is_view_only: false,
        revision: 1,
        settings: {},
        i18n: {
          dominant: 'nl',
          active: 'de',
          versions: { nl: structuredClone(NL), de: structuredClone(DE) },
        },
        slides: structuredClone(NL.slides),
        published: null,
        created_at: '2026-07-01T00:00:00.000Z',
        modified_at: '2026-07-01T00:00:00.000Z',
        trashed_at: null,
      },
    ],
    themes: [await seedRow('amethyst')],
    published_presentations: [],
    activity_events: [],
  });
  __setTestDb(db);
  await initializeStorage(REPO_ROOT);
  return db;
}

const storedDeck = (db) =>
  db.__tables.presentations.find((row) => row.id === DECK_ID);
const titles = (version) => version.slides.map((s) => s.content.title);

/** Both versions and the top level as the store had them before the write. */
function assertVersionsKept(row) {
  assert.equal(row.i18n.versions.de.title, 'Fahrplan');
  assert.deepEqual(titles(row.i18n.versions.de), ['Hallo', 'Zwei']);
  assert.equal(row.i18n.versions.nl.title, 'Roadmap');
  assert.deepEqual(titles(row.i18n.versions.nl), ['Hoi', 'Twee']);
  assert.equal(row.i18n.active, 'de');
  assert.equal(row.i18n.dominant, 'nl');
  assert.equal(row.title, 'Roadmap');
  assert.deepEqual(titles({ slides: row.slides }), ['Hoi', 'Twee']);
}

test('a theme switch without a save body keeps the active version (the editor /change-theme route)', async () => {
  const db = await installDb();
  const other = (await seedRow('amethyst')).id;

  await changeTheme(
    scope(),
    { actor: OWNER },
    { presentationId: DECK_ID, theme: other },
  );

  const row = storedDeck(db);
  assert.equal(row.theme, other);
  // The loaded deck went back whole with `active = de` and its Dutch top
  // level; the seam stored that text as the German version.
  assertVersionsKept(row);
});

test('a publish keeps the active version and writes only the publication column', async () => {
  const db = await installDb();
  const pres = await loadPresentationForActor(
    scope(),
    { actor: OWNER },
    DECK_ID,
    {
      access: 'write',
    },
  );

  const result = await publishPresentation({
    repoRoot: REPO_ROOT,
    storageScope: scope(),
    req: { headers: {} },
    pres,
    actor: OWNER,
  });

  const row = storedDeck(db);
  assert.equal(row.published?.id, result.publishId);
  assertVersionsKept(row);
});
