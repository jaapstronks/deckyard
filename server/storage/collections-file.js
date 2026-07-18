/**
 * File-based storage for slide collections.
 *
 * A collection is a named, ordered, scoped set of slide-library item ids. It
 * stores only references (ids), never slide content. Personal and team
 * collections share a single `slide-collections.json` store and are separated
 * by the `scope` field (personal rows also carry `ownerEmail`), mirroring how
 * the file storage adapter treats the slide library.
 */

import path from 'node:path';
import crypto from 'node:crypto';
import { readJsonIfExists, writeJsonAtomic } from './io.js';
import { dataDir } from '../config/storage-paths.js';
import { cleanStr } from '../../shared/string-utils.js';

function nowIso() {
  return new Date().toISOString();
}

function storePath(repoRoot) {
  return path.join(dataDir(repoRoot), 'slide-collections.json');
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

/**
 * Clean an ordered list of slide ids: drop blanks, de-duplicate, keep order.
 * @param {unknown} input
 * @returns {string[]}
 */
export function normalizeSlideIds(input) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(input) ? input : []) {
    const id = cleanStr(raw, { max: 200 });
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function normalizeInput(input) {
  return {
    name: cleanStr(input?.name, { max: 120 }),
    description: cleanStr(input?.description, { max: 500 }),
    slideIds: normalizeSlideIds(input?.slideIds),
  };
}

function stripInternal(item) {
  return {
    id: String(item?.id || ''),
    scope: String(item?.scope || ''),
    ownerEmail: item?.ownerEmail || null,
    name: String(item?.name || ''),
    description: String(item?.description || ''),
    slideIds: Array.isArray(item?.slideIds) ? item.slideIds.map(String) : [],
    slideCount: Array.isArray(item?.slideIds) ? item.slideIds.length : 0,
    createdBy: item?.createdBy || null,
    updatedBy: item?.updatedBy || null,
    createdAt: String(item?.createdAt || ''),
    updatedAt: String(item?.updatedAt || ''),
  };
}

// ============================================================
// Bulk helpers (used by the file storage adapter)
// ============================================================

export async function getSlideCollections(repoRoot) {
  return readStore(storePath(repoRoot));
}

export async function saveSlideCollections(repoRoot, store) {
  return writeStore(storePath(repoRoot), store);
}

// ============================================================
// Personal collections
// ============================================================

export async function listPersonalCollections(repoRoot, userEmail) {
  const store = await readStore(storePath(repoRoot));
  const owner = cleanStr(userEmail, { max: 320 }).toLowerCase();
  const items = store.items
    .filter((x) => x && typeof x === 'object' && x.scope === 'personal')
    .filter((x) => String(x.ownerEmail || '').toLowerCase() === owner)
    .map(stripInternal);
  return { items };
}

export async function getPersonalCollection(repoRoot, userEmail, id) {
  const { items } = await listPersonalCollections(repoRoot, userEmail);
  return items.find((x) => x.id === String(id || '')) || null;
}

export async function createPersonalCollection(repoRoot, userEmail, input, { actorEmail } = {}) {
  const p = storePath(repoRoot);
  const store = await readStore(p);
  const { name, description, slideIds } = normalizeInput(input);
  if (!name) return { ok: false, reason: 'name_required' };

  const ts = nowIso();
  const actor = cleanStr(actorEmail || userEmail, { max: 320 });
  const item = {
    id: crypto.randomUUID(),
    scope: 'personal',
    ownerEmail: cleanStr(userEmail, { max: 320 }).toLowerCase(),
    name,
    description,
    slideIds,
    createdBy: actor,
    updatedBy: actor,
    createdAt: ts,
    updatedAt: ts,
  };
  store.items = [item, ...store.items];
  await writeStore(p, store);
  return { ok: true, item: stripInternal(item) };
}

export async function updatePersonalCollection(repoRoot, userEmail, id, patch, { actorEmail } = {}) {
  const p = storePath(repoRoot);
  const store = await readStore(p);
  const owner = cleanStr(userEmail, { max: 320 }).toLowerCase();
  const idx = store.items.findIndex(
    (x) =>
      String(x?.id || '') === String(id || '') &&
      x?.scope === 'personal' &&
      String(x?.ownerEmail || '').toLowerCase() === owner
  );
  if (idx < 0) return { ok: false, reason: 'not_found' };

  const next = applyPatch(store.items[idx], patch, actorEmail || userEmail);
  store.items[idx] = next;
  await writeStore(p, store);
  return { ok: true, item: stripInternal(next) };
}

export async function deletePersonalCollection(repoRoot, userEmail, id) {
  const p = storePath(repoRoot);
  const store = await readStore(p);
  const owner = cleanStr(userEmail, { max: 320 }).toLowerCase();
  const before = store.items.length;
  store.items = store.items.filter(
    (x) =>
      !(
        String(x?.id || '') === String(id || '') &&
        x?.scope === 'personal' &&
        String(x?.ownerEmail || '').toLowerCase() === owner
      )
  );
  if (store.items.length === before) return { ok: false, reason: 'not_found' };
  await writeStore(p, store);
  return { ok: true };
}

// ============================================================
// Team collections
// ============================================================

export async function listTeamCollections(repoRoot) {
  const store = await readStore(storePath(repoRoot));
  const items = store.items
    .filter((x) => x && typeof x === 'object' && x.scope === 'team')
    .map(stripInternal);
  return { items };
}

export async function getTeamCollection(repoRoot, id) {
  const { items } = await listTeamCollections(repoRoot);
  return items.find((x) => x.id === String(id || '')) || null;
}

export async function createTeamCollection(repoRoot, input, { actorEmail } = {}) {
  const p = storePath(repoRoot);
  const store = await readStore(p);
  const { name, description, slideIds } = normalizeInput(input);
  if (!name) return { ok: false, reason: 'name_required' };

  const ts = nowIso();
  const actor = cleanStr(actorEmail, { max: 320 });
  const item = {
    id: crypto.randomUUID(),
    scope: 'team',
    ownerEmail: null,
    name,
    description,
    slideIds,
    createdBy: actor,
    updatedBy: actor,
    createdAt: ts,
    updatedAt: ts,
  };
  store.items = [item, ...store.items];
  await writeStore(p, store);
  return { ok: true, item: stripInternal(item) };
}

export async function updateTeamCollection(repoRoot, id, patch, { actorEmail, allowMutate } = {}) {
  const p = storePath(repoRoot);
  const store = await readStore(p);
  const idx = store.items.findIndex(
    (x) => String(x?.id || '') === String(id || '') && x?.scope === 'team'
  );
  if (idx < 0) return { ok: false, reason: 'not_found' };
  if (typeof allowMutate === 'function') {
    const ok = await allowMutate(store.items[idx], { actorEmail });
    if (!ok) return { ok: false, reason: 'forbidden' };
  }

  const next = applyPatch(store.items[idx], patch, actorEmail);
  store.items[idx] = next;
  await writeStore(p, store);
  return { ok: true, item: stripInternal(next) };
}

export async function deleteTeamCollection(repoRoot, id, { actorEmail, allowMutate } = {}) {
  const p = storePath(repoRoot);
  const store = await readStore(p);
  const idx = store.items.findIndex(
    (x) => String(x?.id || '') === String(id || '') && x?.scope === 'team'
  );
  if (idx < 0) return { ok: false, reason: 'not_found' };
  if (typeof allowMutate === 'function') {
    const ok = await allowMutate(store.items[idx], { actorEmail });
    if (!ok) return { ok: false, reason: 'forbidden' };
  }
  store.items.splice(idx, 1);
  await writeStore(p, store);
  return { ok: true };
}

function applyPatch(prev, patch, actorEmail) {
  const next = { ...prev };
  if (patch && typeof patch === 'object') {
    if ('name' in patch) next.name = cleanStr(patch.name, { max: 120 }) || next.name;
    if ('description' in patch) next.description = cleanStr(patch.description, { max: 500 });
    if ('slideIds' in patch) next.slideIds = normalizeSlideIds(patch.slideIds);
  }
  next.updatedAt = nowIso();
  next.updatedBy = cleanStr(actorEmail, { max: 320 });
  return next;
}
