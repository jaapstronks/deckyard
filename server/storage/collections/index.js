/**
 * Slide collections storage facade.
 *
 * A collection is a named, ordered, scoped set of slide-library item ids. It
 * stores references only, never slide content.
 *
 * Every function takes a **storage scope** rather than a bare `repoRoot`, so the
 * organization comes from the caller instead of a hardcoded default — see
 * server/storage/scope.js. `userEmail` stays separate where it appears: it names
 * the subject of a personal-collection operation, not who the write is
 * attributed to.
 *
 * Note the two meanings of the word "scope" in this file: the storage scope
 * (which organization) and a collection's own `scope: 'personal' | 'team'`
 * (who may see it). They are unrelated.
 */

import { getStorage } from '../adapters/index.js';
import { toStorageContext } from '../scope.js';

function cleanName(input) {
  return typeof input?.name === 'string' ? input.name.trim() : '';
}

// ============================================================
// Personal collections
// ============================================================

export async function listPersonalCollections(storageScope, userEmail) {
  const ctx = toStorageContext(storageScope, 'listPersonalCollections', { userEmail });
  const storage = getStorage();
  const items = await storage.listSlideCollections(ctx, {
    scope: 'personal',
    ownerEmail: String(userEmail || '').toLowerCase(),
  });
  return { items };
}

export async function getPersonalCollection(storageScope, userEmail, id) {
  const ctx = toStorageContext(storageScope, 'getPersonalCollection', { userEmail });
  const storage = getStorage();
  const item = await storage.getSlideCollection(id, ctx);
  if (!item || item.scope !== 'personal') return null;
  const owner = String(userEmail || '').toLowerCase();
  if (String(item.ownerEmail || '').toLowerCase() !== owner) return null;
  return item;
}

export async function createPersonalCollection(storageScope, userEmail, input, { actorEmail } = {}) {
  const ctx = toStorageContext(storageScope, 'createPersonalCollection', { userEmail, actorEmail });
  const storage = getStorage();
  if (!cleanName(input)) return { ok: false, reason: 'name_required' };
  const item = await storage.createSlideCollection(
    {
      name: cleanName(input),
      description: input?.description,
      slideIds: input?.slideIds,
      scope: 'personal',
      ownerEmail: String(userEmail || '').toLowerCase(),
    },
    ctx
  );
  if (!item) return { ok: false, reason: 'create_failed' };
  return { ok: true, item };
}

export async function updatePersonalCollection(storageScope, userEmail, id, patch, { actorEmail } = {}) {
  const ctx = toStorageContext(storageScope, 'updatePersonalCollection', { userEmail, actorEmail });
  const storage = getStorage();
  // Ownership check: only the owner may mutate their personal collection.
  const existing = await storage.getSlideCollection(id, ctx);
  const owner = String(userEmail || '').toLowerCase();
  if (
    !existing ||
    existing.scope !== 'personal' ||
    String(existing.ownerEmail || '').toLowerCase() !== owner
  ) {
    return { ok: false, reason: 'not_found' };
  }
  const item = await storage.updateSlideCollection(id, patch, ctx);
  if (!item) return { ok: false, reason: 'not_found' };
  return { ok: true, item };
}

export async function deletePersonalCollection(storageScope, userEmail, id) {
  const ctx = toStorageContext(storageScope, 'deletePersonalCollection', { userEmail });
  const storage = getStorage();
  const existing = await storage.getSlideCollection(id, ctx);
  const owner = String(userEmail || '').toLowerCase();
  if (
    !existing ||
    existing.scope !== 'personal' ||
    String(existing.ownerEmail || '').toLowerCase() !== owner
  ) {
    return { ok: false, reason: 'not_found' };
  }
  const deleted = await storage.deleteSlideCollection(id, ctx);
  if (!deleted) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

// ============================================================
// Team collections
// ============================================================

export async function listTeamCollections(storageScope, { userEmail = '' } = {}) {
  const ctx = toStorageContext(storageScope, 'listTeamCollections', { userEmail });
  const storage = getStorage();
  const items = await storage.listSlideCollections(ctx, { scope: 'team' });
  return { items };
}

export async function getTeamCollection(storageScope, id, { userEmail = '' } = {}) {
  const ctx = toStorageContext(storageScope, 'getTeamCollection', { userEmail });
  const storage = getStorage();
  const item = await storage.getSlideCollection(id, ctx);
  if (!item || item.scope !== 'team') return null;
  return item;
}

export async function createTeamCollection(storageScope, input, { actorEmail } = {}) {
  const ctx = toStorageContext(storageScope, 'createTeamCollection', { actorEmail });
  const storage = getStorage();
  if (!cleanName(input)) return { ok: false, reason: 'name_required' };
  const item = await storage.createSlideCollection(
    {
      name: cleanName(input),
      description: input?.description,
      slideIds: input?.slideIds,
      scope: 'team',
    },
    ctx
  );
  if (!item) return { ok: false, reason: 'create_failed' };
  return { ok: true, item };
}

export async function updateTeamCollection(storageScope, id, patch, { actorEmail, allowMutate } = {}) {
  const ctx = toStorageContext(storageScope, 'updateTeamCollection', { actorEmail });
  const storage = getStorage();
  const existing = await storage.getSlideCollection(id, ctx);
  if (!existing || existing.scope !== 'team') return { ok: false, reason: 'not_found' };
  if (typeof allowMutate === 'function') {
    const ok = await allowMutate(existing, { actorEmail });
    if (!ok) return { ok: false, reason: 'forbidden' };
  }
  const item = await storage.updateSlideCollection(id, patch, ctx);
  if (!item) return { ok: false, reason: 'not_found' };
  return { ok: true, item };
}

export async function deleteTeamCollection(storageScope, id, { actorEmail, allowMutate } = {}) {
  const ctx = toStorageContext(storageScope, 'deleteTeamCollection', { actorEmail });
  const storage = getStorage();
  const existing = await storage.getSlideCollection(id, ctx);
  if (!existing || existing.scope !== 'team') return { ok: false, reason: 'not_found' };
  if (typeof allowMutate === 'function') {
    const ok = await allowMutate(existing, { actorEmail });
    if (!ok) return { ok: false, reason: 'forbidden' };
  }
  const deleted = await storage.deleteSlideCollection(id, ctx);
  if (!deleted) return { ok: false, reason: 'not_found' };
  return { ok: true };
}
