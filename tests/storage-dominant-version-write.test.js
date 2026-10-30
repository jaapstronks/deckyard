/**
 * A write without `i18n` lands in the dominant language version (B740).
 *
 * The top level of a deck is a projection of `i18n.versions[dominant]`. A PUT
 * from a script or agent that sends `{ slides }` without `i18n`, and the notes
 * companion's `updateSlideNotes`, used to store the new top-level slides beside
 * the old dominant version. The editor and the collab bootstrap read the
 * versions, so they showed the old deck and wrote it back: slides added over
 * the API vanished. Now the storage facade writes such a body into the
 * dominant version and leaves `active` and every other version alone.
 *
 * The store: OWNER's Dutch deck with a German version, edited last in German
 * (`active = de`), shaped like the active-language preservation test (B620).
 *
 * Run with: node --test tests/storage-dominant-version-write.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b740']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER_EMAIL = 'owner@example.com';
const DECK_ID = 'd0000740-0000-4000-8000-000000000001';
const REPO_ROOT = process.cwd();

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { getPresentation, updatePresentation, updateSlideNotes } =
  await import('../server/storage/presentations/index.js');
const { deckYdocCodec } = await import('../server/collab/deck-doc.js');

const scope = () => testScope(REPO_ROOT, { actorEmail: OWNER_EMAIL });

const slide = (id, title, type = 'content-slide') => ({
  id,
  type,
  content: { title },
});
const NL = {
  title: 'Roadmap',
  slides: [slide('slide-1', 'Hoi', 'title-slide'), slide('slide-2', 'Twee')],
};
const DE = {
  title: 'Fahrplan',
  slides: [slide('slide-1', 'Hallo', 'title-slide'), slide('slide-2', 'Zwei')],
};

async function installDb({ active = 'de', versions } = {}) {
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
          active,
          versions: versions || {
            nl: structuredClone(NL),
            de: structuredClone(DE),
          },
        },
        slides: structuredClone(NL.slides),
        published: null,
        created_at: '2026-07-01T00:00:00.000Z',
        modified_at: '2026-07-01T00:00:00.000Z',
        trashed_at: null,
      },
    ],
    activity_events: [],
  });
  __setTestDb(db);
  await initializeStorage(REPO_ROOT);
  return db;
}

const storedDeck = (db) =>
  db.__tables.presentations.find((row) => row.id === DECK_ID);
const titles = (slides) => slides.map((s) => s.content.title);

/** The German version and the language pointers as the store had them. */
function assertOtherVersionKept(row) {
  assert.equal(row.i18n.versions.de.title, 'Fahrplan');
  assert.deepEqual(titles(row.i18n.versions.de.slides), ['Hallo', 'Zwei']);
  assert.equal(row.i18n.active, 'de');
  assert.equal(row.i18n.dominant, 'nl');
}

const withAddedSlide = () => [
  ...structuredClone(NL.slides),
  slide('api-1', 'Via API'),
];

test('a slides-only write lands in the dominant version and keeps the active one', async () => {
  const db = await installDb();
  const result = await updatePresentation(scope(), DECK_ID, {
    slides: withAddedSlide(),
  });
  assert.notEqual(result?.ok, false);

  const row = storedDeck(db);
  assert.deepEqual(titles(row.slides), ['Hoi', 'Twee', 'Via API']);
  assert.deepEqual(titles(row.i18n.versions.nl.slides), [
    'Hoi',
    'Twee',
    'Via API',
  ]);
  assertOtherVersionKept(row);
});

test('a slides-only write on a deck edited in its dominant language updates that version', async () => {
  const db = await installDb({
    active: 'nl',
    versions: { nl: structuredClone(NL) },
  });
  await updatePresentation(scope(), DECK_ID, { slides: withAddedSlide() });

  const row = storedDeck(db);
  assert.deepEqual(titles(row.i18n.versions.nl.slides), [
    'Hoi',
    'Twee',
    'Via API',
  ]);
  assert.equal(row.i18n.active, 'nl');
});

test('a title-only write renames the dominant version, not only the top level', async () => {
  const db = await installDb();
  await updatePresentation(scope(), DECK_ID, { title: 'Koers' });

  const row = storedDeck(db);
  assert.equal(row.title, 'Koers');
  assert.equal(row.i18n.versions.nl.title, 'Koers');
  assert.deepEqual(titles(row.i18n.versions.nl.slides), ['Hoi', 'Twee']);
  assertOtherVersionKept(row);
});

test("the notes companion's write reaches the dominant version", async () => {
  const db = await installDb();
  const pres = await getPresentation(scope(), DECK_ID);
  const result = await updateSlideNotes(scope(), pres, {
    slideId: 'slide-2',
    notes: 'Pauze na deze slide',
  });
  assert.equal(result.ok, true);

  const row = storedDeck(db);
  assert.equal(row.i18n.versions.nl.slides[1].notes, 'Pauze na deze slide');
  assertOtherVersionKept(row);
});

test('a collab doc bootstrapped after a slides-only write shows the written slides', async () => {
  await installDb();
  await updatePresentation(scope(), DECK_ID, { slides: withAddedSlide() });

  const stored = await getPresentation(scope(), DECK_ID);
  const doc = new Y.Doc();
  deckYdocCodec.bootstrapPresentationToDoc(stored, doc);
  const projected = deckYdocCodec.projectDocToPresentation(doc);
  assert.deepEqual(titles(projected.slides), ['Hoi', 'Twee', 'Via API']);
});

test('a write that carries i18n is stored as sent', async () => {
  const db = await installDb();
  const de = structuredClone(DE);
  de.slides[1].content.title = 'Zwei!';
  await updatePresentation(scope(), DECK_ID, {
    title: de.title,
    slides: de.slides,
    i18n: {
      dominant: 'nl',
      active: 'de',
      versions: { nl: structuredClone(NL), de },
    },
  });

  const row = storedDeck(db);
  assert.deepEqual(titles(row.i18n.versions.de.slides), ['Hallo', 'Zwei!']);
  assert.deepEqual(titles(row.i18n.versions.nl.slides), ['Hoi', 'Twee']);
  assert.deepEqual(titles(row.slides), ['Hoi', 'Twee']);
});

// A write that carries `i18n` but no top-level buffer (B895). The versions it
// sends are the deck; an absent `title`/`slides` is not an empty buffer.

test('a write with only i18n keeps the title and slides of every version', async () => {
  const db = await installDb();
  await updatePresentation(scope(), DECK_ID, {
    i18n: structuredClone(storedDeck(db).i18n),
  });

  const row = storedDeck(db);
  assert.equal(row.i18n.versions.nl.title, 'Roadmap');
  assert.deepEqual(titles(row.i18n.versions.nl.slides), ['Hoi', 'Twee']);
  assert.equal(row.title, 'Roadmap');
  assert.deepEqual(titles(row.slides), ['Hoi', 'Twee']);
  assertOtherVersionKept(row);
});

test('a write with only i18n stores the edit it carries in the active version', async () => {
  const db = await installDb();
  const i18n = structuredClone(storedDeck(db).i18n);
  i18n.versions.de.title = 'Kurs';
  i18n.versions.de.slides[1].content.title = 'Zwei!';
  await updatePresentation(scope(), DECK_ID, { i18n });

  const row = storedDeck(db);
  assert.equal(row.i18n.versions.de.title, 'Kurs');
  assert.deepEqual(titles(row.i18n.versions.de.slides), ['Hallo', 'Zwei!']);
  assert.equal(row.title, 'Roadmap', 'the top level stays the dominant one');
});

test('a write with i18n and a title renames the active version and keeps its slides', async () => {
  const db = await installDb();
  await updatePresentation(scope(), DECK_ID, {
    title: 'Kurs',
    i18n: structuredClone(storedDeck(db).i18n),
  });

  const row = storedDeck(db);
  assert.equal(row.i18n.versions.de.title, 'Kurs');
  assert.deepEqual(titles(row.i18n.versions.de.slides), ['Hallo', 'Zwei']);
  assert.equal(row.i18n.versions.nl.title, 'Roadmap');
});

test('a write with only i18n on a deck without active keeps the dominant version', async () => {
  const db = await installDb();
  const i18n = structuredClone(storedDeck(db).i18n);
  delete i18n.active;
  await updatePresentation(scope(), DECK_ID, { i18n });

  const row = storedDeck(db);
  assert.equal(row.i18n.versions.nl.title, 'Roadmap');
  assert.deepEqual(titles(row.i18n.versions.nl.slides), ['Hoi', 'Twee']);
});
