#!/usr/bin/env node
/**
 * Sweep of the OG previews generated for publications before editions (B806,
 * T1.5). Run with the server's own env, after
 * `scripts/migrate-publications-to-editions.js --apply`:
 *
 *   node scripts/sweep-published-previews.js --check
 *   node scripts/sweep-published-previews.js --apply
 *
 * Until T1.5 a publish rendered a preview image of the deck's first slide and
 * stored it on the media origin, where it was public. An edition shows its
 * own preview from its own bytes (`/p/{publicationId}/{version}/og`), so no
 * generated preview belongs to anything any more. This sweep lists the bucket's
 * `uploads/` objects whose name the old OG generator minted
 * (`isPublishedPreviewAssetName`) and deletes them. Any other upload is never
 * listed. Objects younger than an hour are left for the next run.
 *
 * The local provider sweeps nothing: the static route refuses every generated
 * preview and the files stay on disk. --check is read-only and exits 1 when
 * anything is left to delete.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCli } from './lib/is-cli.js';
import { loadDotEnv } from '../server/config/env.js';
import { isPublishedPreviewAssetName } from '../server/render/og-image.js';

/** A preview this young may belong to a publish that has not stored it yet. */
export const SWEEP_GRACE_MS = 60 * 60 * 1000;

const baseName = (s) => String(s).split(/[?#]/)[0].split('/').pop();

/**
 * List (and with `apply`, delete) the generated previews.
 * @param {{ listObjects: (prefix: string) => AsyncIterable<{ key: string, lastModified: Date|null }>, deleteFile: (key: string) => Promise<boolean> }} provider
 * @param {{ apply: boolean, now?: number }} opts
 * @returns {Promise<{ stale: string[], deleted: string[], failed: string[] }>}
 */
export async function sweepPublishedPreviews(
  provider,
  { apply, now = Date.now() },
) {
  const stale = [];
  for await (const { key, lastModified } of provider.listObjects('uploads/')) {
    if (!isPublishedPreviewAssetName(baseName(key))) continue;
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
  const { initializeMediaProvider, getMediaProvider } =
    await import('../server/media/index.js');
  await initializeMediaProvider(repoRoot);
  const provider = getMediaProvider();
  if (typeof provider.listObjects !== 'function') {
    console.log(
      `The ${provider.getStatus().name} provider never serves a generated preview; nothing to sweep.`,
    );
    return;
  }
  const report = await sweepPublishedPreviews(provider, { apply });
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
}

if (isCli(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
