/**
 * Slide library storage facade.
 * Uses storage adapter when initialized, falls back to file-based storage.
 */

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { getDefaultOrganizationId } from '../config/database.js';
import { nowIso } from '../utils/normalize.js';

/**
 * Get the context for storage operations.
 * @param {Object} opts
 * @returns {Object} Context with organizationId
 */
function getStorageContext(opts = {}) {
  return {
    organizationId: getDefaultOrganizationId(),
    actorEmail: opts.actorEmail || opts.userEmail || null,
  };
}

/**
 * Higher-order function to handle storage fallback pattern.
 * Executes pgFn if storage is initialized, otherwise falls back to fileFn.
 * @param {Function} pgFn - Function to execute with postgres storage (receives storage, ctx)
 * @param {Function} fileFn - Function to execute with file-based storage
 * @returns {Promise<any>}
 */
async function withStorageFallback(pgFn, fileFn) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    return pgFn(storage);
  }
  const mod = await import('./slide-library-file.js');
  return fileFn(mod);
}

// Personal library functions

export async function listPersonalLibrary(repoRoot, userEmail, { themeId = '' } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail });
      const items = await storage.listSlideLibrary(ctx, { scope: 'personal', ownerEmail: userEmail, themeId });
      return { items };
    },
    (mod) => mod.listPersonalLibrary(repoRoot, userEmail, { themeId })
  );
}

export async function createPersonalLibraryItem(repoRoot, userEmail, input, { actorEmail } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail, actorEmail });
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
    },
    (mod) => mod.createPersonalLibraryItem(repoRoot, userEmail, input, { actorEmail })
  );
}

export async function updatePersonalLibraryItem(repoRoot, userEmail, id, patch, { actorEmail } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail, actorEmail });
      const normalizedPatch = { ...patch };
      if ('trashed' in patch) {
        normalizedPatch.trashedAt = patch.trashed ? nowIso() : null;
        normalizedPatch.trashedBy = patch.trashed ? (actorEmail || userEmail) : null;
        delete normalizedPatch.trashed;
      }
      const result = await storage.updateSlideLibraryItem(id, normalizedPatch, ctx);
      if (!result) return { ok: false, reason: 'not_found' };
      return { ok: true, item: result };
    },
    (mod) => mod.updatePersonalLibraryItem(repoRoot, userEmail, id, patch, { actorEmail })
  );
}

export async function deletePersonalLibraryItem(repoRoot, userEmail, id) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail });
      const deleted = await storage.deleteSlideLibraryItem(id, ctx);
      if (!deleted) return { ok: false, reason: 'not_found' };
      return { ok: true };
    },
    (mod) => mod.deletePersonalLibraryItem(repoRoot, userEmail, id)
  );
}

// Team library functions

export async function listTeamLibrary(repoRoot, { themeId = '', userEmail = '' } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail });
      const items = await storage.listSlideLibrary(ctx, { scope: 'team', themeId });
      return { items };
    },
    (mod) => mod.listTeamLibrary(repoRoot, { themeId, userEmail })
  );
}

export async function getTeamLibraryItem(repoRoot, id, { userEmail = '' } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail });
      const item = await storage.getSlideLibraryItem(id, ctx);
      if (!item || item.scope !== 'team') return null;
      return item;
    },
    async (mod) => {
      // File-based storage: list and find
      const { items } = await mod.listTeamLibrary(repoRoot, { userEmail });
      return (items || []).find((it) => it.id === id) || null;
    }
  );
}

export async function createTeamLibraryItem(repoRoot, input, { actorEmail } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ actorEmail });
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
    },
    (mod) => mod.createTeamLibraryItem(repoRoot, input, { actorEmail })
  );
}

export async function updateTeamLibraryItem(repoRoot, id, patch, { actorEmail } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ actorEmail });
      const result = await storage.updateSlideLibraryItem(id, patch, ctx);
      if (!result) return { ok: false, reason: 'not_found' };
      return { ok: true, item: result };
    },
    (mod) => mod.updateTeamLibraryItem(repoRoot, id, patch, { actorEmail })
  );
}

export async function setTeamLibraryItemTrashed(repoRoot, id, { trashed, actorEmail, allowTrash } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ actorEmail });
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
    },
    (mod) => mod.setTeamLibraryItemTrashed(repoRoot, id, { trashed, actorEmail, allowTrash })
  );
}

export async function deleteTeamLibraryItem(repoRoot, id, { actorEmail, allowDelete } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ actorEmail });
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
    },
    (mod) => mod.deleteTeamLibraryItem(repoRoot, id, { actorEmail, allowDelete })
  );
}

// Test helper - re-export from file implementation
export function _unsafeUserKeyFromEmailForTests(email) {
  return import('./slide-library-file.js').then((mod) =>
    mod._unsafeUserKeyFromEmailForTests(email)
  );
}

// Slide library tag functions

export async function getTagsForSlideLibraryItem(id, { userEmail } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail });
      return storage.getTagsForSlideLibraryItem(id, ctx);
    },
    () => [] // File-based storage doesn't support tags
  );
}

export async function getTagsForSlideLibraryItems(ids, { userEmail } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail });
      return storage.getTagsForSlideLibraryItems(ids, ctx);
    },
    () => new Map() // File-based storage doesn't support tags
  );
}

export async function setTagsForSlideLibraryItem(id, tagNames, { userEmail } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail });
      return storage.setTagsForSlideLibraryItem(id, tagNames, ctx);
    },
    () => [] // File-based storage doesn't support tags
  );
}