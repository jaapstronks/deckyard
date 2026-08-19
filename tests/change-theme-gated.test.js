/**
 * Regression tests for the gated theme switch.
 *
 * The shared write path hard-locks `theme` so a stray save can never flip a
 * deck's branding. The one sanctioned exception is the permission-checked
 * /change-theme route, which opts in with `allowThemeChange: true`. These tests
 * pin both halves: the default lock stays, and the flag lets a real switch
 * through (exercised against the Postgres adapter on the in-memory database
 * double, tests/helpers/fake-db.js).
 *
 * Run with: node --test tests/change-theme-gated.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testScope } from './helpers/storage-scope.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createPresentation, getPresentation, updatePresentation } =
  await import('../server/storage/presentations/index.js');

const OWNER = 'owner@example.com';

describe('updatePresentation — gated theme switch', () => {
  let deckId;

  before(async () => {
    __setTestDb(
      createFakeDb({
        organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      }),
    );
    await initializeStorage();
    const created = await createPresentation(testScope(), {
      title: 'Theme lock',
      ownerEmail: OWNER,
      lang: 'nl',
      theme: 'amethyst',
    });
    deckId = created.id;
    assert.equal(
      created.theme,
      'amethyst',
      'fixture should start on the amethyst theme',
    );
  });

  after(async () => {
    __resetStorageForTests();
    __setTestDb(null);
  });

  it('keeps the theme locked on a normal save (no allowThemeChange)', async () => {
    const doc = structuredClone(await getPresentation(testScope(), deckId));
    doc.theme = 'midnight'; // a would-be switch coming in on the body
    const updated = await updatePresentation(testScope(), deckId, doc, {
      actorEmail: OWNER,
    });
    assert.equal(
      updated.theme,
      'amethyst',
      'default write path must ignore a theme change',
    );

    const stored = await getPresentation(testScope(), deckId);
    assert.equal(stored.theme, 'amethyst', 'nothing was persisted');
  });

  it('switches the theme when allowThemeChange is set (the /change-theme route)', async () => {
    const doc = structuredClone(await getPresentation(testScope(), deckId));
    doc.theme = 'midnight';
    const updated = await updatePresentation(testScope(), deckId, doc, {
      actorEmail: OWNER,
      allowThemeChange: true,
    });
    assert.equal(
      updated.theme,
      'midnight',
      'gated write path must apply the new theme',
    );

    const stored = await getPresentation(testScope(), deckId);
    assert.equal(stored.theme, 'midnight', 'the switch was persisted');
  });

  it('leaves the theme untouched when the flag is set but no theme is provided', async () => {
    // The deck is now on 'midnight' from the previous test.
    const doc = structuredClone(await getPresentation(testScope(), deckId));
    delete doc.theme;
    const updated = await updatePresentation(testScope(), deckId, doc, {
      actorEmail: OWNER,
      allowThemeChange: true,
    });
    assert.equal(
      updated.theme,
      'midnight',
      'a missing body theme falls back to the stored one',
    );
  });
});
