/**
 * Slide collections storage facade.
 * Uses the storage adapter when initialized, falls back to file-based storage.
 *
 * A collection is a named, ordered, scoped set of slide-library item ids
 * (see collections-file.js). It stores references only, never slide content.
 */

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { getDefaultOrganizationId } from '../config/database.js';

function getStorageContext(opts = {}) {
  return {
    organizationId: getDefaultOrganizationId(),
    actorEmail: opts.actorEmail || opts.userEmail || null,
  };
}

/**
 * Execute pgFn against the storage adapter when initialized, else fileFn.
 * @param {(storage: object) => Promise<any>} pgFn
 * @param {(mod: object) => Promise<any>} fileFn
 * @returns {Promise<any>}
 */
async function withStorageFallback(pgFn, fileFn) {
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

export async function listPersonalCollections(repoRoot, userEmail) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail });
      const items = await storage.listSlideCollections(ctx, {
        scope: 'personal',
        ownerEmail: String(userEmail || '').toLowerCase(),
      });
      return { items };
    },
    (mod) => mod.listPersonalCollections(repoRoot, userEmail)
  );
}

export async function getPersonalCollection(repoRoot, userEmail, id) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail });
      const item = await storage.getSlideCollection(id, ctx);
      if (!item || item.scope !== 'personal') return null;
      const owner = String(userEmail || '').toLowerCase();
      if (String(item.ownerEmail || '').toLowerCase() !== owner) return null;
      return item;
    },
    (mod) => mod.getPersonalCollection(repoRoot, userEmail, id)
  );
}

export async function createPersonalCollection(repoRoot, userEmail, input, { actorEmail } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail, actorEmail });
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
    (mod) => mod.createPersonalCollection(repoRoot, userEmail, input, { actorEmail })
  );
}

export async function updatePersonalCollection(repoRoot, userEmail, id, patch, { actorEmail } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail, actorEmail });
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
    (mod) => mod.updatePersonalCollection(repoRoot, userEmail, id, patch, { actorEmail })
  );
}

export async function deletePersonalCollection(repoRoot, userEmail, id) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail });
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
    (mod) => mod.deletePersonalCollection(repoRoot, userEmail, id)
  );
}

// ============================================================
// Team collections
// ============================================================

export async function listTeamCollections(repoRoot, { userEmail = '' } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail });
      const items = await storage.listSlideCollections(ctx, { scope: 'team' });
      return { items };
    },
    (mod) => mod.listTeamCollections(repoRoot)
  );
}

export async function getTeamCollection(repoRoot, id, { userEmail = '' } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ userEmail });
      const item = await storage.getSlideCollection(id, ctx);
      if (!item || item.scope !== 'team') return null;
      return item;
    },
    (mod) => mod.getTeamCollection(repoRoot, id)
  );
}

export async function createTeamCollection(repoRoot, input, { actorEmail } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ actorEmail });
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
    (mod) => mod.createTeamCollection(repoRoot, input, { actorEmail })
  );
}

export async function updateTeamCollection(repoRoot, id, patch, { actorEmail, allowMutate } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ actorEmail });
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
    (mod) => mod.updateTeamCollection(repoRoot, id, patch, { actorEmail, allowMutate })
  );
}

export async function deleteTeamCollection(repoRoot, id, { actorEmail, allowMutate } = {}) {
  return withStorageFallback(
    async (storage) => {
      const ctx = getStorageContext({ actorEmail });
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
    (mod) => mod.deleteTeamCollection(repoRoot, id, { actorEmail, allowMutate })
  );
}
