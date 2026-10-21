#!/usr/bin/env node
/**
 * One-time sweep of generated OG previews left on a remote origin (B806).
 * Run with the server's own env:
 *
 *   node scripts/sweep-published-previews.js --check
 *   node scripts/sweep-published-previews.js --apply
 *
 * Since B806 the publish service withdraws a generated preview from the bucket
 * when a publish replaces it, on unpublish, and once its proof expires. Objects
 * from before that are still public there. This sweep lists the bucket's
 * `uploads/` objects whose name the OG generator minted
 * (`isPublishedPreviewAssetName`) and deletes each one that is not the proven
 * preview of a live publication (`safePublishedOgImage`). Any other upload is
 * never listed. Objects younger than an hour are left for the next run, so a
 * publish in flight keeps the image it is about to store.
 *
 * The local provider sweeps nothing: its own route refuses an unproven preview
 * and the files stay (docs/reference/viewer-read-data.md). --check is
 * read-only and exits 1 when anything is left to delete.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCli } from './lib/is-cli.js';
import { loadDotEnv } from '../server/config/env.js';
import {
  isPublishedPreviewAssetName,
  safePublishedOgImage,
} from '../server/render/og-image.js';

/** A preview this young may belong to a publish that has not stored it yet. */
export const SWEEP_GRACE_MS = 60 * 60 * 1000;

const baseName = (s) => String(s).split(/[?#]/)[0].split('/').pop();

/**
 * File names of the previews live publications still prove, across every
 * organization: a public URL is not scoped, so neither is the sweep.
 * @param {import('kysely').Kysely<any>} db
 * @param {(presentationId: string) => Promise<object|null>} loadPresentation
 * @returns {Promise<Set<string>>}
 */
export async function provenPreviewNames(db, loadPresentation) {
  const rows = await db
    .selectFrom('published_presentations')
    .select(['presentation_id', 'og_image_url'])
    .execute();
  const names = new Set();
  for (const row of rows) {
    const url = row.og_image_url;
    if (!url) continue;
    const pres = await loadPresentation(row.presentation_id);
    if (pres && safePublishedOgImage(pres, url) === url) {
      names.add(baseName(url));
    }
  }
  return names;
}

/**
 * List (and with `apply`, delete) the generated previews nothing proves.
 * @param {{ listObjects: (prefix: string) => AsyncIterable<{ key: string, lastModified: Date|null }>, deleteFile: (key: string) => Promise<boolean> }} provider
 * @param {Set<string>} proven - from {@link provenPreviewNames}
 * @param {{ apply: boolean, now?: number }} opts
 * @returns {Promise<{ stale: string[], deleted: string[], failed: string[] }>}
 */
export async function sweepPublishedPreviews(
  provider,
  proven,
  { apply, now = Date.now() },
) {
  const stale = [];
  for await (const { key, lastModified } of provider.listObjects('uploads/')) {
    const name = baseName(key);
    if (!isPublishedPreviewAssetName(name) || proven.has(name)) continue;
    if (lastModified && now - new Date(lastModified).getTime() < SWEEP_GRACE_MS)
      continue;
    stale.push(key);
  }
  const deleted = [];
  const failed = [];
  if (apply) {
    for (const key of stale) {
      ((await provider.deleteFile(key)) ? deleted : failed).push(key);
    }
  }
  return { stale, deleted, failed };
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
  const { getPresentation } =
    await import('../server/storage/presentations/index.js');
  const { crossOrganizationScope } = await import('../server/storage/scope.js');
  const db = await initializeDatabase();
  try {
    await initializeMediaProvider(repoRoot);
    const provider = getMediaProvider();
    if (typeof provider.listObjects !== 'function') {
      console.log(
        `The ${provider.getStatus().name} provider serves previews through the app's own route; nothing to sweep.`,
      );
      return;
    }
    const scope = crossOrganizationScope(
      repoRoot,
      'preview sweep: a public preview URL is not organization-scoped',
    );
    const proven = await provenPreviewNames(db, (id) =>
      getPresentation(scope, id),
    );
    const report = await sweepPublishedPreviews(provider, proven, { apply });
    if (!apply) {
      for (const key of report.stale) console.log(`stale ${key}`);
      console.log(`${report.stale.length} generated preview(s) to delete.`);
      if (report.stale.length) process.exitCode = 1;
      return;
    }
    for (const key of report.deleted) console.log(`deleted ${key}`);
    for (const key of report.failed) console.error(`failed ${key}`);
    if (report.failed.length) process.exitCode = 1;
    else console.log('Applied.');
  } finally {
    await closeDatabase();
  }
}

if (isCli(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
