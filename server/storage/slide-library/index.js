/**
 * Slide library storage facade.
 *
 * Every function takes a **storage scope** rather than a bare `repoRoot`, so the
 * organization comes from the caller instead of a hardcoded default — see
 * server/storage/scope.js. A team library is a workspace's shared shelf, so
 * reading it out of the wrong organization is exactly what this removes.
 *
 * `userEmail` stays a separate argument where it appears: it names the *subject*
 * of a personal-library operation, which is not the same question as who the
 * scope attributes the write to (`actorEmail`).
 */

import { getStorage } from '../adapters/index.js';
import { toStorageContext } from '../backend-dispatch.js';
import { nowIso } from '../../utils/normalize.js';

// Personal library functions

export async function listPersonalLibrary(scope, userEmail, { themeId = '' } = {}) {
  const ctx = toStorageContext(scope, 'listPersonalLibrary', { userEmail });
  const storage = getStorage();
  const items = await storage.listSlideLibrary(ctx, { scope: 'personal', ownerEmail: userEmail, themeId });
  return { items };
}

export async function createPersonalLibraryItem(scope, userEmail, input, { actorEmail } = {}) {
  const ctx = toStorageContext(scope, 'createPersonalLibraryItem', { userEmail, actorEmail });
  const storage = getStorage();
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const slideType = typeof input?.slideType === 'string' ? input.slideType.trim() : '';
  if (!name) return { ok: false, reason: 'name_required' };
  if (!slideType) return { ok: false, reason: 'slideType_required' };
  const result = await storage.createSlideLibraryItem({
    ...input,
    scope: 'personal',
    ownerEmail: userEmail,
  }, ctx);
  if (!result) return { ok: false, reason: 'create_failed' };
  return { ok: true, item: result };
}

export async function updatePersonalLibraryItem(scope, userEmail, id, patch, { actorEmail } = {}) {
  const ctx = toStorageContext(scope, 'updatePersonalLibraryItem', { userEmail, actorEmail });
  const storage = getStorage();
  const normalizedPatch = { ...patch };
  if ('trashed' in patch) {
    normalizedPatch.trashedAt = patch.trashed ? nowIso() : null;
    normalizedPatch.trashedBy = patch.trashed ? (actorEmail || userEmail) : null;
    delete normalizedPatch.trashed;
  }
  const result = await storage.updateSlideLibraryItem(id, normalizedPatch, ctx);
  if (!result) return { ok: false, reason: 'not_found' };
  return { ok: true, item: result };
}

export async function deletePersonalLibraryItem(scope, userEmail, id) {
  const ctx = toStorageContext(scope, 'deletePersonalLibraryItem', { userEmail });
  const storage = getStorage();
  const deleted = await storage.deleteSlideLibraryItem(id, ctx);
  if (!deleted) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

// Team library functions

export async function listTeamLibrary(scope, { themeId = '', userEmail = '' } = {}) {
  const ctx = toStorageContext(scope, 'listTeamLibrary', { userEmail });
  const storage = getStorage();
  const items = await storage.listSlideLibrary(ctx, { scope: 'team', themeId });
  return { items };
}

export async function getTeamLibraryItem(scope, id, { userEmail = '' } = {}) {
  const ctx = toStorageContext(scope, 'getTeamLibraryItem', { userEmail });
  const storage = getStorage();
  const item = await storage.getSlideLibraryItem(id, ctx);
  if (!item || item.scope !== 'team') return null;
  return item;
}

export async function createTeamLibraryItem(scope, input, { actorEmail } = {}) {
  const ctx = toStorageContext(scope, 'createTeamLibraryItem', { actorEmail });
  const storage = getStorage();
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const slideType = typeof input?.slideType === 'string' ? input.slideType.trim() : '';
  if (!name) return { ok: false, reason: 'name_required' };
  if (!slideType) return { ok: false, reason: 'slideType_required' };
  const result = await storage.createSlideLibraryItem({
    ...input,
    scope: 'team',
  }, ctx);
  if (!result) return { ok: false, reason: 'create_failed' };
  return { ok: true, item: result };
}

export async function updateTeamLibraryItem(scope, id, patch, { actorEmail } = {}) {
  const ctx = toStorageContext(scope, 'updateTeamLibraryItem', { actorEmail });
  const storage = getStorage();
  const result = await storage.updateSlideLibraryItem(id, patch, ctx);
  if (!result) return { ok: false, reason: 'not_found' };
  return { ok: true, item: result };
}

export async function setTeamLibraryItemTrashed(scope, id, { trashed, actorEmail, allowTrash } = {}) {
  const ctx = toStorageContext(scope, 'setTeamLibraryItemTrashed', { actorEmail });
  const storage = getStorage();
  if (typeof allowTrash === 'function') {
    const items = await storage.listSlideLibrary(ctx, { scope: 'team' });
    const item = items.find((x) => String(x?.id || '') === String(id || ''));
    if (!item) return { ok: false, reason: 'not_found' };
    const ok = await allowTrash(item, { actorEmail });
    if (!ok) return { ok: false, reason: 'forbidden' };
  }
  const result = await storage.updateSlideLibraryItem(id, {
    trashedAt: trashed ? nowIso() : null,
    trashedBy: trashed ? actorEmail : null,
  }, ctx);
  if (!result) return { ok: false, reason: 'not_found' };
  return { ok: true, item: result };
}

export async function deleteTeamLibraryItem(scope, id, { actorEmail, allowDelete } = {}) {
  const ctx = toStorageContext(scope, 'deleteTeamLibraryItem', { actorEmail });
  const storage = getStorage();
  if (typeof allowDelete === 'function') {
    const items = await storage.listSlideLibrary(ctx, { scope: 'team' });
    const item = items.find((x) => String(x?.id || '') === String(id || ''));
    if (!item) return { ok: false, reason: 'not_found' };
    const ok = await allowDelete(item, { actorEmail });
    if (!ok) return { ok: false, reason: 'forbidden' };
  }
  const deleted = await storage.deleteSlideLibraryItem(id, ctx);
  if (!deleted) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

// Slide library tag functions

export async function getTagsForSlideLibraryItem(scope, id, { userEmail } = {}) {
  const ctx = toStorageContext(scope, 'getTagsForSlideLibraryItem', { userEmail });
  const storage = getStorage();
  return storage.getTagsForSlideLibraryItem(id, ctx);
}

export async function getTagsForSlideLibraryItems(scope, ids, { userEmail } = {}) {
  const ctx = toStorageContext(scope, 'getTagsForSlideLibraryItems', { userEmail });
  const storage = getStorage();
  return storage.getTagsForSlideLibraryItems(ids, ctx);
}

export async function setTagsForSlideLibraryItem(scope, id, tagNames, { userEmail } = {}) {
  const ctx = toStorageContext(scope, 'setTagsForSlideLibraryItem', { userEmail });
  const storage = getStorage();
  return storage.setTagsForSlideLibraryItem(id, tagNames, ctx);
}