/**
 * A live session mints one follow code per version the deck has (B182/D72 #6).
 *
 * The mint used to hardcode two follow URLs and file the codes under `nl` and
 * `en` — a key set that was wrong twice over. A deck with a German version got
 * no German code, so its audience could not join in German; a Dutch-only deck
 * got an English code for a version that did not exist; and `en` was not even
 * the axis spelling, so every renderer had to translate `en-GB` to `en` before
 * looking a code up. Codes are keyed by deck language now, one per version.
 *
 * Run with: node --test tests/follow-codes-per-version.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const REPO_ROOT = '/tmp/deckyard-follow-codes-test';
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createPresentation, updatePresentation } =
  await import('../server/storage/presentations/index.js');
const { createLiveSession } =
  await import('../server/storage/live-sessions/index.js');
const { resolveFollowCode } = await import('../server/storage/follow-codes.js');

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();
});
test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/** Presenter scope (states its organization — creating a session is not anonymous). */
const scope = () => ({
  repoRoot: REPO_ROOT,
  organizationId: ORG,
  actorEmail: OWNER,
});

/** A deck carrying exactly the language versions named, and its live session. */
async function sessionForDeckWith(langs) {
  const versions = {};
  for (const lang of langs)
    versions[lang] = {
      title: `Deck ${lang}`,
      slides: [{ id: 's1', type: 'content-slide', content: { title: lang } }],
    };
  const pres = await createPresentation(scope(), {
    title: `Deck ${langs[0]}`,
    lang: langs[0],
  });
  // The versions go on in a second write: `createPresentation` builds the i18n
  // block itself (from per-slide `contentByLang`) and does not take one.
  await updatePresentation(scope(), pres.id, {
    title: `Deck ${langs[0]}`,
    slides: versions[langs[0]].slides,
    i18n: { dominant: langs[0], active: langs[0], versions },
  });
  const created = await createLiveSession(scope(), { presentationId: pres.id });
  assert.equal(created.ok, true);
  return { pres, created };
}

test('a nl+de deck gets a nl code and a de code, and no English one', async () => {
  const { created } = await sessionForDeckWith(['nl', 'de']);
  assert.deepEqual(Object.keys(created.followCodes).sort(), ['de', 'nl']);
  assert.notEqual(created.followCodes.nl, created.followCodes.de);
});

test('the codes are keyed by the axis spelling, not by a short form', async () => {
  const { created } = await sessionForDeckWith(['nl', 'en-GB']);
  // `en` was the old key. Every renderer had to map `en-GB` onto it.
  assert.deepEqual(Object.keys(created.followCodes).sort(), ['en-GB', 'nl']);
});

test('each code resolves to the follow URL of its own version', async () => {
  const { pres, created } = await sessionForDeckWith(['nl', 'de']);
  for (const [lang, code] of Object.entries(created.followCodes)) {
    const url = await resolveFollowCode(scope(), code);
    assert.equal(url, `/follow/${pres.id}?lang=${lang}`);
  }
});

test('a single-version deck gets exactly one code', async () => {
  const { created } = await sessionForDeckWith(['fr']);
  assert.deepEqual(Object.keys(created.followCodes), ['fr']);
});
