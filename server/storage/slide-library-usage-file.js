/**
 * File-based storage for per-user slide-library usage.
 *
 * Records when a user first used a library slide or collection as a starting
 * point for a deck (compose or insert-into-existing). It powers the "new to
 * you" signal on the Home building-blocks shelf: a team item the current user
 * has never used shows a badge that disappears after first use.
 *
 * Personal usage across all users shares a single `slide-library-usage.json`
 * store, keyed by (userEmail, itemType, itemId). It stores references only,
 * never slide content.
 */

import path from 'node:path';
import { readJsonIfExists, writeJsonAtomic } from './io.js';
import { dataDir } from '../config/storage-paths.js';
import { cleanStr } from '../../shared/string-utils.js';

const ITEM_TYPES = new Set(['slide', 'collection']);

function nowIso() {
  return new Date().toISOString();
}

function storePath(repoRoot) {
  return path.join(dataDir(repoRoot), 'slide-library-usage.json');
}

async function readStore(p) {
  const parsed = await readJsonIfExists(p);
  const store =
    parsed && typeof parsed === 'object' && Array.isArray(parsed.items)
      ? parsed
      : { v: 1, items: [] };
  return {
    v: Number(store.v) || 1,
    items: Array.isArray(store.items) ? store.items : [],
  };
}

async function writeStore(p, store) {
  await writeJsonAtomic(p, store);
}

function stripInternal(item) {
  return {
    itemType: String(item?.itemType || ''),
    itemId: String(item?.itemId || ''),
    firstUsedAt: String(item?.firstUsedAt || ''),
    useCount: Number(item?.useCount) || 0,
    updatedAt: String(item?.updatedAt || ''),
  };
}

/**
 * Clean an incoming list of usage refs: drop blanks/invalid types, de-duplicate
 * on (type, id), keep first occurrence.
 * @param {unknown} input - [{ type, id }]
 * @returns {Array<{ itemType: string, itemId: string }>}
 */
export function normalizeUsageItems(input) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(input) ? input : []) {
    const itemType = cleanStr(raw?.type, { max: 20 });
    const itemId = cleanStr(raw?.id, { max: 200 });
    if (!ITEM_TYPES.has(itemType) || !itemId) continue;
    const key = `${itemType}:${itemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ itemType, itemId });
  }
  return out;
}

/**
 * List the current user's usage records.
 * @param {string} repoRoot
 * @param {string} userEmail
 * @returns {Promise<{ items: Array<object> }>}
 */
export async function listSlideLibraryUsage(repoRoot, userEmail) {
  const store = await readStore(storePath(repoRoot));
  const owner = cleanStr(userEmail, { max: 320 }).toLowerCase();
  if (!owner) return { items: [] };
  const items = store.items
    .filter((x) => x && typeof x === 'object')
    .filter((x) => String(x.userEmail || '').toLowerCase() === owner)
    .map(stripInternal);
  return { items };
}

/**
 * Record usage of one or more library items for a user. Upserts per
 * (userEmail, itemType, itemId): sets firstUsedAt on first use, increments
 * useCount on repeats, always bumps updatedAt.
 * @param {string} repoRoot
 * @param {string} userEmail
 * @param {Array<{ type, id }>} items
 * @returns {Promise<{ ok: boolean, recorded: number }>}
 */
export async function recordSlideLibraryUsage(repoRoot, userEmail, items) {
  const owner = cleanStr(userEmail, { max: 320 }).toLowerCase();
  const refs = normalizeUsageItems(items);
  if (!owner || !refs.length) return { ok: true, recorded: 0 };

  const p = storePath(repoRoot);
  const store = await readStore(p);
  const ts = nowIso();

  const index = new Map();
  for (const row of store.items) {
    if (!row || typeof row !== 'object') continue;
    const key = `${String(row.userEmail || '').toLowerCase()}:${row.itemType}:${row.itemId}`;
    index.set(key, row);
  }

  for (const { itemType, itemId } of refs) {
    const key = `${owner}:${itemType}:${itemId}`;
    const existing = index.get(key);
    if (existing) {
      existing.useCount = (Number(existing.useCount) || 0) + 1;
      existing.updatedAt = ts;
    } else {
      const row = {
        userEmail: owner,
        itemType,
        itemId,
        firstUsedAt: ts,
        useCount: 1,
        updatedAt: ts,
      };
      store.items.push(row);
      index.set(key, row);
    }
  }

  await writeStore(p, store);
  return { ok: true, recorded: refs.length };
}
