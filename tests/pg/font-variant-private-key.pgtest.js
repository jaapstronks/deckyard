/**
 * An uploaded font variant's URL is derived from its private key (B510),
 * against real PostgreSQL.
 *
 * Migration 088 dropped `font_variants.url`: the served address
 * (`/fonts/managed/<file>`) derives from the storage key in `filename`, so a
 * stored URL would be a second authority on the same object. The in-memory
 * double accepts any column, so only a real schema proves the column is gone
 * and the storage layer no longer reads or writes it.
 *
 * What this pins down:
 * - the column is absent after migration;
 * - a variant stored with a private key reads back with the derived route URL;
 * - a pre-B510 variant (public key) reads back with no URL at all, until
 *   `scripts/privatize-font-variants.js` moves it.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert';
import { sql } from 'kysely';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  addFontVariant,
  createFontFamily,
  getFontFamily,
} from '../../server/storage/font-families.js';
import { listPublicFontVariants } from '../../scripts/privatize-font-variants.js';

const storageScope = testScope();

pgDescribe('font variant URLs derive from the private key (PostgreSQL)', () => {
  let db;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  it('has no stored url column', async () => {
    const { rows } = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'font_variants'
    `.execute(db);
    const columns = rows.map((r) => r.column_name);
    assert.ok(columns.includes('filename'));
    assert.ok(!columns.includes('url'), 'migration 088 dropped the column');
  });

  it('derives the route URL from a private key, and none from a public one', async () => {
    const created = await createFontFamily(storageScope, {
      name: 'Licensed Sans',
      source: 'upload',
    });
    assert.ok(created.ok);
    const familyId = created.fontFamily.id;

    const priv = await addFontVariant(storageScope, familyId, {
      weight: 400,
      style: 'normal',
      filename: 'private/fonts/licensed-sans-400-normal-abc.woff2',
      format: 'woff2',
    });
    assert.ok(priv.ok);
    assert.equal(
      priv.variant.url,
      '/fonts/managed/licensed-sans-400-normal-abc.woff2',
    );

    const legacy = await addFontVariant(storageScope, familyId, {
      weight: 700,
      style: 'normal',
      filename: 'uploads/2026/09/licensed-sans-700-normal-def.woff2',
      format: 'woff2',
    });
    assert.ok(legacy.ok);
    assert.equal(legacy.variant.url, null);

    const family = await getFontFamily(storageScope, familyId);
    assert.deepEqual(
      family.variants.map((v) => [v.weight, v.url]),
      [
        [400, '/fonts/managed/licensed-sans-400-normal-abc.woff2'],
        [700, null],
      ],
    );

    const pending = await listPublicFontVariants(db);
    assert.deepEqual(
      pending.map((r) => r.filename),
      ['uploads/2026/09/licensed-sans-700-normal-def.woff2'],
      'the privatize script finds exactly the public one',
    );
  });
});
