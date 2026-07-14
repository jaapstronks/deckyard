#!/usr/bin/env node
/**
 * Data Migration: File-based storage → PostgreSQL
 *
 * Imports existing presentations, images, and slide library items
 * from file-based storage into PostgreSQL.
 *
 * Usage:
 *   node scripts/migrate-data-to-postgres.js [--dry-run] [--reset]
 *
 * Options:
 *   --dry-run  Show what would be migrated without making changes
 *   --reset    Clear existing database data before migrating (use to re-migrate)
 *
 * Prerequisites:
 *   - PostgreSQL database running and schema migrations applied
 *   - Set STORAGE_MODE=postgres in .env (or it uses file mode)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { loadDotEnv } from '../server/config/env.js';
import { getDatabaseConfig, getDefaultOrganizationId } from '../server/config/database.js';
import { dataDir } from '../server/config/storage-paths.js';

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
          theme: data.theme || 'deckyard',
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
            scope: 'team',
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
              scope: 'personal',
              owner_email: item.createdBy || null,
              name: item.name || '',
              slide_type: item.slideType || '',
              theme_id: item.themeId || '',
              content: JSON.stringify(item.content || {}),
              favorites: [],
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

    const results = {
      presentations: await migratePresentations(db, dataPath),
      images: await migrateImageLibrary(db, dataPath),
      slideLibrary: await migrateSlideLibrary(db, dataPath),
      published: await migratePublished(db, dataPath),
    };

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(' Summary');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`\n Presentations: ${results.presentations.migrated} migrated, ${results.presentations.skipped} skipped`);
    console.log(` Images: ${results.images.migrated} migrated, ${results.images.skipped} skipped`);
    console.log(` Slide Library: ${results.slideLibrary.migrated} migrated, ${results.slideLibrary.skipped} skipped`);
    console.log(` Published: ${results.published.migrated} migrated, ${results.published.skipped} skipped`);

    if (dryRun) {
      console.log('\n⚡ Run without --dry-run to apply changes\n');
    } else {
      console.log('\n✅ Migration complete!\n');
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('\n❌ Migration failed:', err.message);
  process.exit(1);
});
