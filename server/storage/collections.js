/**
 * Slide collections storage facade.
 * Uses the storage adapter when initialized, falls back to file-based storage.
 *
 * A collection is a named, ordered, scoped set of slide-library item ids
 * (see collections-file.js). It stores references only, never slide content.
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

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { resolveScope, repoRootOf } from './scope.js';

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
 * Execute pgFn against the storage adapter when initialized, else fileFn.
 * @param {import('./scope.js').StorageScope} storageScope - The caller's scope.
 * @param {string} operation - Facade function name, for the error message.
 * @param {(storage: object) => Promise<any>} pgFn
 * @param {(mod: object) => Promise<any>} fileFn
 * @returns {Promise<any>}
 */
async function withStorageFallback(storageScope, operation, pgFn, fileFn) {
  // Validate the scope before either backend runs, so a missed call site fails
  // on the file-backed path too rather than slipping past the file-mode suite.
  resolveScope(storageScope, operation);
  if (isStorageInitialized()) {
    return pgFn(getStorage());
  }
  const mod = await import('./collections-file.js');
  return fileFn(mod);
}

function cleanName(input) {
  return typeof input?.name === 'string' ? input.name.trim() : '';
}

// ============================================================
// Personal collections
// ============================================================

export async function listPersonalCollections(storageScope, userEmail) {
  return withStorageFallback(
    storageScope,
    'listPersonalCollections',
    async (storage) => {
      const ctx = toStorageContext(storageScope, 'listPersonalCollections', { userEmail });
      const items = await storage.listSlideCollections(ctx, {
        scope: 'personal',
        ownerEmail: String(userEmail || '').toLowerCase(),
      });
      return { items };
    },
    (mod) => mod.listPersonalCollections(repoRootOf(storageScope), userEmail)
  );
}

export async function getPersonalCollection(storageScope, userEmail, id) {
  return withStorageFallback(
    storageScope,
    'getPersonalCollection',
    async (storage) => {
      const ctx = toStorageContext(storageScope, 'getPersonalCollection', { userEmail });
      const item = await storage.getSlideCollection(id, ctx);
      if (!item || item.scope !== 'personal') return null;
      const owner = String(userEmail || '').toLowerCase();
      if (String(item.ownerEmail || '').toLowerCase() !== owner) return null;
      return item;
    },
    (mod) => mod.getPersonalCollection(repoRootOf(storageScope), userEmail, id)
  );
}

export async function createPersonalCollection(storageScope, userEmail, input, { actorEmail } = {}) {
  return withStorageFallback(
    storageScope,
    'createPersonalCollection',
    async (storage) => {
      const ctx = toStorageContext(storageScope, 'createPersonalCollection', { userEmail, actorEmail });
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
    },
    (mod) => mod.createPersonalCollection(repoRootOf(storageScope), userEmail, input, { actorEmail })
  );
}

export async function updatePersonalCollection(storageScope, userEmail, id, patch, { actorEmail } = {}) {
  return withStorageFallback(
    storageScope,
    'updatePersonalCollection',
    async (storage) => {
      const ctx = toStorageContext(storageScope, 'updatePersonalCollection', { userEmail, actorEmail });
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
    },
    (mod) => mod.updatePersonalCollection(repoRootOf(storageScope), userEmail, id, patch, { actorEmail })
  );
}

export async function deletePersonalCollection(storageScope, userEmail, id) {
  return withStorageFallback(
    storageScope,
    'deletePersonalCollection',
    async (storage) => {
      const ctx = toStorageContext(storageScope, 'deletePersonalCollection', { userEmail });
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
    },
    (mod) => mod.deletePersonalCollection(repoRootOf(storageScope), userEmail, id)
  );
}

// ============================================================
// Team collections
// ============================================================

export async function listTeamCollections(storageScope, { userEmail = '' } = {}) {
  return withStorageFallback(
    storageScope,
    'listTeamCollections',
    async (storage) => {
      const ctx = toStorageContext(storageScope, 'listTeamCollections', { userEmail });
      const items = await storage.listSlideCollections(ctx, { scope: 'team' });
      return { items };
    },
    (mod) => mod.listTeamCollections(repoRootOf(storageScope))
  );
}

export async function getTeamCollection(storageScope, id, { userEmail = '' } = {}) {
  return withStorageFallback(
    storageScope,
    'getTeamCollection',
    async (storage) => {
      const ctx = toStorageContext(storageScope, 'getTeamCollection', { userEmail });
      const item = await storage.getSlideCollection(id, ctx);
      if (!item || item.scope !== 'team') return null;
      return item;
    },
    (mod) => mod.getTeamCollection(repoRootOf(storageScope), id)
  );
}

export async function createTeamCollection(storageScope, input, { actorEmail } = {}) {
  return withStorageFallback(
    storageScope,
    'createTeamCollection',
    async (storage) => {
      const ctx = toStorageContext(storageScope, 'createTeamCollection', { actorEmail });
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
    },
    (mod) => mod.createTeamCollection(repoRootOf(storageScope), input, { actorEmail })
  );
}

export async function updateTeamCollection(storageScope, id, patch, { actorEmail, allowMutate } = {}) {
  return withStorageFallback(
    storageScope,
    'updateTeamCollection',
    async (storage) => {
      const ctx = toStorageContext(storageScope, 'updateTeamCollection', { actorEmail });
      const existing = await storage.getSlideCollection(id, ctx);
      if (!existing || existing.scope !== 'team') return { ok: false, reason: 'not_found' };
      if (typeof allowMutate === 'function') {
        const ok = await allowMutate(existing, { actorEmail });
        if (!ok) return { ok: false, reason: 'forbidden' };
      }
      const item = await storage.updateSlideCollection(id, patch, ctx);
      if (!item) return { ok: false, reason: 'not_found' };
      return { ok: true, item };
    },
    (mod) => mod.updateTeamCollection(repoRootOf(storageScope), id, patch, { actorEmail, allowMutate })
  );
}

export async function deleteTeamCollection(storageScope, id, { actorEmail, allowMutate } = {}) {
  return withStorageFallback(
    storageScope,
    'deleteTeamCollection',
    async (storage) => {
      const ctx = toStorageContext(storageScope, 'deleteTeamCollection', { actorEmail });
      const existing = await storage.getSlideCollection(id, ctx);
      if (!existing || existing.scope !== 'team') return { ok: false, reason: 'not_found' };
      if (typeof allowMutate === 'function') {
        const ok = await allowMutate(existing, { actorEmail });
        if (!ok) return { ok: false, reason: 'forbidden' };
      }
      const deleted = await storage.deleteSlideCollection(id, ctx);
      if (!deleted) return { ok: false, reason: 'not_found' };
      return { ok: true };
    },
    (mod) => mod.deleteTeamCollection(repoRootOf(storageScope), id, { actorEmail, allowMutate })
  );
}
