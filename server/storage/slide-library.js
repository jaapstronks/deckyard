/**
 * Slide library storage facade.
 * Uses storage adapter when initialized, falls back to file-based storage.
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

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { resolveScope, repoRootOf } from './scope.js';
import { nowIso } from '../utils/normalize.js';

/**
 * Reduce a caller's scope to the context the storage adapters take.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} operation - Facade function name, for the error message.
 * @param {Object} [opts] - Options carrying a sharper actor.
 * @returns {Object} Context for the storage adapter.
 */
function toStorageContext(scope, operation, opts = {}) {
  const resolved = resolveScope(scope, operation);
  return {
    ...resolved,
    actorEmail: opts.actorEmail || opts.userEmail || resolved.actorEmail,
  };
}

/**
 * Higher-order function to handle storage fallback pattern.
 * Executes pgFn if storage is initialized, otherwise falls back to fileFn.
 * @param {import('./scope.js').StorageScope} scope - The caller's scope.
 * @param {string} operation - Facade function name, for the error message.
 * @param {Function} pgFn - Function to execute with postgres storage (receives storage)
 * @param {Function} fileFn - Function to execute with file-based storage
 * @returns {Promise<any>}
 */
async function withStorageFallback(scope, operation, pgFn, fileFn) {
  // Validate the scope before either backend runs. Doing it here rather
  // than inside the adapter branch is what makes a missed call site fail on
  // the file-backed path too — otherwise the file-mode test suite would wave
  // an un-migrated caller straight through.
  resolveScope(scope, operation);
  if (isStorageInitialized()) {
    return pgFn(getStorage());
  }
  const mod = await import('./slide-library-file.js');
  return fileFn(mod);
}

// Personal library functions

export async function listPersonalLibrary(scope, userEmail, { themeId = '' } = {}) {
  return withStorageFallback(
    scope,
    'listPersonalLibrary',
    async (storage) => {
      const ctx = toStorageContext(scope, 'listPersonalLibrary', { userEmail });
      const items = await storage.listSlideLibrary(ctx, { scope: 'personal', ownerEmail: userEmail, themeId });
      return { items };
    },
    (mod) => mod.listPersonalLibrary(repoRootOf(scope), userEmail, { themeId })
  );
}

export async function createPersonalLibraryItem(scope, userEmail, input, { actorEmail } = {}) {
  return withStorageFallback(
    scope,
    'createPersonalLibraryItem',
    async (storage) => {
      const ctx = toStorageContext(scope, 'createPersonalLibraryItem', { userEmail, actorEmail });
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
    (mod) => mod.createPersonalLibraryItem(repoRootOf(scope), userEmail, input, { actorEmail })
  );
}

export async function updatePersonalLibraryItem(scope, userEmail, id, patch, { actorEmail } = {}) {
  return withStorageFallback(
    scope,
    'updatePersonalLibraryItem',
    async (storage) => {
      const ctx = toStorageContext(scope, 'updatePersonalLibraryItem', { userEmail, actorEmail });
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
    (mod) => mod.updatePersonalLibraryItem(repoRootOf(scope), userEmail, id, patch, { actorEmail })
  );
}

export async function deletePersonalLibraryItem(scope, userEmail, id) {
  return withStorageFallback(
    scope,
    'deletePersonalLibraryItem',
    async (storage) => {
      const ctx = toStorageContext(scope, 'deletePersonalLibraryItem', { userEmail });
      const deleted = await storage.deleteSlideLibraryItem(id, ctx);
      if (!deleted) return { ok: false, reason: 'not_found' };
      return { ok: true };
    },
    (mod) => mod.deletePersonalLibraryItem(repoRootOf(scope), userEmail, id)
  );
}

// Team library functions

export async function listTeamLibrary(scope, { themeId = '', userEmail = '' } = {}) {
  return withStorageFallback(
    scope,
    'listTeamLibrary',
    async (storage) => {
      const ctx = toStorageContext(scope, 'listTeamLibrary', { userEmail });
      const items = await storage.listSlideLibrary(ctx, { scope: 'team', themeId });
      return { items };
    },
    (mod) => mod.listTeamLibrary(repoRootOf(scope), { themeId, userEmail })
  );
}

export async function getTeamLibraryItem(scope, id, { userEmail = '' } = {}) {
  return withStorageFallback(
    scope,
    'getTeamLibraryItem',
    async (storage) => {
      const ctx = toStorageContext(scope, 'getTeamLibraryItem', { userEmail });
      const item = await storage.getSlideLibraryItem(id, ctx);
      if (!item || item.scope !== 'team') return null;
      return item;
    },
    async (mod) => {
      // File-based storage: list and find
      const { items } = await mod.listTeamLibrary(repoRootOf(scope), { userEmail });
      return (items || []).find((it) => it.id === id) || null;
    }
  );
}

export async function createTeamLibraryItem(scope, input, { actorEmail } = {}) {
  return withStorageFallback(
    scope,
    'createTeamLibraryItem',
    async (storage) => {
      const ctx = toStorageContext(scope, 'createTeamLibraryItem', { actorEmail });
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
    (mod) => mod.createTeamLibraryItem(repoRootOf(scope), input, { actorEmail })
  );
}

export async function updateTeamLibraryItem(scope, id, patch, { actorEmail } = {}) {
  return withStorageFallback(
    scope,
    'updateTeamLibraryItem',
    async (storage) => {
      const ctx = toStorageContext(scope, 'updateTeamLibraryItem', { actorEmail });
      const result = await storage.updateSlideLibraryItem(id, patch, ctx);
      if (!result) return { ok: false, reason: 'not_found' };
      return { ok: true, item: result };
    },
    (mod) => mod.updateTeamLibraryItem(repoRootOf(scope), id, patch, { actorEmail })
  );
}

export async function setTeamLibraryItemTrashed(scope, id, { trashed, actorEmail, allowTrash } = {}) {
  return withStorageFallback(
    scope,
    'setTeamLibraryItemTrashed',
    async (storage) => {
      const ctx = toStorageContext(scope, 'setTeamLibraryItemTrashed', { actorEmail });
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
    (mod) => mod.setTeamLibraryItemTrashed(repoRootOf(scope), id, { trashed, actorEmail, allowTrash })
  );
}

export async function deleteTeamLibraryItem(scope, id, { actorEmail, allowDelete } = {}) {
  return withStorageFallback(
    scope,
    'deleteTeamLibraryItem',
    async (storage) => {
      const ctx = toStorageContext(scope, 'deleteTeamLibraryItem', { actorEmail });
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
    (mod) => mod.deleteTeamLibraryItem(repoRootOf(scope), id, { actorEmail, allowDelete })
  );
}

// Test helper - re-export from file implementation
export function _unsafeUserKeyFromEmailForTests(email) {
  return import('./slide-library-file.js').then((mod) =>
    mod._unsafeUserKeyFromEmailForTests(email)
  );
}

// Slide library tag functions

export async function getTagsForSlideLibraryItem(scope, id, { userEmail } = {}) {
  return withStorageFallback(
    scope,
    'getTagsForSlideLibraryItem',
    async (storage) => {
      const ctx = toStorageContext(scope, 'getTagsForSlideLibraryItem', { userEmail });
      return storage.getTagsForSlideLibraryItem(id, ctx);
    },
    () => [] // File-based storage doesn't support tags
  );
}

export async function getTagsForSlideLibraryItems(scope, ids, { userEmail } = {}) {
  return withStorageFallback(
    scope,
    'getTagsForSlideLibraryItems',
    async (storage) => {
      const ctx = toStorageContext(scope, 'getTagsForSlideLibraryItems', { userEmail });
      return storage.getTagsForSlideLibraryItems(ids, ctx);
    },
    () => new Map() // File-based storage doesn't support tags
  );
}

export async function setTagsForSlideLibraryItem(scope, id, tagNames, { userEmail } = {}) {
  return withStorageFallback(
    scope,
    'setTagsForSlideLibraryItem',
    async (storage) => {
      const ctx = toStorageContext(scope, 'setTagsForSlideLibraryItem', { userEmail });
      return storage.setTagsForSlideLibraryItem(id, tagNames, ctx);
    },
    () => [] // File-based storage doesn't support tags
  );
}