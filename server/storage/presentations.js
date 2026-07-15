/**
 * Presentations storage facade.
 * Uses storage adapter when initialized, falls back to file-based storage.
 */

import { isStorageInitialized, getStorage } from './adapters/index.js';
import { getDefaultOrganizationId } from '../config/database.js';
import { deleteYDocState } from './presentation-ydocs.js';
import { normalizeSlides } from './presentations/slides.js';
import { normalizeI18n } from './presentations/i18n.js';
import { validatePresentationSize } from '../utils/presentation-limits.js';
import { invalidatePresentationCache } from './presentation-cache.js';

/**
 * Get the context for storage operations.
 * In single-tenant mode, uses default organization.
 * TODO: In multi-tenant mode, extract from request/auth.
 * @param {Object} opts - Options with optional actorEmail
 * @returns {Object} Context with organizationId
 */
function getStorageContext(opts = {}) {
  return {
    organizationId: getDefaultOrganizationId(),
    actorEmail: opts.actorEmail || opts.ownerEmail || null,
  };
}

export async function listPresentations(repoRoot) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return await storage.listPresentations(ctx);
  }
  // Fall back to file-based storage
  const mod = await import('./presentations/list.js');
  return await mod.listPresentations(repoRoot);
}

export async function getPresentation(repoRoot, id) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return await storage.getPresentation(id, ctx);
  }
  const mod = await import('./presentations/crud.js');
  return await mod.getPresentation(repoRoot, id);
}

export async function createPresentation(repoRoot, body) {
  if (isStorageInitialized()) {
    // Prepare the full presentation object (with slides, i18n, etc.) before storing
    const mod = await import('./presentations/crud.js');
    const preparedPresentation = await mod.prepareNewPresentation(repoRoot, body);

    // Validate size limits before creating
    const validation = validatePresentationSize(preparedPresentation);
    if (!validation.ok) {
      return {
        ok: false,
        reason: 'limit_exceeded',
        errors: validation.errors,
      };
    }

    const storage = getStorage();
    const ctx = getStorageContext({ actorEmail: body?.ownerEmail });
    const result = await storage.createPresentation(preparedPresentation, ctx);

    // Attach warnings to the result if any
    if (validation.warnings) {
      result._warnings = validation.warnings;
    }
    return result;
  }
  const mod = await import('./presentations/crud.js');
  return await mod.createPresentation(repoRoot, body);
}

export async function updatePresentation(repoRoot, id, body, opts) {
  let result;
  try {
    result = await updatePresentationUncached(repoRoot, id, body, opts);
  } finally {
    invalidatePresentationCache(id);
  }
  // Any successful mutation (editor save, public API, MCP tool) refreshes
  // live presenting clients. Fire-and-forget: a no-op without a live session.
  if (result && result.ok !== false) {
    import('./present-sessions/sse.js')
      .then((m) => m.notifyDeckUpdatedForPresentation(repoRoot, id))
      .catch(() => {});
    // Collab live edits: a save that did NOT come from the collab doc makes
    // any stored (cold) Y.Doc binary stale — invalidate it so the next
    // collab open re-bootstraps from this fresh JSON instead of resurrecting
    // old content. Saves originating from the doc keep their binary.
    // Unconditional (not gated on COLLAB_LIVE_EDITS): a binary written while
    // the flag was on must not survive saves made while it is off, or
    // re-enabling the flag would resurrect stale state. No-op when no binary
    // exists.
    if (opts?.reason !== 'collab') {
      deleteYDocState(repoRoot, id).catch(() => {});
    }
  }
  return result;
}

async function updatePresentationUncached(repoRoot, id, body, opts) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext({ actorEmail: opts?.actorEmail });

    // Normalize slides and i18n before storing (mirrors crud.js behavior).
    // This ensures pres.slides and i18n.versions[lang].slides stay in sync.
    const normalized = { ...body };
    normalized.slides = normalizeSlides(normalized.slides);
    normalizeI18n(normalized);

    // Validate size limits before updating (unless bypassed)
    if (!opts?.skipLimitCheck) {
      const validation = validatePresentationSize(normalized);
      if (!validation.ok) {
        return {
          ok: false,
          reason: 'limit_exceeded',
          errors: validation.errors,
        };
      }

      const result = await storage.updatePresentation(id, normalized, ctx, opts);

      // Attach warnings to the result if any
      if (validation.warnings && result && typeof result === 'object') {
        result._warnings = validation.warnings;
      }
      return result;
    }

    return await storage.updatePresentation(id, normalized, ctx, opts);
  }
  const mod = await import('./presentations/crud.js');
  return await mod.updatePresentation(repoRoot, id, body, opts);
}

export async function deletePresentation(repoRoot, id, opts) {
  try {
    if (isStorageInitialized()) {
      const storage = getStorage();
      const ctx = getStorageContext({ actorEmail: opts?.actorEmail });
      return await storage.deletePresentation(id, ctx);
    }
    const mod = await import('./presentations/crud.js');
    return await mod.deletePresentation(repoRoot, id, opts);
  } finally {
    invalidatePresentationCache(id);
    // Trash/restore round-trips must not resurrect a stale collab doc.
    // Unconditional for the same reason as in updatePresentation.
    deleteYDocState(repoRoot, id).catch(() => {});
  }
}

export async function listTrashedPresentations(repoRoot) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return await storage.listTrashedPresentations(ctx);
  }
  const mod = await import('./presentations/list.js');
  return await mod.listTrashedPresentations(repoRoot);
}

export async function restorePresentation(repoRoot, id) {
  try {
    if (isStorageInitialized()) {
      const storage = getStorage();
      const ctx = getStorageContext();
      return await storage.restorePresentation(id, ctx);
    }
    const mod = await import('./presentations/crud.js');
    return await mod.restorePresentation(repoRoot, id);
  } finally {
    invalidatePresentationCache(id);
  }
}

export async function permanentlyDeletePresentation(repoRoot, id) {
  try {
    if (isStorageInitialized()) {
      const storage = getStorage();
      const ctx = getStorageContext();
      return await storage.permanentlyDeletePresentation(id, ctx);
    }
    const mod = await import('./presentations/crud.js');
    return await mod.permanentlyDeletePresentation(repoRoot, id);
  } finally {
    invalidatePresentationCache(id);
  }
}

export async function duplicatePresentation(repoRoot, id, opts) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext({ actorEmail: opts?.actorEmail });
    return await storage.duplicatePresentation(id, ctx, opts);
  }
  const mod = await import('./presentations/crud.js');
  return await mod.duplicatePresentation(repoRoot, id, opts);
}

export async function claimPresentationOwnership(repoRoot, id, opts) {
  try {
    if (isStorageInitialized()) {
      const storage = getStorage();
      const ctx = getStorageContext({ actorEmail: opts?.ownerEmail });
      return await storage.claimPresentationOwnership(id, ctx, opts);
    }
    const mod = await import('./presentations/crud.js');
    return await mod.claimPresentationOwnership(repoRoot, id, opts);
  } finally {
    invalidatePresentationCache(id);
  }
}

/**
 * Batch-fetch first slides for multiple presentations.
 * Returns a Map of presentationId -> firstSlide object.
 * This avoids N+1 queries when loading shared presentations.
 * @param {string} repoRoot - Repository root path
 * @param {string[]} ids - Array of presentation IDs
 * @returns {Promise<Map<string, Object>>} Map of id -> firstSlide
 */
export async function getFirstSlidesForIds(repoRoot, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return new Map();
  }

  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    // If storage adapter supports batch first slides, use it
    if (typeof storage.getFirstSlidesForIds === 'function') {
      return await storage.getFirstSlidesForIds(ids, ctx);
    }
    // Fallback: fetch each presentation and extract first slide
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const pres = await storage.getPresentation(id, ctx);
          const first = pres?.slides?.[0];
          return [id, first ? { id: first.id, type: first.type, content: first.content || {} } : null];
        } catch {
          return [id, null];
        }
      })
    );
    return new Map(results);
  }

  // File-based storage: batch read JSON files
  const mod = await import('./presentations/crud.js');
  return await mod.getFirstSlidesForIds(repoRoot, ids);
}