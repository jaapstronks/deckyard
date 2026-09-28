#!/usr/bin/env node
/**
 * One-time move of uploaded font variants into private media storage (B510).
 * Run after `npm run db:migrate` (migration 088), with the server's own env.
 *
 *   node scripts/privatize-font-variants.js --check
 *   node scripts/privatize-font-variants.js --apply
 *
 * Before B510 an uploaded variant was a public object (`uploads/…` in a bucket,
 * or a file under `/uploads/`). Now every uploaded variant is a private object
 * (`private/fonts/…`) that the app serves at `/fonts/managed/`, and migration
 * 088 dropped the stored public URL. A variant whose `filename` still holds a
 * public key has no served URL until this script moves it.
 *
 * Per variant, --apply: read the old object through the media provider, write
 * it as a private object, point the row at the new key, then delete the old
 * object. A variant whose old object is missing is reported and left alone
 * (re-upload it); nothing is invented. A second run finds nothing to do.
 * --check is read-only and exits 1 when anything is left to move.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCli } from './lib/is-cli.js';
import { loadDotEnv } from '../server/config/env.js';
import { isPrivateKey } from '../server/media/interface.js';
import { MANAGED_FONT_FOLDER } from '../server/media/managed-fonts.js';

const FONT_MIME = { woff2: 'font/woff2', woff: 'font/woff' };

/**
 * Upload-source variants whose file is not yet a private object.
 * @param {import('kysely').Kysely<any>} db
 */
export async function listPublicFontVariants(db) {
  const rows = await db
    .selectFrom('font_variants')
    .innerJoin(
      'font_families',
      'font_families.id',
      'font_variants.font_family_id',
    )
    .select([
      'font_variants.id',
      'font_variants.filename',
      'font_variants.format',
      'font_variants.weight',
      'font_variants.style',
      'font_families.slug',
    ])
    .where('font_families.source', '=', 'upload')
    .execute();
  return rows.filter((r) => r.filename && !isPrivateKey(r.filename));
}

/**
 * Move each public variant into private storage.
 * @param {import('kysely').Kysely<any>} db
 * @param {import('../server/media/interface.js').MediaProvider} provider
 * @param {{ apply: boolean }} opts
 * @returns {Promise<{ pending: number, moved: string[], missing: string[] }>}
 */
export async function privatizeFontVariants(db, provider, { apply }) {
  const rows = await listPublicFontVariants(db);
  const moved = [];
  const missing = [];
  if (!apply) return { pending: rows.length, moved, missing };

  for (const row of rows) {
    const buffer = await provider.readFile(row.filename);
    if (!buffer) {
      missing.push(`${row.id} (${row.filename})`);
      continue;
    }
    const { key } = await provider.uploadPrivateBuffer({
      buffer,
      filename: `${row.slug}-${row.weight}-${row.style}`,
      contentType: FONT_MIME[row.format] || FONT_MIME.woff2,
      folder: MANAGED_FONT_FOLDER,
    });
    await db
      .updateTable('font_variants')
      .set({ filename: key })
      .where('id', '=', row.id)
      .execute();
    // Only once the row points at the private copy does the public one go.
    await provider.deleteFile(row.filename);
    moved.push(`${row.id}: ${row.filename} → ${key}`);
  }
  return { pending: rows.length - moved.length, moved, missing };
}

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const check = argv.includes('--check');
  if (apply === check) {
    throw new Error('Pass exactly one of --check or --apply.');
  }
  return { apply };
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );
  await loadDotEnv(repoRoot);
  const { initializeDatabase, closeDatabase } =
    await import('../server/db/client.js');
  const { initializeMediaProvider, getMediaProvider } =
    await import('../server/media/index.js');
  const db = await initializeDatabase();
  try {
    await initializeMediaProvider(repoRoot);
    const report = await privatizeFontVariants(db, getMediaProvider(), {
      apply,
    });
    for (const line of report.moved) console.log(`moved ${line}`);
    for (const line of report.missing)
      console.error(`missing file, left as is: ${line}`);
    if (!apply) {
      console.log(`${report.pending} variant(s) to move.`);
      if (report.pending) process.exitCode = 1;
    } else if (report.missing.length) {
      process.exitCode = 1;
    } else {
      console.log('Applied.');
    }
  } finally {
    await closeDatabase();
  }
}

if (isCli(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
