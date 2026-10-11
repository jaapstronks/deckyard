/**
 * A version snapshot leaves storage through the schema funnel (B452).
 *
 * Preview, compare and restore all read `presentation_data` of a version row.
 * Before this, that read skipped `migratePresentation()`, so a snapshot taken
 * before a fold reached the renderer in its old shape. With the numbered
 * text-blocks fields read by nothing but the v1 -> v2 step, such a snapshot
 * would preview as an empty slide.
 *
 * Run with: node --test tests/version-snapshot-funnel.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { mapVersionRowFull } from '../server/storage/presentations/index.js';
import { CURRENT_SCHEMA_VERSION } from '../shared/slide-types/schema-version.js';

function versionRow(presentationData) {
  return {
    id: 'v-1',
    presentation_id: 'deck-1',
    created_at: new Date('2026-07-01T00:00:00Z'),
    created_by_user_id: null,
    created_by: null,
    reason: 'manual',
    label: null,
    revision: 3,
    title: 'Deck',
    presentation_data: presentationData,
  };
}

test('a pre-fold text-blocks snapshot comes back in the rows[] shape', () => {
  const version = mapVersionRowFull(
    versionRow({
      id: 'deck-1',
      title: 'Deck',
      slides: [
        {
          id: 's1',
          type: 'text-blocks-slide',
          content: {
            title: 'Old',
            row1Count: '1',
            row1Block1Title: 'Kept',
            row1Block1Body: 'Body',
          },
        },
      ],
    }),
  );
  const content = version.presentation.slides[0].content;
  assert.equal(content.rows[0].blocks[0].title, 'Kept');
  assert.equal(content.rows[0].blocks[0].body, 'Body');
  assert.equal(content.row1Block1Title, undefined);
  assert.equal(version.presentation.schemaVersion, CURRENT_SCHEMA_VERSION);
});

test('a row without snapshot data stays without it', () => {
  assert.equal(mapVersionRowFull(versionRow(null)).presentation, null);
});

/**
 * A text-blocks deck in the canonical `rows[]` shape that still carries a
 * numbered mirror field, stamped with `schemaVersion`.
 * @param {number} schemaVersion
 * @returns {object}
 */
function stampedMirrorDeck(schemaVersion) {
  return {
    id: 'deck-1',
    title: 'Deck',
    revision: 3,
    ownerEmail: 'owner@example.com',
    schemaVersion,
    slides: [
      {
        id: 's1',
        type: 'text-blocks-slide',
        content: {
          title: 'Mirror',
          rows: [{ blocks: [{ title: 'Kept' }] }],
          row1Block1Title: 'Old mirror',
        },
      },
    ],
  };
}

// A snapshot keeps the stamp the deck had when it was saved
// (`stripIdentityForSnapshot` strips identity, not `schemaVersion`), and that
// stamp says nothing about the steps tightened since. Neither an old nor the
// current stamp may skip the v1 -> v2 normalisation (B239, D85).
for (const [label, stamp] of [
  ['an old', 2],
  ['the current', CURRENT_SCHEMA_VERSION],
]) {
  test(`a snapshot stamped with ${label} schemaVersion still runs the v1 -> v2 step`, async () => {
    const ORG = '00000000-0000-0000-0000-0000000000bb';
    process.env.DEFAULT_ORGANIZATION_ID = ORG;
    const { createFakeDb } = await import('./helpers/fake-db.js');
    const { __setTestDb } = await import('../server/db/client.js');
    const { initializeStorage, __resetStorageForTests } =
      await import('../server/storage/lifecycle.js');
    const db = createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      presentation_versions: [],
    });
    __setTestDb(db);
    await initializeStorage();
    try {
      const { createPresentationVersion, getPresentationVersion } =
        await import('../server/storage/presentations/index.js');
      const storageScope = { repoRoot: null, organizationId: ORG };

      const created = await createPresentationVersion(
        storageScope,
        'deck-1',
        stampedMirrorDeck(stamp),
        { reason: 'manual' },
      );

      // The stored snapshot carries the stamp and the mirror verbatim: the
      // normalisation is the read funnel's job, and the stamp must not stop it.
      const [stored] = db.__tables.presentation_versions;
      const data =
        typeof stored.presentation_data === 'string'
          ? JSON.parse(stored.presentation_data)
          : stored.presentation_data;
      assert.equal(data.schemaVersion, stamp);
      assert.equal(data.ownerEmail, undefined);
      assert.equal(data.slides[0].content.row1Block1Title, 'Old mirror');

      const read = await getPresentationVersion(
        storageScope,
        'deck-1',
        created.id,
      );
      for (const version of [created, read]) {
        const content = version.presentation.slides[0].content;
        assert.deepEqual(content.rows, [{ blocks: [{ title: 'Kept' }] }]);
        assert.equal(content.row1Block1Title, undefined);
        assert.equal(
          version.presentation.schemaVersion,
          CURRENT_SCHEMA_VERSION,
        );
      }
    } finally {
      __resetStorageForTests();
      __setTestDb(null);
    }
  });
}
