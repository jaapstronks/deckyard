/**
 * A duplicated deck is named a copy in every language version (B816).
 *
 * `duplicatePresentationRow` used to put "Copy of …" on the top-level title
 * only, while every `i18n.versions[*].title` kept the source's name. The top
 * level is a projection of the dominant version, so the first editor save
 * re-projected it from that version and the copy was called exactly like its
 * source again, while the version the editor had open took over the prefixed
 * title (seen in the CIIIC production proof on v1.81.0).
 *
 * Pinned here: the copy carries the prefix top-level and in every version
 * that has a title of its own (each in its own version's language), and an
 * editor save round-trip in the non-dominant language keeps it.
 *
 * Runs against the in-memory database double (tests/helpers/fake-db.js).
 *
 * Run with: node --test tests/duplicate-version-titles.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testScope } from './helpers/storage-scope.js';
import { seedRow } from './helpers/theme-seed.js';
import { userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b816']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const {
  createPresentation,
  duplicatePresentation,
  getPresentation,
  updatePresentation,
} = await import('../server/storage/presentations/index.js');
const { projectPresentationForLang } = await import('../server/utils/i18n.js');
const { initPresentationI18n } =
  await import('../client/views/editor/bootstrap.js');

let db;
const scope = () => testScope(process.cwd());

test.before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
    themes: [await seedRow('brand')],
    activity_events: [],
  });
  __setTestDb(db);
  await initializeStorage();
});

test.after(() => {
  __setTestDb(null);
});

/** An English deck with a Dutch translation that has its own title. */
async function bilingualDeck() {
  const pres = await createPresentation(scope(), {
    title: 'Indigo',
    ownerEmail: OWNER,
    lang: 'en-GB',
  });
  const row = db.__tables.presentations.find((r) => r.id === pres.id);
  row.i18n.versions.nl = {
    title: 'Indigo NL',
    slides: structuredClone(row.i18n.versions['en-GB'].slides),
  };
  return pres;
}

test('the copy is named a copy top-level and in every language version', async () => {
  const source = await bilingualDeck();
  const result = await duplicatePresentation(scope(), source.id, {
    actorEmail: OWNER,
  });
  assert.equal(result.ok, true);
  const copy = await getPresentation(scope(), result.presentation.id);

  assert.equal(copy.title, 'Copy of Indigo');
  assert.equal(copy.i18n.versions['en-GB'].title, 'Copy of Indigo');
  assert.equal(
    copy.i18n.versions.nl.title,
    'Kopie van Indigo NL',
    'the Dutch version keeps its own title, prefixed in its own language',
  );

  const sourceAfter = await getPresentation(scope(), source.id);
  assert.equal(sourceAfter.title, 'Indigo', 'the source is not renamed');
  assert.equal(sourceAfter.i18n.versions.nl.title, 'Indigo NL');
});

test('an editor save in the non-dominant language does not rename the copy back', async () => {
  const source = await bilingualDeck();
  const { presentation } = await duplicatePresentation(scope(), source.id, {
    actorEmail: OWNER,
  });

  // What the editor holds when it opens the copy in Dutch: the server's
  // projection for `?lang=nl`, run through the editor bootstrap, which copies
  // the top-level title into the active version.
  const opened = projectPresentationForLang(
    structuredClone(await getPresentation(scope(), presentation.id)),
    'nl',
  );
  initPresentationI18n({ pres: opened, initialLang: 'nl' });

  await updatePresentation(scope(), presentation.id, opened, {
    actorEmail: OWNER,
  });
  const saved = await getPresentation(scope(), presentation.id);

  assert.equal(saved.title, 'Copy of Indigo', 'top level keeps the copy name');
  assert.equal(saved.i18n.versions['en-GB'].title, 'Copy of Indigo');
  assert.equal(saved.i18n.versions.nl.title, 'Kopie van Indigo NL');
});
