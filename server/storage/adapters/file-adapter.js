/**
 * File-based storage adapter.
 * Wraps the existing file-based storage implementation.
 */

import { StorageAdapter } from './interface.js';

// Import existing storage functions
import {
  getPresentation as fileGetPresentation,
  createPresentation as fileCreatePresentation,
  updatePresentation as fileUpdatePresentation,
  deletePresentation as fileDeletePresentation,
  duplicatePresentation as fileDuplicatePresentation,
  restorePresentation as fileRestorePresentation,
  permanentlyDeletePresentation as filePermanentlyDeletePresentation,
} from '../presentations/crud.js';
import { writePresentation } from '../presentations/io.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('file-adapter');

import {
  listPresentations as fileListPresentations,
  listTrashedPresentations as fileListTrashedPresentations,
} from '../presentations/list.js';

import {
  createPresentationVersion as fileCreateVersion,
  listPresentationVersions as fileListVersions,
  getPresentationVersion as fileGetVersion,
  prunePresentationVersions as filePruneVersions,
} from '../presentations/versions.js';

import {
  getYDocState as fileGetYDocState,
  setYDocState as fileSetYDocState,
  deleteYDocState as fileDeleteYDocState,
} from '../presentations/ydoc-state.js';

import {
  getImageLibrary as fileGetImageLibrary,
  saveImageLibrary as fileSaveImageLibrary,
} from '../image-library-file.js';

import {
  getSlideLibrary as fileGetSlideLibrary,
  saveSlideLibrary as fileSaveSlideLibrary,
} from '../slide-library-file.js';

import {
  getSlideCollections as fileGetSlideCollections,
  saveSlideCollections as fileSaveSlideCollections,
  normalizeSlideIds,
} from '../collections-file.js';

import {
  listSlideLibraryUsage as fileListSlideLibraryUsage,
  recordSlideLibraryUsage as fileRecordSlideLibraryUsage,
} from '../slide-library-usage-file.js';

import {
  getPublishedIndex,
  upsertPublishedEntry,
  removePublishedEntry,
  getPublishedById,
} from '../published-file.js';

import {
  readAppSettings as fileGetAppSettings,
  writeAppSettings as fileSetAppSettings,
  readUserSettings as fileGetUserSettings,
  writeUserSettings as fileSetUserSettings,
} from '../settings.js';

import {
  createFollowCode as fileCreateFollowCode,
  resolveFollowCode as fileResolveFollowCode,
  cleanupExpiredCodes as fileCleanupExpiredCodes,
} from '../follow-codes.js';

/**
 * Normalize a stored collection into the adapter's API shape (adds slideCount).
 * @param {object} item
 * @returns {object}
 */
function shapeCollection(item) {
  const slideIds = Array.isArray(item?.slideIds) ? item.slideIds.map(String) : [];
  return {
    id: String(item?.id || ''),
    scope: String(item?.scope || ''),
    ownerEmail: item?.ownerEmail || null,
    name: String(item?.name || ''),
    description: String(item?.description || ''),
    slideIds,
    slideCount: slideIds.length,
    createdBy: item?.createdBy || null,
    updatedBy: item?.updatedBy || null,
    createdAt: String(item?.createdAt || ''),
    updatedAt: String(item?.updatedAt || ''),
  };
}

export class FileAdapter extends StorageAdapter {
  constructor(repoRoot) {
    super();
    this.repoRoot = repoRoot;
  }

  async initialize() {
    // File adapter doesn't need initialization
    log.info(`[FileAdapter] Using data directory relative to: ${this.repoRoot}`);
  }

  async close() {
    // Nothing to close for file-based storage
  }

  // ============================================================
  // PRESENTATIONS
  // ============================================================

  async listPresentations(ctx) {
    return fileListPresentations(this.repoRoot);
  }

  async getPresentation(id, ctx) {
    return fileGetPresentation(this.repoRoot, id);
  }

  async createPresentation(data, ctx) {
    // Check if data is already a fully-prepared presentation (from prepareNewPresentation)
    // A prepared presentation has: id, slides array, i18n object, created timestamp
    const isAlreadyPrepared =
      typeof data?.id === 'string' &&
      data.id &&
      Array.isArray(data?.slides) &&
      data?.i18n &&
      typeof data.i18n === 'object' &&
      typeof data?.created === 'string';

    if (isAlreadyPrepared) {
      // Just write the prepared presentation directly
      await writePresentation(this.repoRoot, data);
      return data;
    }

    // Otherwise, use the full creation flow (for backwards compatibility)
    const body = { ...data };
    if (!body.ownerEmail && ctx?.actorEmail) {
      body.ownerEmail = ctx.actorEmail;
    }
    return fileCreatePresentation(this.repoRoot, body);
  }

  async updatePresentation(id, data, ctx, opts = {}) {
    return fileUpdatePresentation(this.repoRoot, id, data, {
      expectedRevision: opts?.expectedRevision,
      actorEmail: ctx?.actorEmail,
      allowScopeChange: opts?.allowScopeChange,
      reason: opts?.reason,
      restoreFromVersionId: opts?.restoreFromVersionId,
    });
  }

  async deletePresentation(id, ctx) {
    return fileDeletePresentation(this.repoRoot, id, { actorEmail: ctx?.actorEmail });
  }

  async listTrashedPresentations(ctx) {
    return fileListTrashedPresentations(this.repoRoot);
  }

  async restorePresentation(id, ctx) {
    return fileRestorePresentation(this.repoRoot, id);
  }

  async permanentlyDeletePresentation(id, ctx) {
    return filePermanentlyDeletePresentation(this.repoRoot, id);
  }

  async duplicatePresentation(id, ctx) {
    return fileDuplicatePresentation(this.repoRoot, id, {
      actorEmail: ctx?.actorEmail,
    });
  }

  // ============================================================
  // COLLAB Y.DOC STATE
  // ============================================================

  async getYDocState(presentationId, ctx) {
    return fileGetYDocState(this.repoRoot, presentationId);
  }

  async setYDocState(presentationId, state, ctx) {
    return fileSetYDocState(this.repoRoot, presentationId, state);
  }

  async deleteYDocState(presentationId, ctx) {
    return fileDeleteYDocState(this.repoRoot, presentationId);
  }

  // ============================================================
  // PRESENTATION VERSIONS
  // ============================================================

  async listPresentationVersions(presentationId, ctx) {
    return fileListVersions(this.repoRoot, presentationId);
  }

  async getPresentationVersion(presentationId, versionId, ctx) {
    return fileGetVersion(this.repoRoot, presentationId, versionId);
  }

  async createPresentationVersion(presentationId, snapshot, ctx, opts = {}) {
    return fileCreateVersion(this.repoRoot, presentationId, snapshot, {
      actorEmail: ctx?.actorEmail,
      reason: opts?.reason,
      label: opts?.label,
    });
  }

  async prunePresentationVersions(presentationId, ctx, opts = {}) {
    return filePruneVersions(this.repoRoot, presentationId, {
      keep: opts?.keep,
    });
  }

  // ============================================================
  // IMAGE LIBRARY
  // ============================================================

  async listImages(ctx) {
    const library = await fileGetImageLibrary(this.repoRoot);
    return library?.items || [];
  }

  async getImage(id, ctx) {
    const library = await fileGetImageLibrary(this.repoRoot);
    const items = library?.items || [];
    return items.find((i) => i.id === id) || null;
  }

  async createImage(data, ctx) {
    const library = await fileGetImageLibrary(this.repoRoot);
    const items = library?.items || [];
    const now = new Date().toISOString();
    const item = {
      id: data.id || crypto.randomUUID(),
      url: data.url,
      title: data.title || '',
      description: data.description || '',
      photographer: data.photographer || '',
      tags: data.tags || [],
      alts: data.alts || { nl: '', 'en-GB': '' },
      sources: data.sources || [],
      createdAt: now,
      updatedAt: now,
    };
    items.push(item);
    await fileSaveImageLibrary(this.repoRoot, { items });
    return item;
  }

  async updateImage(id, data, ctx) {
    const library = await fileGetImageLibrary(this.repoRoot);
    const items = library?.items || [];
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return null;

    const existing = items[idx];
    const updated = {
      ...existing,
      ...data,
      id: existing.id, // Don't allow changing ID
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    items[idx] = updated;
    await fileSaveImageLibrary(this.repoRoot, { items });
    return updated;
  }

  async deleteImage(id, ctx) {
    const library = await fileGetImageLibrary(this.repoRoot);
    const items = library?.items || [];
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return false;

    items.splice(idx, 1);
    await fileSaveImageLibrary(this.repoRoot, { items });
    return true;
  }

  // ============================================================
  // SLIDE LIBRARY
  // ============================================================

  async listSlideLibrary(ctx, opts = {}) {
    const library = await fileGetSlideLibrary(this.repoRoot);
    let items = library?.items || [];

    if (opts?.scope) {
      items = items.filter((i) => i.scope === opts.scope);
    }
    if (opts?.ownerEmail) {
      items = items.filter((i) => i.ownerEmail === opts.ownerEmail);
    }
    if (opts?.themeId) {
      items = items.filter((i) => i.themeId === opts.themeId);
    }

    return items;
  }

  async getSlideLibraryItem(id, ctx) {
    const library = await fileGetSlideLibrary(this.repoRoot);
    const items = library?.items || [];
    return items.find((i) => i.id === id) || null;
  }

  async createSlideLibraryItem(data, ctx) {
    const library = await fileGetSlideLibrary(this.repoRoot);
    const items = library?.items || [];
    const now = new Date().toISOString();
    const item = {
      id: data.id || crypto.randomUUID(),
      scope: data.scope || 'personal',
      ownerEmail: data.ownerEmail || ctx?.actorEmail || null,
      name: data.name,
      slideType: data.slideType,
      themeId: data.themeId || null,
      content: data.content || {},
      // Per-language content (nl + en-GB); kept so composed decks survive the
      // NL/EN round-trip. The update path carries it via the `...data` spread.
      i18n: data.i18n || {},
      favorites: data.favorites || [],
      trashedAt: null,
      trashedBy: null,
      createdBy: ctx?.actorEmail || null,
      updatedBy: ctx?.actorEmail || null,
      createdAt: now,
      updatedAt: now,
    };
    items.push(item);
    await fileSaveSlideLibrary(this.repoRoot, { items });
    return item;
  }

  async updateSlideLibraryItem(id, data, ctx) {
    const library = await fileGetSlideLibrary(this.repoRoot);
    const items = library?.items || [];
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return null;

    const existing = items[idx];
    const updated = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      updatedBy: ctx?.actorEmail || existing.updatedBy,
      updatedAt: new Date().toISOString(),
    };
    items[idx] = updated;
    await fileSaveSlideLibrary(this.repoRoot, { items });
    return updated;
  }

  async deleteSlideLibraryItem(id, ctx) {
    const library = await fileGetSlideLibrary(this.repoRoot);
    const items = library?.items || [];
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return false;

    items.splice(idx, 1);
    await fileSaveSlideLibrary(this.repoRoot, { items });
    return true;
  }

  // ============================================================
  // SLIDE COLLECTIONS
  // ============================================================

  async listSlideCollections(ctx, opts = {}) {
    const store = await fileGetSlideCollections(this.repoRoot);
    let items = store?.items || [];
    if (opts?.scope) {
      items = items.filter((c) => c.scope === opts.scope);
    }
    if (opts?.ownerEmail) {
      const owner = String(opts.ownerEmail).toLowerCase();
      items = items.filter((c) => String(c.ownerEmail || '').toLowerCase() === owner);
    }
    // Newest first, matching the postgres adapter's ordering.
    items = [...items].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return items.map(shapeCollection);
  }

  async getSlideCollection(id, ctx) {
    const store = await fileGetSlideCollections(this.repoRoot);
    const item = (store?.items || []).find((c) => c.id === id);
    return item ? shapeCollection(item) : null;
  }

  async createSlideCollection(data, ctx) {
    const store = await fileGetSlideCollections(this.repoRoot);
    const items = store?.items || [];
    const now = new Date().toISOString();
    const item = {
      id: data.id || crypto.randomUUID(),
      scope: data.scope || 'personal',
      ownerEmail: data.ownerEmail || ctx?.actorEmail || null,
      name: data.name,
      description: data.description || '',
      slideIds: normalizeSlideIds(data.slideIds),
      createdBy: ctx?.actorEmail || null,
      updatedBy: ctx?.actorEmail || null,
      createdAt: now,
      updatedAt: now,
    };
    items.unshift(item);
    await fileSaveSlideCollections(this.repoRoot, { v: 1, items });
    return shapeCollection(item);
  }

  async updateSlideCollection(id, data, ctx) {
    const store = await fileGetSlideCollections(this.repoRoot);
    const items = store?.items || [];
    const idx = items.findIndex((c) => c.id === id);
    if (idx === -1) return null;

    const existing = items[idx];
    const updated = {
      ...existing,
      id: existing.id,
      scope: existing.scope,
      ownerEmail: existing.ownerEmail,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      updatedBy: ctx?.actorEmail || existing.updatedBy,
      updatedAt: new Date().toISOString(),
    };
    if (data.name !== undefined) updated.name = data.name;
    if (data.description !== undefined) updated.description = data.description;
    if (data.slideIds !== undefined) updated.slideIds = normalizeSlideIds(data.slideIds);
    items[idx] = updated;
    await fileSaveSlideCollections(this.repoRoot, { v: 1, items });
    return shapeCollection(updated);
  }

  async deleteSlideCollection(id, ctx) {
    const store = await fileGetSlideCollections(this.repoRoot);
    const items = store?.items || [];
    const idx = items.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    items.splice(idx, 1);
    await fileSaveSlideCollections(this.repoRoot, { v: 1, items });
    return true;
  }

  // ============================================================
  // SLIDE LIBRARY USAGE (per-user "new to you" tracking)
  // ============================================================

  async listSlideLibraryUsage(userEmail, ctx) {
    const { items } = await fileListSlideLibraryUsage(this.repoRoot, userEmail);
    return items;
  }

  async recordSlideLibraryUsage(userEmail, items, ctx) {
    const { recorded } = await fileRecordSlideLibraryUsage(this.repoRoot, userEmail, items);
    return recorded;
  }

  // ============================================================
  // PUBLISHED PRESENTATIONS
  // ============================================================

  async listPublished(ctx) {
    const index = await getPublishedIndex(this.repoRoot);
    return Object.values(index).map((entry) => ({
      id: entry.publishId,
      presentationId: entry.presentationId,
      title: entry.title,
      slug: entry.slug,
      ogImageUrl: entry.ogImageUrl,
      created: entry.created,
      modified: entry.modified,
    }));
  }

  async getPublished(publishId, ctx) {
    return getPublishedById(this.repoRoot, publishId);
  }

  async upsertPublished(data, ctx) {
    await upsertPublishedEntry(this.repoRoot, data);
    return data;
  }

  async deletePublished(publishId, ctx) {
    return removePublishedEntry(this.repoRoot, publishId);
  }

  // ============================================================
  // SETTINGS
  // ============================================================

  async getAppSettings(ctx) {
    return fileGetAppSettings(this.repoRoot);
  }

  async setAppSettings(data, ctx) {
    return fileSetAppSettings(this.repoRoot, data);
  }

  async getUserSettings(email, ctx) {
    return fileGetUserSettings(this.repoRoot, email);
  }

  async setUserSettings(email, data, ctx) {
    return fileSetUserSettings(this.repoRoot, email, data);
  }

  // ============================================================
  // FOLLOW CODES
  // ============================================================

  async createFollowCode(code, followUrl, ctx, opts = {}) {
    // The file-based implementation generates its own code, so we pass the followUrl
    // and let it return the created entry with code
    return fileCreateFollowCode(this.repoRoot, followUrl);
  }

  async resolveFollowCode(code, ctx) {
    return fileResolveFollowCode(this.repoRoot, code);
  }

  async cleanupExpiredFollowCodes(ctx) {
    return fileCleanupExpiredCodes(this.repoRoot);
  }
}