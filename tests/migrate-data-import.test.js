/**
 * Data-import script: tags, slide collections, and slide-library usage.
 *
 * Exercises the three domains PR C added to
 * `scripts/migrate-data-to-postgres.js` against the in-memory database double
 * (tests/helpers/fake-db.js) and a synthetic data directory — no live Postgres,
 * matching how `npm test` runs. Covers, for each domain:
 *   - a --dry-run pass reports the right per-domain counts and writes nothing;
 *   - a real pass inserts the expected rows (ids/values preserved, FK-guarded);
 *   - a second real pass is a no-op (idempotent): 0 migrated, tables unchanged.
 *
 * Run with: node --test tests/migrate-data-import.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { createFakeDb } from './helpers/fake-db.js';
import {
  migrateTags,
  migrateSlideCollections,
  migrateSlideLibraryUsage,
} from '../scripts/migrate-data-to-postgres.js';

const ORG = '00000000-0000-0000-0000-000000000001';
let dataPath;

before(async () => {
  dataPath = path.join(os.tmpdir(), `deckyard-import-${crypto.randomUUID()}`);
  await fs.mkdir(dataPath, { recursive: true });

  await fs.writeFile(
    path.join(dataPath, 'tags.json'),
    JSON.stringify({
      v: 1,
      tags: [
        { id: 'tag_intro', name: 'Intro' },
        { id: 'tag_demo', name: 'Demo' },
      ],
      links: {
        'pres-1': ['tag_intro', 'tag_demo'],
        'pres-2': ['tag_intro'],
        // References a tag id absent from the tag list — must be skipped.
        'pres-1-ghost': ['tag_missing'],
      },
    })
  );

  await fs.writeFile(
    path.join(dataPath, 'slide-collections.json'),
    JSON.stringify({
      v: 1,
      items: [
        {
          id: 'col-1',
          scope: 'team',
          ownerEmail: null,
          name: 'Starter kit',
          description: 'd',
          // slide-x does not exist in the library → filtered out of membership.
          slideIds: ['slide-a', 'slide-b', 'slide-x'],
          createdBy: 'a@x.com',
          updatedBy: 'a@x.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
        {
          id: 'col-2',
          scope: 'personal',
          ownerEmail: 'a@x.com',
          name: 'Mine',
          description: '',
          slideIds: [],
          createdBy: 'a@x.com',
          updatedBy: 'a@x.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
  );

  await fs.writeFile(
    path.join(dataPath, 'slide-library-usage.json'),
    JSON.stringify({
      v: 1,
      items: [
        {
          userEmail: 'A@X.com',
          itemType: 'slide',
          itemId: 'slide-a',
          firstUsedAt: '2026-01-01T00:00:00.000Z',
          useCount: 3,
          updatedAt: '2026-01-05T00:00:00.000Z',
        },
        {
          userEmail: 'b@x.com',
          itemType: 'collection',
          itemId: 'col-1',
          firstUsedAt: '2026-01-01T00:00:00.000Z',
          useCount: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        // Missing userEmail → invalid, skipped.
        { userEmail: '', itemType: 'slide', itemId: 'x' },
      ],
    })
  );
});

after(async () => {
  await fs.rm(dataPath, { recursive: true, force: true });
});

/** A fresh double seeded with the presentations/slide-library the import references. */
function seedDb() {
  return createFakeDb({
    presentations: [
      { id: 'pres-1', organization_id: ORG },
      { id: 'pres-2', organization_id: ORG },
    ],
    slide_library: [
      { id: 'slide-a', organization_id: ORG },
      { id: 'slide-b', organization_id: ORG },
    ],
  });
}

describe('migrateTags', () => {
  it('dry run counts tags + links and writes nothing', async () => {
    const db = seedDb();
    const res = await migrateTags(db, dataPath, { dryRun: true, organizationId: ORG });
    // 2 tags created + 3 links (pres-1 x2, pres-2 x1); tag_missing link skipped.
    assert.strictEqual(res.migrated, 5);
    assert.strictEqual(res.skipped, 1);
    assert.strictEqual((db.__tables.tags || []).length, 0);
    assert.strictEqual((db.__tables.presentation_tags || []).length, 0);
  });

  it('imports tags + links, then is idempotent on a second run', async () => {
    const db = seedDb();

    const first = await migrateTags(db, dataPath, { dryRun: false, organizationId: ORG });
    assert.strictEqual(first.migrated, 5);
    assert.strictEqual(first.skipped, 1);
    assert.strictEqual(db.__tables.tags.length, 2);
    assert.strictEqual(db.__tables.presentation_tags.length, 3);

    const second = await migrateTags(db, dataPath, { dryRun: false, organizationId: ORG });
    assert.strictEqual(second.migrated, 0, 'second run migrates nothing');
    assert.strictEqual(db.__tables.tags.length, 2, 'tags unchanged');
    assert.strictEqual(db.__tables.presentation_tags.length, 3, 'links unchanged');
  });
});

describe('migrateSlideCollections', () => {
  it('dry run counts collections and writes nothing', async () => {
    const db = seedDb();
    const res = await migrateSlideCollections(db, dataPath, { dryRun: true, organizationId: ORG });
    assert.strictEqual(res.migrated, 2);
    assert.strictEqual(res.skipped, 0);
    assert.strictEqual((db.__tables.slide_collections || []).length, 0);
  });

  it('imports collections + membership (FK-guarded), then is idempotent', async () => {
    const db = seedDb();

    const first = await migrateSlideCollections(db, dataPath, {
      dryRun: false,
      organizationId: ORG,
    });
    assert.strictEqual(first.migrated, 2);
    assert.strictEqual(first.skipped, 0);
    assert.strictEqual(db.__tables.slide_collections.length, 2);
    // slide-x is dropped; only slide-a and slide-b survive the FK guard.
    assert.strictEqual(db.__tables.slide_collection_items.length, 2);

    const col1 = db.__tables.slide_collections.find((r) => r.id === 'col-1');
    assert.strictEqual(col1.scope, 'team');
    assert.strictEqual(col1.organization_id, ORG);

    const second = await migrateSlideCollections(db, dataPath, {
      dryRun: false,
      organizationId: ORG,
    });
    assert.strictEqual(second.migrated, 0, 'second run migrates nothing');
    assert.strictEqual(db.__tables.slide_collections.length, 2, 'collections unchanged');
    assert.strictEqual(db.__tables.slide_collection_items.length, 2, 'membership unchanged');
  });
});

describe('migrateSlideLibraryUsage', () => {
  it('dry run counts valid usage rows and writes nothing', async () => {
    const db = seedDb();
    const res = await migrateSlideLibraryUsage(db, dataPath, { dryRun: true, organizationId: ORG });
    assert.strictEqual(res.migrated, 2);
    assert.strictEqual(res.skipped, 1);
    assert.strictEqual((db.__tables.slide_library_usage || []).length, 0);
  });

  it('imports usage (values preserved, email lowercased), then is idempotent', async () => {
    const db = seedDb();

    const first = await migrateSlideLibraryUsage(db, dataPath, {
      dryRun: false,
      organizationId: ORG,
    });
    assert.strictEqual(first.migrated, 2);
    assert.strictEqual(first.skipped, 1);
    assert.strictEqual(db.__tables.slide_library_usage.length, 2);

    const row = db.__tables.slide_library_usage.find((r) => r.item_id === 'slide-a');
    assert.strictEqual(row.user_email, 'a@x.com', 'email lowercased');
    assert.strictEqual(row.use_count, 3, 'use_count preserved');

    const second = await migrateSlideLibraryUsage(db, dataPath, {
      dryRun: false,
      organizationId: ORG,
    });
    assert.strictEqual(second.migrated, 0, 'second run migrates nothing');
    assert.strictEqual(db.__tables.slide_library_usage.length, 2, 'usage unchanged');
  });
});
