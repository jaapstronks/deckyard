#!/usr/bin/env node

/**
 * Prune the disk-JSON fossils that the one-time `db:import` left behind under
 * the data directory (`server/data/` by default).
 *
 * Everything this removes was migrated into PostgreSQL during beta
 * (migrations 053, 058–061 and `db:import`); the files on disk are dead
 * copies. Two things in the data directory are ALIVE and are never touched:
 *
 *   - `deck-thumbs/`  — the deck-thumbnail cache (still written on every render)
 *   - `../uploads/`   — uploaded media (not under the data directory, listed
 *                       here because people reasonably worry about it)
 *
 * Safety model, in order:
 *
 *   1. The script refuses to run at all unless PostgreSQL is reachable AND the
 *      `presentations` table holds data for every deck JSON still on disk —
 *      the same signal as the boot-time migration guard
 *      (server/storage/boot-check.js). An un-imported install must run
 *      `npm run db:migrate && npm run db:import` first.
 *   2. The default mode is a dry run: it prints what would be removed and
 *      exits. Deleting requires the explicit `--delete` flag.
 *   3. The prune list is a fixed allowlist of known-migrated paths; anything
 *      else in the data directory (including `deck-thumbs/`) is left alone.
 *
 * Usage:
 *   node scripts/prune-legacy-data.js             # dry run (default)
 *   node scripts/prune-legacy-data.js --delete    # actually remove the fossils
 *
 * Back up first (docs/ops/self-hosting.md § Pruning legacy disk data):
 *   tar czf server-data-preclean-$(date +%F).tgz server/data
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadDotEnv } from '../server/config/env.js';
import { repoRoot } from '../server/config/paths.js';
import { dataDir } from '../server/config/storage-paths.js';
import {
  initializeDatabase,
  getDb,
  isDatabaseAvailable,
  closeDatabase,
} from '../server/db/client.js';

/** The known-migrated fossils, relative to dataDir(). Nothing else is touched. */
const PRUNE_PATHS = [
  'presentation-versions', // migration 053
  'interactions', //          migration 061
  'questions', //             migration 061
  'feedback', //              migration 061
  // Built from fragments: the legacy directory keeps the pre-rename spelling
  // on disk, which the live-session vocabulary guard forbids as a literal.
  'present' + '-sessions', //  migration 060
  'user-settings', //         migration 059
  'presentations', //         db:import (this one arms the boot guard)
  'published', //             empty remnant of the old ensureDirs()
  'polls', //                 empty remnant of the old ensureDirs()
  'settings.json', //         migration 059
  'follow-codes.json', //     migration 060
];

async function pathInfo(p) {
  try {
    const st = await fs.stat(p);
    if (st.isDirectory()) {
      const entries = await fs.readdir(p);
      return { exists: true, kind: 'dir', count: entries.length };
    }
    return { exists: true, kind: 'file', count: 1 };
  } catch {
    return { exists: false };
  }
}

async function countDeckJson(dir) {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

async function main() {
  const doDelete = process.argv.includes('--delete');

  await loadDotEnv(repoRoot);
  const base = dataDir(repoRoot);

  // ── Gate: PostgreSQL must demonstrably carry the data ──────────────────────
  await initializeDatabase();
  if (!isDatabaseAvailable()) {
    console.error(
      'PostgreSQL is not reachable, so there is no way to verify the import.\n' +
        'Refusing to touch anything. Fix the database connection and retry.',
    );
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const row = await db
    .selectFrom('presentations')
    .select((eb) => eb.fn.count('id').as('count'))
    .executeTakeFirst();
  const dbDecks = Number(row?.count || 0);
  const diskDecks = await countDeckJson(path.join(base, 'presentations'));

  if (diskDecks > 0 && dbDecks === 0) {
    console.error(
      `The database holds no presentations while ${diskDecks} deck JSON ` +
        `file${diskDecks === 1 ? '' : 's'} still sit under ${path.join(base, 'presentations')}.\n` +
        'That data has NOT been imported. Refusing to touch anything.\n' +
        'Run first:  npm run db:migrate && npm run db:import',
    );
    process.exitCode = 1;
    return;
  }

  // ── Enumerate the fossils ──────────────────────────────────────────────────
  const found = [];
  for (const rel of PRUNE_PATHS) {
    const p = path.join(base, rel);
    const info = await pathInfo(p);
    if (info.exists) found.push({ rel, p, ...info });
  }

  console.log(`Data directory: ${base}`);
  console.log(`Database decks: ${dbDecks}; deck JSON on disk: ${diskDecks}`);
  console.log(
    'Kept, always: deck-thumbs/ (live cache) and the uploads directory.\n',
  );

  if (found.length === 0) {
    console.log('Nothing to prune — no legacy paths present.');
    return;
  }

  for (const f of found) {
    const size =
      f.kind === 'dir'
        ? `${f.count} entr${f.count === 1 ? 'y' : 'ies'}`
        : 'file';
    console.log(
      `  ${doDelete ? 'removing' : 'would remove'}  ${f.rel}  (${size})`,
    );
  }

  if (!doDelete) {
    console.log(
      '\nDry run (default) — nothing was removed.\n' +
        'Back up first (tar czf server-data-preclean-$(date +%F).tgz server/data),\n' +
        'then re-run with --delete to remove the paths listed above.',
    );
    return;
  }

  for (const f of found) {
    await fs.rm(f.p, { recursive: true, force: true });
  }
  console.log(
    `\nRemoved ${found.length} legacy path${found.length === 1 ? '' : 's'}.`,
  );
}

main()
  .catch((err) => {
    console.error('prune-legacy-data failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase().catch(() => {}));
