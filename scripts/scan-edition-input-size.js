#!/usr/bin/env node

/**
 * Estimate how large each deck's frozen-edition request would be, against the
 * renderer runner's 16 MiB request limit (T1 activation review, A3).
 *
 * `deckyard.edition-input/1` carries every asset as an inline data URL, so an
 * imported PDF of thirty pages is tens of MiB before the runner sees it. Raise
 * the limit, change the asset form, or keep both: that is decided on this
 * measurement, not on a guess. Per deck the estimate is the public projection
 * of its slide lists (`slides` and every `i18n` version, as a reader gets
 * them) serialized as JSON, plus the bytes of every distinct served asset it
 * references (`/uploads/`, `/assets/`, `/custom/assets/`) times 4/3 for
 * base64.
 *
 * What it leaves out, so the number is a lower bound: the theme record and
 * the embedded font CSS, a second inlining of an image the deck references
 * twice, and assets it cannot read from this installation's disk (S3 or remote
 * URLs, counted as unresolved).
 *
 * Read-only. It writes nothing and exits 0 whatever it finds - it is a
 * measurement, not a gate. It exits 1 only when it cannot read the database.
 *
 * Usage:
 *   node scripts/scan-edition-input-size.js           # Postgres, via .env
 *   node scripts/scan-edition-input-size.js --json    # the same, as JSON
 */

import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { isCli } from './lib/is-cli.js';
import { loadDotEnv } from '../server/config/env.js';
import { createMigrationDb } from '../server/db/migrate.js';
import { REQUEST_LIMIT } from '../server/render/renderer-bundle/runner/protocol.js';
import { filterForPublished } from '../server/utils/public-output.js';
import { resolveServedAssetPath } from '../server/utils/served-asset-path.js';
import { collectServedAssetRefs } from '../shared/slide-types/deck-assets.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** The runner's request limit. */
export const EDITION_REQUEST_LIMIT = REQUEST_LIMIT;

/**
 * The size estimate of one deck.
 * @param {{ slides?: any, i18n?: any }} deck - The stored slide lists
 * @param {(ref: string) => Promise<number|null>} assetBytes - Byte size of a
 *   served ref, or null when it cannot be read here
 * @returns {Promise<{ bytes: number, jsonBytes: number, assetBytes: number, assets: number, unresolved: number }>}
 */
export async function estimateEditionInput(deck, assetBytes) {
  const projected = filterForPublished({
    slides: Array.isArray(deck?.slides) ? deck.slides : [],
    i18n: deck?.i18n ?? undefined,
  });
  const lists = { slides: projected.slides, i18n: projected.i18n };
  const jsonBytes = Buffer.byteLength(JSON.stringify(lists));
  const refs = new Set(collectServedAssetRefs({ slides: lists.slides }));
  for (const version of Object.values(lists.i18n?.versions || {}))
    for (const ref of collectServedAssetRefs(version)) refs.add(ref);
  let raw = 0;
  let unresolved = 0;
  for (const ref of refs) {
    const size = await assetBytes(ref);
    if (size == null) unresolved += 1;
    else raw += size;
  }
  const encoded = Math.ceil((raw * 4) / 3);
  return {
    bytes: jsonBytes + encoded,
    jsonBytes,
    assetBytes: encoded,
    assets: refs.size,
    unresolved,
  };
}

/**
 * Max, p95 (nearest rank) and the count above the limit.
 * @param {number[]} sizes
 */
export function summarizeSizes(sizes, limit = EDITION_REQUEST_LIMIT) {
  const sorted = [...sizes].sort((a, b) => a - b);
  const p95 = sorted.length
    ? sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]
    : 0;
  return {
    decks: sorted.length,
    max: sorted.at(-1) ?? 0,
    p95,
    overLimit: sorted.filter((n) => n > limit).length,
    limit,
  };
}

/** Byte size of a served ref on this installation's disk. */
async function diskAssetBytes(ref) {
  const resolved = resolveServedAssetPath(REPO_ROOT, ref);
  if (!resolved) return null;
  try {
    return (await stat(resolved.path)).size;
  } catch {
    return null;
  }
}

const mib = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`;

async function main() {
  const { values } = parseArgs({ options: { json: { type: 'boolean' } } });
  await loadDotEnv(REPO_ROOT);
  const db = await createMigrationDb();
  let rows;
  try {
    rows = await db
      .selectFrom('presentations')
      .select(['id', 'title', 'slides', 'i18n'])
      .execute();
  } finally {
    await db.destroy();
  }

  const decks = [];
  for (const row of rows)
    decks.push({
      id: row.id,
      title: row.title ?? '',
      ...(await estimateEditionInput(row, diskAssetBytes)),
    });
  const summary = summarizeSizes(decks.map((d) => d.bytes));
  const over = decks
    .filter((d) => d.bytes > summary.limit)
    .sort((a, b) => b.bytes - a.bytes);
  const unresolved = decks.reduce((n, d) => n + d.unresolved, 0);

  if (values.json) {
    process.stdout.write(
      `${JSON.stringify({ ...summary, unresolved, over }, null, 2)}\n`,
    );
    return;
  }
  console.log(`Decks over ${mib(summary.limit)}:\n`);
  for (const d of over)
    console.log(`  ${d.id}  ${mib(d.bytes)}  (${d.assets} assets)  ${d.title}`);
  if (!over.length) console.log('  (none)');
  console.log(
    `\n${summary.decks} decks: max ${mib(summary.max)}, p95 ${mib(summary.p95)}, ` +
      `${summary.overLimit} over the limit. ${unresolved} asset refs not readable here.`,
  );
}

// Only run as a CLI; importing the module (tests) must not touch any store.
if (isCli(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
