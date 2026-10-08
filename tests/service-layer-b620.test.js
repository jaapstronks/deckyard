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
 * B623: a theme switch that converts a slide converts it in every language
 * version, on both paths (with and without a save body), and a conversion
 * that fails in any version refuses the switch, as B612 does.
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
const { changeTheme, applyThemeChange } =
  await import('../server/services/theme.js');
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

const types = (version) => version.slides.map((s) => s.type);

/** Every version and the top level carry `type` for slide-1, each its own text. */
function assertConvertedEverywhere(row, type) {
  assert.deepEqual(types(row.i18n.versions.nl), [type, 'content-slide']);
  assert.deepEqual(types(row.i18n.versions.de), [type, 'content-slide']);
  assert.deepEqual(types({ slides: row.slides }), [type, 'content-slide']);
  assert.equal(row.i18n.versions.nl.slides[0].content.title, 'Hoi');
  assert.equal(row.i18n.versions.de.slides[0].content.title, 'Hallo');
  assert.equal(row.slides[0].content.title, 'Hoi');
  assert.equal(row.i18n.active, 'de');
  assert.equal(row.i18n.dominant, 'nl');
}

test('a theme switch without a save body converts a slide in every language version (B623)', async () => {
  const db = await installDb();
  const other = (await seedRow('amethyst')).id;

  await changeTheme(
    scope(),
    { actor: OWNER },
    {
      presentationId: DECK_ID,
      theme: other,
      convertSlides: [{ slideId: 'slide-1', convertTo: 'chapter-title-slide' }],
    },
  );

  const row = storedDeck(db);
  assert.equal(row.theme, other);
  // Only the dominant buffer was converted; the German version on screen
  // kept `title-slide` for the same slide id.
  assertConvertedEverywhere(row, 'chapter-title-slide');
});

test('a theme switch with a save body converts a slide in every language version (B623)', async () => {
  const db = await installDb();
  const other = (await seedRow('amethyst')).id;
  const pres = await loadPresentationForActor(
    scope(),
    { actor: OWNER },
    DECK_ID,
    { access: 'write' },
  );

  // The editor's shape: the version on screen (German) at the top level.
  await applyThemeChange(scope(), { actor: OWNER }, pres, {
    theme: other,
    changes: {
      title: DE.title,
      slides: structuredClone(DE.slides),
      i18n: {
        dominant: 'nl',
        active: 'de',
        versions: { nl: structuredClone(NL), de: structuredClone(DE) },
      },
    },
    convertSlides: [{ slideId: 'slide-1', convertTo: 'chapter-title-slide' }],
  });

  const row = storedDeck(db);
  assert.equal(row.theme, other);
  assertConvertedEverywhere(row, 'chapter-title-slide');
});

test('a conversion that fails in a version other than the dominant one refuses the switch (B623)', async () => {
  const db = await installDb();
  const other = (await seedRow('amethyst')).id;
  // A slide only the German version carries: the dominant buffer never sees
  // it, so the switch used to skip the conversion and report success.
  storedDeck(db).i18n.versions.de.slides.push(
    slide('slide-de', 'Nur hier', 'content-slide'),
  );
  const before = structuredClone(storedDeck(db));

  await assert.rejects(
    changeTheme(
      scope(),
      { actor: OWNER },
      {
        presentationId: DECK_ID,
        theme: other,
        convertSlides: [
          { slideId: 'slide-1', convertTo: 'chapter-title-slide' },
          { slideId: 'slide-de', convertTo: 'no-such-type' },
        ],
      },
    ),
    (err) => {
      assert.equal(err.status ?? err.statusCode, 400);
      assert.equal(err.details.field, 'convertSlides');
      assert.equal(err.details.index, 1, 'the entry that failed');
      assert.match(err.message, /slide-de/);
      return true;
    },
  );
  assert.deepEqual(storedDeck(db), before, 'nothing was written');
});
