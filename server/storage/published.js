/**
 * Published presentations storage facade.
 * Uses storage adapter when initialized, falls back to file-based storage.
 *
 * Every function takes a **storage scope** rather than a bare `repoRoot`, so the
 * organization comes from the caller instead of a hardcoded default (see
 * server/storage/scope.js). The one deliberate exception is
 * {@link getPublishedById}: a publish id is a globally unique public token that
 * *is* the authorization, so filtering it by organization would break every
 * public link the moment an instance holds a second organization.
 */

import crypto from 'node:crypto';
import { safeSlug } from '../utils/slug.js';
import { getPresentation } from './presentations.js';
import { crossOrganizationScope, resolveScope, repoRootOf } from './scope.js';
import { createStorageDispatch } from './backend-dispatch.js';

const withStorageFallback = createStorageDispatch(() => import('./published-file.js'));

export function newPublishId() {
  // Short, URL-friendly, unique enough for public share links.
  return crypto.randomUUID().split('-')[0];
}

/**
 * The publish index of the scope's organization, keyed by publish id.
 * @param {import('./scope.js').StorageScope} scope
 * @returns {Promise<Object>}
 */
export async function getPublishedIndex(scope) {
  const ctx = resolveScope(scope, 'getPublishedIndex');
  return withStorageFallback(
    scope,
    'getPublishedIndex',
    async (storage) => {
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
    },
    (mod) => mod.getPublishedIndex(repoRootOf(scope))
  );
}

/**
 * Fetch one publish entry by its public publish id.
 *
 * The only cross-organization-capable function here: the publish id is the
 * authorization, and public viewer/embed routes have no session to take an
 * organization from.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} publishId
 * @returns {Promise<Object|null>}
 */
export async function getPublishedById(scope, publishId) {
  const allowCross = { allowCrossOrganization: true };
  const ctx = resolveScope(scope, 'getPublishedById', allowCross);
  const id = String(publishId || '').trim();
  if (!id) return null;

  return withStorageFallback(
    scope,
    'getPublishedById',
    async (storage) => {
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
    },
    (mod) => mod.getPublishedById(repoRootOf(scope), publishId),
    allowCross
  );
}

/**
 * Create or update the publish entry of a deck in the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 * @param {{publishId: string, presentationId: string, title?: string, ogImageUrl?: string}} entry
 * @returns {Promise<Object>}
 */
export async function upsertPublishedEntry(
  scope,
  { publishId, presentationId, title, ogImageUrl }
) {
  const ctx = resolveScope(scope, 'upsertPublishedEntry');
  const id = String(publishId || '').trim();
  const pid = String(presentationId || '').trim();
  if (!id) throw new Error('publishId is required');
  if (!pid) throw new Error('presentationId is required');

  return withStorageFallback(
    scope,
    'upsertPublishedEntry',
    async (storage) => {
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
    },
    (mod) => mod.upsertPublishedEntry(repoRootOf(scope), {
      publishId,
      presentationId,
      title,
      ogImageUrl,
    })
  );
}

/**
 * Unpublish: drop the publish entry within the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} publishId
 * @returns {Promise<boolean>}
 */
export async function removePublishedEntry(scope, publishId) {
  const ctx = resolveScope(scope, 'removePublishedEntry');
  const id = String(publishId || '').trim();
  if (!id) return false;

  return withStorageFallback(
    scope,
    'removePublishedEntry',
    (storage) => storage.deletePublished(id, ctx),
    (mod) => mod.removePublishedEntry(repoRootOf(scope), publishId)
  );
}

/**
 * Rename the public slug of a publish entry in the scope's organization.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} publishId
 * @param {string} nextSlug
 * @returns {Promise<Object>}
 */
export async function updatePublishedSlug(scope, publishId, nextSlug) {
  const ctx = resolveScope(scope, 'updatePublishedSlug');
  const id = String(publishId || '').trim();
  if (!id) throw new Error('publishId is required');

  return withStorageFallback(
    scope,
    'updatePublishedSlug',
    async (storage) => {
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
    },
    (mod) => mod.updatePublishedSlug(repoRootOf(scope), publishId, nextSlug)
  );
}

/**
 * List published presentations with full metadata for RSS feed generation.
 * Joins published entries with presentation data, excludes opted-out decks.
 *
 * The feed lists one organization's published decks, so the caller states which
 * one; the per-deck read is then addressed by publish id and deliberately
 * unscoped (see {@link getPublishedById}).
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {Object} [opts]
 * @param {number} [opts.limit=50] - Maximum items to return
 * @returns {Array} Enriched published presentation records
 */
export async function listPublishedForFeed(scope, opts = {}) {
  resolveScope(scope, 'listPublishedForFeed');
  const { limit = 50 } = opts;
  const repoRoot = repoRootOf(scope);

  const index = await getPublishedIndex(scope);
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
      const pres = await getPresentation(
        crossOrganizationScope(repoRoot, 'public feed: entries are addressed by publish id'),
        entry.presentationId
      );
      if (!pres) continue;

      const presSettings =
        pres.settings && typeof pres.settings === 'object' ? pres.settings : {};
      if (presSettings.excludeFromFeed) continue;

      enriched.push({
        title: pres.title || entry.title || 'Untitled',
        description: typeof pres.description === 'string' ? pres.description : '',
        // Public feed: expose only a display handle (email local-part), never
        // the raw address, so the RSS <author> can't be harvested. Full
        // identity decoupling: docs/plans/briefs/identity-decoupling.md.
        ownerName: pres.ownerEmail ? String(pres.ownerEmail).split('@')[0] : '',
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