/**
 * The one-time version-import migration (053) is idempotent and
 * non-destructive: running it twice imports each on-disk snapshot exactly
 * once and never overwrites an existing row; snapshots for a presentation
 * that no longer exists are skipped. The migration reads the pre-Postgres
 * file layout (data/presentation-versions/<deck>/<id>.json) and keeps doing
 * so after the file backend's removal — it is part of the import path for
 * old data directories.
 *
 * Run with: node --test tests/version-import-migration.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * A minimal fake of the Kysely query builder covering exactly the calls the
 * migration makes: selectFrom(...).select(...).where(...).executeTakeFirst()
 * and insertInto(...).values(...).execute(). Keeps inserted version rows in a
 * Map keyed by id so idempotency (skip-if-exists) is observable.
 */
function makeFakeDb({ presentations }) {
  const versionRows = new Map();
  let insertCount = 0;

  function selectFrom(table) {
    const state = { table, conditions: {} };
    const builder = {
      select() {
        return builder;
      },
      where(col, _op, val) {
        state.conditions[col] = val;
        return builder;
      },
      async executeTakeFirst() {
        if (state.table === 'presentations') {
          const id = state.conditions.id;
          return presentations.has(id)
            ? { organization_id: presentations.get(id) }
            : undefined;
        }
        if (state.table === 'presentation_versions') {
          const id = state.conditions.id;
          return versionRows.has(id) ? { id } : undefined;
        }
        return undefined;
      },
    };
    return builder;
  }

  function insertInto(table) {
    return {
      values(row) {
        return {
          async execute() {
            if (table !== 'presentation_versions') return;
            assert.ok(
              !versionRows.has(row.id),
              `must not overwrite existing row ${row.id}`,
            );
            versionRows.set(row.id, row);
            insertCount += 1;
          },
        };
      },
    };
  }

  return {
    db: { selectFrom, insertInto },
    versionRows,
    get insertCount() {
      return insertCount;
    },
  };
}

describe('053 import migration', () => {
  const tmpDataDir = path.join(
    os.tmpdir(),
    `deckyard-migrate-${crypto.randomUUID()}`,
  );
  const versionsBase = path.join(tmpDataDir, 'presentation-versions');
  const existingDeck = 'deck-existing';
  const orphanDeck = 'deck-orphan';
  let migration;

  const versionIds = [crypto.randomUUID(), crypto.randomUUID()];

  before(async () => {
    process.env.DATA_DIR = tmpDataDir;

    // Two snapshots for a presentation that exists in the fake DB.
    await fs.mkdir(path.join(versionsBase, existingDeck), { recursive: true });
    for (const vid of versionIds) {
      const snap = {
        id: vid,
        presentationId: existingDeck,
        created: new Date().toISOString(),
        createdBy: 'alice@example.com',
        reason: 'manual',
        label: '',
        revision: 3,
        title: 'Existing deck',
        presentation: { id: existingDeck, title: 'Existing deck', slides: [] },
      };
      await fs.writeFile(
        path.join(versionsBase, existingDeck, `${vid}.json`),
        JSON.stringify(snap, null, 2),
      );
    }

    // One snapshot for a presentation that no longer exists -> must be skipped.
    await fs.mkdir(path.join(versionsBase, orphanDeck), { recursive: true });
    const orphanSnap = {
      id: crypto.randomUUID(),
      presentationId: orphanDeck,
      created: new Date().toISOString(),
      reason: 'snapshot',
      revision: 1,
      title: 'Orphan',
      presentation: { id: orphanDeck, slides: [] },
    };
    await fs.writeFile(
      path.join(versionsBase, orphanDeck, `${orphanSnap.id}.json`),
      JSON.stringify(orphanSnap, null, 2),
    );

    migration =
      await import('../server/db/migrations/053_import_file_versions_to_table.js');
  });

  after(async () => {
    await fs.rm(tmpDataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('imports each on-disk snapshot once, skips orphans, and is idempotent on re-run', async () => {
    const fake = makeFakeDb({
      presentations: new Map([[existingDeck, 'org-1']]),
    });

    await migration.up(fake.db);
    assert.strictEqual(
      fake.insertCount,
      2,
      'both snapshots of the existing deck imported',
    );
    assert.strictEqual(fake.versionRows.size, 2);
    // Orphan deck snapshot skipped (presentation absent from the fake DB).
    for (const row of fake.versionRows.values()) {
      assert.strictEqual(row.presentation_id, existingDeck);
      assert.strictEqual(row.organization_id, 'org-1');
    }
    // Imported ids match the on-disk version ids.
    for (const vid of versionIds) {
      assert.ok(fake.versionRows.has(vid), `imported version ${vid}`);
    }

    // Second run must import nothing new (idempotent) and never overwrite.
    await migration.up(fake.db);
    assert.strictEqual(
      fake.insertCount,
      2,
      'second run imported no additional rows',
    );
    assert.strictEqual(fake.versionRows.size, 2);
  });

  it('is a no-op when the versions directory is absent', async () => {
    const missingDir = path.join(
      os.tmpdir(),
      `deckyard-missing-${crypto.randomUUID()}`,
    );
    process.env.DATA_DIR = missingDir;
    const fake = makeFakeDb({ presentations: new Map() });
    await migration.up(fake.db); // must not throw
    assert.strictEqual(fake.insertCount, 0);
    process.env.DATA_DIR = tmpDataDir;
  });
});
