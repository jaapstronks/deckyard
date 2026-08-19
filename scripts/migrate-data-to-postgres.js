#!/usr/bin/env node
/**
 * Data Import: File-based storage → PostgreSQL
 *
 * Imports existing file-based data into PostgreSQL. Covers every adapter domain
 * that keeps a file/PG split: presentations, image library, slide library,
 * published presentations, tags, slide collections, and per-user
 * slide-library usage.
 *
 * Intentionally NOT imported (see storage-path-consolidation brief, besluit 5):
 *   - presentation-versions — already covered by DB migration
 *     053_import_file_versions_to_table.js (runs at `db:migrate`).
 *   - ydoc-state — derived collab state; it re-seeds itself from the deck JSON
 *     the first time a deck is opened, so there is nothing to carry over.
 *
 * The import is idempotent: a second run against the same data is a no-op
 * (every domain checks for an existing row before inserting).
 *
 * Usage:
 *   node scripts/migrate-data-to-postgres.js [--dry-run] [--reset]
 *
 * Options:
 *   --dry-run  Show what would be imported without making changes
 *   --reset    Clear existing database data before importing (use to re-import)
 *
 * Prerequisites:
 *   - PostgreSQL database running and schema migrations applied
 *   - DATABASE_* configured (STORAGE_MODE already defaults to postgres)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { loadDotEnv } from '../server/config/env.js';
import {
  getDatabaseConfig,
  getDefaultOrganizationId,
} from '../server/config/database.js';
import { dataDir } from '../server/config/storage-paths.js';
import { DEFAULT_THEME_ID } from '../shared/constants/themes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const { Pool } = pg;

const dryRun = process.argv.includes('--dry-run');
const resetFirst = process.argv.includes('--reset');

async function createDb() {
  const config = getDatabaseConfig();
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
  });

  return new Kysely({
    dialect: new PostgresDialect({ pool }),
  });
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function migratePresentations(db, dataPath) {
  console.log('\n📁 Migrating presentations...');

  const presentationsDir = path.join(dataPath, 'presentations');
  let files;
  try {
    files = await fs.readdir(presentationsDir);
  } catch {
    console.log('   No presentations directory found');
    return { migrated: 0, skipped: 0 };
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  const organizationId = getDefaultOrganizationId();

  let migrated = 0;
  let skipped = 0;

  for (const file of jsonFiles) {
    const filePath = path.join(presentationsDir, file);
    const data = await readJsonIfExists(filePath);

    if (!data || !data.id) {
      console.log(`   ⚠ Skipping invalid file: ${file}`);
      skipped++;
      continue;
    }

    // Check if already exists in database
    const existing = await db
      .selectFrom('presentations')
      .where('id', '=', data.id)
      .select('id')
      .executeTakeFirst();

    if (existing) {
      console.log(`   ⏭ Already exists: ${data.title || data.id}`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`   📝 Would migrate: ${data.title || data.id}`);
      migrated++;
      continue;
    }

    // Insert into database
    try {
      await db
        .insertInto('presentations')
        .values({
          id: data.id,
          organization_id: organizationId,
          title: data.title || 'Untitled',
          theme: data.theme || DEFAULT_THEME_ID,
          owner_email: data.ownerEmail || null,
          slides: JSON.stringify(data.slides || []),
          settings: JSON.stringify(data.settings || {}),
          i18n: JSON.stringify(data.i18n || {}),
          created_at: data.created ? new Date(data.created) : new Date(),
          modified_at: data.modified ? new Date(data.modified) : new Date(),
        })
        .execute();

      console.log(`   ✓ Migrated: ${data.title || data.id}`);
      migrated++;
    } catch (err) {
      console.error(`   ✗ Error migrating ${file}: ${err.message}`);
      skipped++;
    }
  }

  return { migrated, skipped };
}

async function migrateImageLibrary(db, dataPath) {
  console.log('\n🖼 Migrating image library...');

  const indexPath = path.join(dataPath, 'image-library', 'index.json');
  const data = await readJsonIfExists(indexPath);

  if (!data || !Array.isArray(data.images)) {
    console.log('   No image library found');
    return { migrated: 0, skipped: 0 };
  }

  const organizationId = getDefaultOrganizationId();
  let migrated = 0;
  let skipped = 0;

  for (const img of data.images) {
    if (!img.id || !img.url) {
      skipped++;
      continue;
    }

    // Check if already exists
    const existing = await db
      .selectFrom('image_library')
      .where('id', '=', img.id)
      .select('id')
      .executeTakeFirst();

    if (existing) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`   📝 Would migrate: ${img.name || img.id}`);
      migrated++;
      continue;
    }

    try {
      await db
        .insertInto('image_library')
        .values({
          id: img.id,
          organization_id: organizationId,
          url: img.url,
          title: img.name || '',
          description: img.description || '',
          photographer: img.photographer || '',
          tags: img.tags || [],
          alts: JSON.stringify(img.alts || { nl: '', 'en-GB': '' }),
          created_at: img.createdAt ? new Date(img.createdAt) : new Date(),
          updated_at: img.updatedAt ? new Date(img.updatedAt) : new Date(),
        })
        .execute();

      migrated++;
    } catch (err) {
      console.error(`   ✗ Error: ${err.message}`);
      skipped++;
    }
  }

  console.log(`   Migrated ${migrated} images, skipped ${skipped}`);
  return { migrated, skipped };
}

async function migrateSlideLibrary(db, dataPath) {
  console.log('\n📚 Migrating slide library...');

  const organizationId = getDefaultOrganizationId();
  let totalMigrated = 0;
  let totalSkipped = 0;

  // Migrate team library
  const teamPath = path.join(dataPath, 'slide-library', 'team.json');
  const teamData = await readJsonIfExists(teamPath);

  if (teamData && Array.isArray(teamData.items)) {
    console.log('   Team library:');
    for (const item of teamData.items) {
      if (!item.id) {
        totalSkipped++;
        continue;
      }

      const existing = await db
        .selectFrom('slide_library')
        .where('id', '=', item.id)
        .select('id')
        .executeTakeFirst();

      if (existing) {
        totalSkipped++;
        continue;
      }

      if (dryRun) {
        console.log(`     📝 Would migrate: ${item.name || item.id}`);
        totalMigrated++;
        continue;
      }

      try {
        await db
          .insertInto('slide_library')
          .values({
            id: item.id,
            organization_id: organizationId,
            shelf: 'organization',
            owner_email: item.createdBy || null,
            name: item.name || '',
            slide_type: item.slideType || '',
            theme_id: item.themeId || '',
            content: JSON.stringify(item.content || {}),
            favorites: Array.isArray(item.favorites) ? item.favorites : [],
            trashed_at: item.trashedAt ? new Date(item.trashedAt) : null,
            trashed_by: item.trashedBy || null,
            created_at: item.createdAt ? new Date(item.createdAt) : new Date(),
            updated_at: item.updatedAt ? new Date(item.updatedAt) : new Date(),
            created_by: item.createdBy || null,
            updated_by: item.updatedBy || null,
          })
          .execute();

        totalMigrated++;
      } catch (err) {
        console.error(`     ✗ Error: ${err.message}`);
        totalSkipped++;
      }
    }
  }

  // Migrate personal libraries
  const personalDir = path.join(dataPath, 'slide-library', 'personal');
  try {
    const personalFiles = await fs.readdir(personalDir);
    const jsonFiles = personalFiles.filter((f) => f.endsWith('.json'));

    console.log('   Personal libraries:');
    for (const file of jsonFiles) {
      const personalData = await readJsonIfExists(path.join(personalDir, file));
      if (!personalData || !Array.isArray(personalData.items)) continue;

      for (const item of personalData.items) {
        if (!item.id) {
          totalSkipped++;
          continue;
        }

        const existing = await db
          .selectFrom('slide_library')
          .where('id', '=', item.id)
          .select('id')
          .executeTakeFirst();

        if (existing) {
          totalSkipped++;
          continue;
        }

        if (dryRun) {
          totalMigrated++;
          continue;
        }

        try {
          await db
            .insertInto('slide_library')
            .values({
              id: item.id,
              organization_id: organizationId,
              shelf: 'personal',
              owner_email: item.createdBy || null,
              name: item.name || '',
              slide_type: item.slideType || '',
              theme_id: item.themeId || '',
              content: JSON.stringify(item.content || {}),
              favorites: [],
              trashed_at: item.trashedAt ? new Date(item.trashedAt) : null,
              trashed_by: item.trashedBy || null,
              created_at: item.createdAt
                ? new Date(item.createdAt)
                : new Date(),
              updated_at: item.updatedAt
                ? new Date(item.updatedAt)
                : new Date(),
              created_by: item.createdBy || null,
              updated_by: item.updatedBy || null,
            })
            .execute();

          totalMigrated++;
        } catch (err) {
          totalSkipped++;
        }
      }
    }
  } catch {
    // No personal directory
  }

  console.log(`   Migrated ${totalMigrated} items, skipped ${totalSkipped}`);
  return { migrated: totalMigrated, skipped: totalSkipped };
}

async function migratePublished(db, dataPath) {
  console.log('\n🌐 Migrating published presentations...');

  const indexPath = path.join(dataPath, 'published', 'index.json');
  const data = await readJsonIfExists(indexPath);

  if (!data || typeof data !== 'object') {
    console.log('   No published index found');
    return { migrated: 0, skipped: 0 };
  }

  const organizationId = getDefaultOrganizationId();
  let migrated = 0;
  let skipped = 0;

  for (const [publishId, entry] of Object.entries(data)) {
    if (!entry || !entry.presentationId) {
      skipped++;
      continue;
    }

    const existing = await db
      .selectFrom('published_presentations')
      .where('id', '=', publishId)
      .select('id')
      .executeTakeFirst();

    if (existing) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`   📝 Would migrate: ${entry.title || publishId}`);
      migrated++;
      continue;
    }

    try {
      await db
        .insertInto('published_presentations')
        .values({
          id: publishId,
          organization_id: organizationId,
          presentation_id: entry.presentationId,
          title: entry.title || '',
          slug: entry.slug || '',
          og_image_url: entry.ogImageUrl || '',
          created_at: entry.created ? new Date(entry.created) : new Date(),
          modified_at: entry.modified ? new Date(entry.modified) : new Date(),
        })
        .execute();

      migrated++;
    } catch (err) {
      console.error(`   ✗ Error: ${err.message}`);
      skipped++;
    }
  }

  console.log(`   Migrated ${migrated} published entries, skipped ${skipped}`);
  return { migrated, skipped };
}

/**
 * Keep only slide-library ids that exist in this organization, de-duplicated
 * and in order. Guards the slide_collection_items FK the same way the Postgres
 * adapter does, so a stale reference is dropped instead of aborting the insert.
 * @param {import('kysely').Kysely} db
 * @param {string} organizationId
 * @param {string[]} slideIds
 * @returns {Promise<string[]>}
 */
async function filterExistingSlideIds(db, organizationId, slideIds) {
  const cleaned = [];
  const seen = new Set();
  for (const raw of Array.isArray(slideIds) ? slideIds : []) {
    const id = String(raw || '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      cleaned.push(id);
    }
  }
  if (cleaned.length === 0) return [];

  const rows = await db
    .selectFrom('slide_library')
    .select('id')
    .where('organization_id', '=', organizationId)
    .where('id', 'in', cleaned)
    .execute();
  const existing = new Set(rows.map((r) => String(r.id)));
  return cleaned.filter((id) => existing.has(id));
}

/**
 * Import presentation tags.
 *
 * The file store (`tags.json`) keeps a flat tag list with synthetic ids
 * (`tag_<name>`) plus a presentationId → tagIds link map. Postgres keeps tags
 * in the `tags` table (org-scoped, generated uuid, unique on lower(name)) and
 * links in `presentation_tags`. So this maps each file tag onto a real DB tag
 * by name (creating it if absent) and then materialises the links.
 *
 * The migrated unit is "tag rows written" = tags created + links created, so a
 * second run reports 0 migrated.
 * @param {import('kysely').Kysely} db
 * @param {string} dataPath
 * @param {{ dryRun: boolean, organizationId: string }} opts
 * @returns {Promise<{ migrated: number, skipped: number }>}
 */
export async function migrateTags(db, dataPath, { dryRun, organizationId }) {
  console.log('\n🏷 Migrating tags...');

  const store = await readJsonIfExists(path.join(dataPath, 'tags.json'));
  const fileTags = store && Array.isArray(store.tags) ? store.tags : [];
  const links =
    store && store.links && typeof store.links === 'object' ? store.links : {};

  if (fileTags.length === 0 && Object.keys(links).length === 0) {
    console.log('   No tags found');
    return { migrated: 0, skipped: 0 };
  }

  // Load existing tags once, indexed by lower(name), so find-or-create needs no
  // per-tag lookup and avoids db.fn('lower', ...) (the double doesn't model it).
  const existingRows = await db
    .selectFrom('tags')
    .select(['id', 'name'])
    .where('organization_id', '=', organizationId)
    .execute();
  const byLowerName = new Map(
    existingRows.map((r) => [
      String(r.name).toLowerCase(),
      { id: r.id, name: r.name },
    ]),
  );

  // file tag id -> DB tag { id, name }; null means "would be created" (dry run).
  const dbTagByFileId = new Map();
  let tagsCreated = 0;
  let tagsExisting = 0;

  for (const t of fileTags) {
    const name = String(t?.name || '').trim();
    const fileId = String(t?.id || '');
    if (!name || !fileId) continue;
    const lower = name.toLowerCase();
    const existing = byLowerName.get(lower);
    if (existing) {
      tagsExisting++;
      dbTagByFileId.set(fileId, existing);
    } else if (dryRun) {
      tagsCreated++;
      dbTagByFileId.set(fileId, null);
    } else {
      const row = await db
        .insertInto('tags')
        .values({
          organization_id: organizationId,
          name,
          created_at: new Date(),
        })
        .returning(['id', 'name'])
        .executeTakeFirst();
      const created = { id: row.id, name: row.name };
      byLowerName.set(lower, created);
      dbTagByFileId.set(fileId, created);
      tagsCreated++;
    }
  }

  let linksMigrated = 0;
  let linksSkipped = 0;

  for (const [presentationId, tagIds] of Object.entries(links)) {
    if (!Array.isArray(tagIds)) continue;
    for (const fileTagId of tagIds) {
      const dbTag = dbTagByFileId.get(String(fileTagId));
      if (dbTag === undefined) {
        // Link references a tag id not present in the file's tag list.
        linksSkipped++;
        continue;
      }
      if (dbTag === null) {
        // Dry run against a not-yet-created tag: the link is necessarily new.
        linksMigrated++;
        continue;
      }

      const existingLink = await db
        .selectFrom('presentation_tags')
        .select('tag_id')
        .where('presentation_id', '=', String(presentationId))
        .where('tag_id', '=', dbTag.id)
        .executeTakeFirst();
      if (existingLink) {
        linksSkipped++;
        continue;
      }
      if (dryRun) {
        linksMigrated++;
        continue;
      }

      try {
        await db
          .insertInto('presentation_tags')
          .values({
            presentation_id: String(presentationId),
            tag_id: dbTag.id,
            created_at: new Date(),
          })
          .execute();
        linksMigrated++;
      } catch (err) {
        // Dangling presentation reference (FK) — leave it out rather than abort.
        console.error(`   ✗ Error linking ${presentationId}: ${err.message}`);
        linksSkipped++;
      }
    }
  }

  console.log(
    `   Ensured ${tagsExisting + tagsCreated} tags (${tagsCreated} new), ${linksMigrated} links migrated`,
  );
  return {
    migrated: tagsCreated + linksMigrated,
    skipped: tagsExisting + linksSkipped,
  };
}

/**
 * Import slide collections.
 *
 * The file store (`slide-collections.json`) already uses uuid ids, so they are
 * preserved into `slide_collections`; ordered membership goes into
 * `slide_collection_items`, filtered to slide-library rows that actually exist
 * (mirroring the Postgres adapter's FK guard).
 * @param {import('kysely').Kysely} db
 * @param {string} dataPath
 * @param {{ dryRun: boolean, organizationId: string }} opts
 * @returns {Promise<{ migrated: number, skipped: number }>}
 */
export async function migrateSlideCollections(
  db,
  dataPath,
  { dryRun, organizationId },
) {
  console.log('\n🗂 Migrating slide collections...');

  const store = await readJsonIfExists(
    path.join(dataPath, 'slide-collections.json'),
  );
  const items = store && Array.isArray(store.items) ? store.items : [];

  if (items.length === 0) {
    console.log('   No slide collections found');
    return { migrated: 0, skipped: 0 };
  }

  let migrated = 0;
  let skipped = 0;

  for (const item of items) {
    if (!item || !item.id) {
      skipped++;
      continue;
    }

    const existing = await db
      .selectFrom('slide_collections')
      .select('id')
      .where('id', '=', item.id)
      .executeTakeFirst();
    if (existing) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`   📝 Would migrate: ${item.name || item.id}`);
      migrated++;
      continue;
    }

    try {
      await db
        .insertInto('slide_collections')
        .values({
          id: item.id,
          organization_id: organizationId,
          owner_email: item.ownerEmail || null,
          shelf: item.scope === 'team' ? 'organization' : 'personal',
          name: item.name || '',
          description: item.description || null,
          created_by: item.createdBy || null,
          updated_by: item.updatedBy || null,
          created_at: item.createdAt ? new Date(item.createdAt) : new Date(),
          updated_at: item.updatedAt ? new Date(item.updatedAt) : new Date(),
        })
        .execute();

      const validIds = await filterExistingSlideIds(
        db,
        organizationId,
        Array.isArray(item.slideIds) ? item.slideIds : [],
      );
      if (validIds.length > 0) {
        await db
          .insertInto('slide_collection_items')
          .values(
            validIds.map((slideId, index) => ({
              collection_id: item.id,
              slide_library_id: slideId,
              position: index,
              created_at: new Date(),
            })),
          )
          .execute();
      }

      migrated++;
    } catch (err) {
      console.error(`   ✗ Error: ${err.message}`);
      skipped++;
    }
  }

  console.log(`   Migrated ${migrated} collections, skipped ${skipped}`);
  return { migrated, skipped };
}

/**
 * Import per-user slide-library usage (the Home "new to you" signal).
 *
 * The file store (`slide-library-usage.json`) mirrors the `slide_library_usage`
 * table one-to-one, keyed by (org, user, item_type, item_id). Item ids carry no
 * FK, so a since-deleted item simply stops matching — nothing to filter here.
 * @param {import('kysely').Kysely} db
 * @param {string} dataPath
 * @param {{ dryRun: boolean, organizationId: string }} opts
 * @returns {Promise<{ migrated: number, skipped: number }>}
 */
export async function migrateSlideLibraryUsage(
  db,
  dataPath,
  { dryRun, organizationId },
) {
  console.log('\n📌 Migrating slide-library usage...');

  const store = await readJsonIfExists(
    path.join(dataPath, 'slide-library-usage.json'),
  );
  const items = store && Array.isArray(store.items) ? store.items : [];

  if (items.length === 0) {
    console.log('   No slide-library usage found');
    return { migrated: 0, skipped: 0 };
  }

  let migrated = 0;
  let skipped = 0;

  for (const item of items) {
    const userEmail = String(item?.userEmail || '')
      .trim()
      .toLowerCase();
    const itemType = String(item?.itemType || '').trim();
    const itemId = String(item?.itemId || '').trim();
    if (!userEmail || !itemType || !itemId) {
      skipped++;
      continue;
    }

    const existing = await db
      .selectFrom('slide_library_usage')
      .select('item_id')
      .where('organization_id', '=', organizationId)
      .where('user_email', '=', userEmail)
      .where('item_type', '=', itemType)
      .where('item_id', '=', itemId)
      .executeTakeFirst();
    if (existing) {
      skipped++;
      continue;
    }

    if (dryRun) {
      migrated++;
      continue;
    }

    try {
      await db
        .insertInto('slide_library_usage')
        .values({
          organization_id: organizationId,
          user_email: userEmail,
          item_type: itemType,
          item_id: itemId,
          first_used_at: item.firstUsedAt
            ? new Date(item.firstUsedAt)
            : new Date(),
          use_count: Number(item.useCount) || 1,
          updated_at: item.updatedAt ? new Date(item.updatedAt) : new Date(),
        })
        .execute();
      migrated++;
    } catch (err) {
      console.error(`   ✗ Error: ${err.message}`);
      skipped++;
    }
  }

  console.log(`   Migrated ${migrated} usage records, skipped ${skipped}`);
  return { migrated, skipped };
}

async function main() {
  await loadDotEnv(REPO_ROOT);

  console.log('═══════════════════════════════════════════════════════');
  console.log(' Data Migration: File Storage → PostgreSQL');
  console.log('═══════════════════════════════════════════════════════');

  if (dryRun) {
    console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
  }

  if (resetFirst) {
    console.log('\n🗑 RESET MODE - Clearing existing data first\n');
  }

  const dataPath = dataDir(REPO_ROOT);
  console.log(`\nData directory: ${dataPath}`);

  // Check if data directory exists
  try {
    await fs.access(dataPath);
  } catch {
    console.error('\n❌ Data directory not found. Nothing to migrate.');
    process.exit(1);
  }

  const db = await createDb();

  try {
    // Reset existing data if --reset flag is provided
    if (resetFirst && !dryRun) {
      // Delete children before parents (FK order).
      console.log('   Deleting presentation_tags...');
      await db.deleteFrom('presentation_tags').execute();
      console.log('   Deleting tags...');
      await db.deleteFrom('tags').execute();
      console.log('   Deleting slide_collection_items...');
      await db.deleteFrom('slide_collection_items').execute();
      console.log('   Deleting slide_collections...');
      await db.deleteFrom('slide_collections').execute();
      console.log('   Deleting slide_library_usage...');
      await db.deleteFrom('slide_library_usage').execute();
      console.log('   Deleting published_presentations...');
      await db.deleteFrom('published_presentations').execute();
      console.log('   Deleting slide_library...');
      await db.deleteFrom('slide_library').execute();
      console.log('   Deleting image_library...');
      await db.deleteFrom('image_library').execute();
      console.log('   Deleting presentations...');
      await db.deleteFrom('presentations').execute();
      console.log('   ✓ Database cleared\n');
    }

    const organizationId = getDefaultOrganizationId();
    const opts = { dryRun, organizationId };

    const results = {
      // Presentations and slide library first: tags link to presentations and
      // collections reference slide-library rows.
      presentations: await migratePresentations(db, dataPath),
      images: await migrateImageLibrary(db, dataPath),
      slideLibrary: await migrateSlideLibrary(db, dataPath),
      published: await migratePublished(db, dataPath),
      tags: await migrateTags(db, dataPath, opts),
      slideCollections: await migrateSlideCollections(db, dataPath, opts),
      slideLibraryUsage: await migrateSlideLibraryUsage(db, dataPath, opts),
    };

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(' Summary');
    console.log('═══════════════════════════════════════════════════════');
    console.log(
      `\n Presentations: ${results.presentations.migrated} migrated, ${results.presentations.skipped} skipped`,
    );
    console.log(
      ` Images: ${results.images.migrated} migrated, ${results.images.skipped} skipped`,
    );
    console.log(
      ` Slide Library: ${results.slideLibrary.migrated} migrated, ${results.slideLibrary.skipped} skipped`,
    );
    console.log(
      ` Published: ${results.published.migrated} migrated, ${results.published.skipped} skipped`,
    );
    console.log(
      ` Tags: ${results.tags.migrated} migrated, ${results.tags.skipped} skipped`,
    );
    console.log(
      ` Slide Collections: ${results.slideCollections.migrated} migrated, ${results.slideCollections.skipped} skipped`,
    );
    console.log(
      ` Slide Library Usage: ${results.slideLibraryUsage.migrated} migrated, ${results.slideLibraryUsage.skipped} skipped`,
    );

    console.log(
      '\n Not imported by design: presentation-versions (covered by DB migration 053)',
    );
    console.log(
      '   and ydoc-state (derived collab state, re-seeds from deck JSON).',
    );

    if (dryRun) {
      console.log('\n⚡ Run without --dry-run to apply changes\n');
    } else {
      console.log('\n✅ Import complete!\n');
    }
  } finally {
    await db.destroy();
  }
}

// Only run as a CLI; importing the module (tests) must not touch a database.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error('\n❌ Import failed:', err.message);
    process.exit(1);
  });
}
