/**
 * Published presentations storage facade.
 * Uses storage adapter when initialized, falls back to file-based storage.
 */

import crypto from 'node:crypto';
import { isStorageInitialized, getStorage } from './adapters/index.js';
import { getDefaultOrganizationId } from '../config/database.js';
import { safeSlug } from '../utils/slug.js';
import { getPresentation } from './presentations.js';

/**
 * Get the context for storage operations.
 * @returns {Object} Context with organizationId
 */
function getStorageContext() {
  return {
    organizationId: getDefaultOrganizationId(),
  };
}

export function newPublishId() {
  // Short, URL-friendly, unique enough for public share links.
  return crypto.randomUUID().split('-')[0];
}

export async function getPublishedIndex(repoRoot) {
  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    const list = await storage.listPublished(ctx);
    // Convert array to index object for backwards compatibility
    const index = {};
    for (const entry of list) {
      index[entry.id] = {
        publishId: entry.id,
        presentationId: entry.presentationId,
        title: entry.title,
        slug: entry.slug,
        ogImageUrl: entry.ogImageUrl,
        created: entry.created,
        modified: entry.modified,
      };
    }
    return index;
  }
  // Fall back to file-based storage
  const mod = await import('./published-file.js');
  return mod.getPublishedIndex(repoRoot);
}

export async function getPublishedById(repoRoot, publishId) {
  const id = String(publishId || '').trim();
  if (!id) return null;

  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    const entry = await storage.getPublished(id, ctx);
    if (!entry) return null;
    return {
      publishId: entry.id,
      presentationId: entry.presentationId,
      slug: entry.slug || '',
      ogImageUrl: entry.ogImageUrl || '',
      modified: entry.modified || null,
      created: entry.created || null,
    };
  }
  // Fall back to file-based storage
  const mod = await import('./published-file.js');
  return mod.getPublishedById(repoRoot, publishId);
}

export async function upsertPublishedEntry(
  repoRoot,
  { publishId, presentationId, title, ogImageUrl }
) {
  const id = String(publishId || '').trim();
  const pid = String(presentationId || '').trim();
  if (!id) throw new Error('publishId is required');
  if (!pid) throw new Error('presentationId is required');

  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    const slug = safeSlug(title || 'presentation');
    const result = await storage.upsertPublished({
      id,
      presentationId: pid,
      title: String(title || ''),
      slug,
      ogImageUrl: typeof ogImageUrl === 'string' ? ogImageUrl : '',
    }, ctx);
    return {
      publishId: result.id,
      presentationId: result.presentationId,
      title: result.title,
      slug: result.slug,
      ogImageUrl: result.ogImageUrl,
      created: result.created,
      modified: result.modified,
    };
  }
  // Fall back to file-based storage
  const mod = await import('./published-file.js');
  return mod.upsertPublishedEntry(repoRoot, { publishId, presentationId, title, ogImageUrl });
}

export async function removePublishedEntry(repoRoot, publishId) {
  const id = String(publishId || '').trim();
  if (!id) return false;

  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    return storage.deletePublished(id, ctx);
  }
  // Fall back to file-based storage
  const mod = await import('./published-file.js');
  return mod.removePublishedEntry(repoRoot, publishId);
}

export async function updatePublishedSlug(repoRoot, publishId, nextSlug) {
  const id = String(publishId || '').trim();
  if (!id) throw new Error('publishId is required');

  if (isStorageInitialized()) {
    const storage = getStorage();
    const ctx = getStorageContext();
    const existing = await storage.getPublished(id, ctx);
    if (!existing) throw new Error('Published entry not found');

    const slug = safeSlug(nextSlug);
    const result = await storage.upsertPublished({
      ...existing,
      slug,
    }, ctx);
    return {
      publishId: result.id,
      presentationId: result.presentationId,
      title: result.title,
      slug: result.slug,
      ogImageUrl: result.ogImageUrl,
      created: result.created,
      modified: result.modified,
    };
  }
  // Fall back to file-based storage
  const mod = await import('./published-file.js');
  return mod.updatePublishedSlug(repoRoot, publishId, nextSlug);
}

/**
 * List published presentations with full metadata for RSS feed generation.
 * Joins published entries with presentation data, excludes opted-out decks.
 * @param {string} repoRoot
 * @param {Object} [opts]
 * @param {number} [opts.limit=50] - Maximum items to return
 * @returns {Array} Enriched published presentation records
 */
export async function listPublishedForFeed(repoRoot, opts = {}) {
  const { limit = 50 } = opts;

  const index = await getPublishedIndex(repoRoot);
  const entries = Object.values(index);

  // Sort by modified date descending
  entries.sort((a, b) => {
    const ta = new Date(a.modified || a.created || 0).getTime();
    const tb = new Date(b.modified || b.created || 0).getTime();
    return tb - ta;
  });

  const enriched = [];
  for (const entry of entries) {
    if (enriched.length >= limit) break;
    try {
      const pres = await getPresentation(repoRoot, entry.presentationId);
      if (!pres) continue;

      const presSettings =
        pres.settings && typeof pres.settings === 'object' ? pres.settings : {};
      if (presSettings.excludeFromFeed) continue;

      enriched.push({
        title: pres.title || entry.title || 'Untitled',
        description: typeof pres.description === 'string' ? pres.description : '',
        ownerEmail: pres.ownerEmail || '',
        published: {
          id: entry.publishId,
          slug: entry.slug || '',
          ogImageUrl: entry.ogImageUrl || '',
          created: entry.created || null,
        },
        modified: entry.modified || pres.modified || null,
        created: pres.created || null,
      });
    } catch {
      continue;
    }
  }

  return enriched;
}