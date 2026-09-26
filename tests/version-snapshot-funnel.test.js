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
