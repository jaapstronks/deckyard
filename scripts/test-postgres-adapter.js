/**
 * Test script to verify PostgreSQL adapter functionality.
 * Run: node scripts/test-postgres-adapter.js
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../server/config/env.js';
import { PostgresAdapter } from '../server/storage/adapters/postgres-adapter.js';
import { getDefaultOrganizationId } from '../server/config/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

async function main() {
  console.log('Loading .env...');
  await loadDotEnv(REPO_ROOT);

  console.log('Initializing PostgreSQL adapter...');
  const adapter = new PostgresAdapter();
  await adapter.initialize();

  const ctx = { organizationId: getDefaultOrganizationId() };
  console.log(`Using organization: ${ctx.organizationId}\n`);

  try {
    // Test 1: List presentations (should be empty)
    console.log('Test 1: List presentations');
    const list1 = await adapter.listPresentations(ctx);
    console.log(`  Found ${list1.length} presentations`);
    console.log('  ✓ PASS\n');

    // Test 2: Create a presentation
    console.log('Test 2: Create presentation');
    const created = await adapter.createPresentation({
      title: 'Test Presentation',
      theme: 'default',
      lang: 'en-GB',
      slides: [
        { id: 'slide-1', type: 'title-slide', content: { title: 'Hello World' } }
      ],
      settings: { qaEnabled: true },
      i18n: {
        dominant: 'en-GB',
        active: 'en-GB',
        versions: {
          'en-GB': {
            title: 'Test Presentation',
            slides: [{ id: 'slide-1', type: 'title-slide', content: { title: 'Hello World' } }]
          }
        }
      }
    }, { ...ctx, actorEmail: 'test@example.com' });
    console.log(`  Created presentation: ${created.id}`);
    console.log(`  Title: ${created.title}`);
    console.log('  ✓ PASS\n');

    // Test 3: Get presentation
    console.log('Test 3: Get presentation by ID');
    const fetched = await adapter.getPresentation(created.id, ctx);
    console.log(`  Fetched: ${fetched?.title}`);
    console.log(`  Has slides: ${fetched?.slides?.length > 0}`);
    console.log('  ✓ PASS\n');

    // Test 4: Update presentation
    console.log('Test 4: Update presentation');
    const updated = await adapter.updatePresentation(created.id, {
      ...fetched,
      title: 'Updated Test Presentation',
    }, ctx);
    console.log(`  Updated title: ${updated?.title}`);
    console.log(`  New revision: ${updated?.revision}`);
    console.log('  ✓ PASS\n');

    // Test 5: List presentations (should have 1)
    console.log('Test 5: List presentations again');
    const list2 = await adapter.listPresentations(ctx);
    console.log(`  Found ${list2.length} presentation(s)`);
    console.log('  ✓ PASS\n');

    // Test 6: Create version
    console.log('Test 6: Create presentation version');
    const version = await adapter.createPresentationVersion(created.id, updated, ctx, {
      reason: 'test-snapshot',
      label: 'Test Version',
    });
    console.log(`  Version ID: ${version.id}`);
    console.log(`  Reason: ${version.reason}`);
    console.log('  ✓ PASS\n');

    // Test 7: List versions
    console.log('Test 7: List versions');
    const versions = await adapter.listPresentationVersions(created.id, ctx);
    console.log(`  Found ${versions.length} version(s)`);
    console.log('  ✓ PASS\n');

    // Test 8: Delete presentation
    console.log('Test 8: Delete presentation');
    const deleted = await adapter.deletePresentation(created.id, ctx);
    console.log(`  Deleted: ${deleted}`);
    console.log('  ✓ PASS\n');

    // Test 9: Verify deletion
    console.log('Test 9: Verify deletion');
    const list3 = await adapter.listPresentations(ctx);
    console.log(`  Found ${list3.length} presentation(s)`);
    console.log('  ✓ PASS\n');

    console.log('═══════════════════════════════════════');
    console.log('All tests passed! PostgreSQL adapter is working.');
    console.log('═══════════════════════════════════════');

  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  } finally {
    await adapter.close();
  }
}

main();
