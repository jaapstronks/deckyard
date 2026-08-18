/**
 * Published presentations storage facade.
 *
 * Every function takes a **storage scope** rather than a bare `repoRoot`, so the
 * organization comes from the caller instead of a hardcoded default (see
 * server/storage/scope.js). The one deliberate exception is
 * {@link getPublishedById}: a publish id is a globally unique public token that
 * *is* the authorization, so filtering it by organization would break every
 * public link the moment an instance holds a second organization.
 *
 * Queries run directly through Kysely (B79/D34 removed the adapter
 * indirection); getDb() throws on an uninitialized database.
 */

import crypto from 'node:crypto';
import { safeSlug } from '../../utils/slug.js';
import { getDb } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { getPresentation } from '../presentations/index.js';
import { crossOrganizationScope, resolveScope, repoRootOf } from '../scope.js';

/** @returns {string} current ISO timestamp */
function now() {
  return new Date().toISOString();
}

/**
 * Map a published_presentations row to the facade's API object.
 * @param {object} row - Database row
 * @returns {object}
 */
function mapPublishedRow(row) {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    title: row.title,
    slug: row.slug,
    ogImageUrl: row.og_image_url,
    created: row.created_at,
    modified: row.modified_at,
  };
}

/**
 * All published rows of the organization, newest-modified first.
 * The adapter used applyPagination() with no opts, whose default caps the
 * result at 100 rows; kept literal here to preserve behaviour. (A hard cap on
 * the publish index is a latent limit worth revisiting separately, not in this
 * behaviour-preserving strip.)
 * @param {object} ctx - Storage context
 * @returns {Promise<Array<object>>}
 */
async function listPublishedRows(ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('published_presentations')
    .selectAll()
    .where('organization_id', '=', orgId)
    .orderBy('modified_at', 'desc')
    .limit(100)
    .execute();

  return rows.map(mapPublishedRow);
}

/**
 * One publish row by its public id, deliberately **unscoped** (the id is the
 * authorization). Returns null when absent.
 * @param {string} publishId
 * @returns {Promise<object|null>}
 */
async function getPublishedRow(publishId) {
  const db = getDb();

  const row = await db
    .selectFrom('published_presentations')
    .selectAll()
    .where('id', '=', publishId)
    .executeTakeFirst();

  if (!row) return null;
  return mapPublishedRow(row);
}

/**
 * Insert or update a publish row. Update is addressed by id; insert stamps the
 * organization. Mirrors the previous adapter upsert exactly.
 * @param {{id: string, presentationId: string, title: string, slug: string, ogImageUrl: string}} data
 * @param {object} ctx - Storage context
 * @returns {Promise<object>}
 */
async function upsertPublishedRow(data, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);
  const timestamp = now();

  const existing = await getPublishedRow(data.id);

  if (existing) {
    const row = await db
      .updateTable('published_presentations')
      .set({
        title: data.title,
        slug: data.slug,
        og_image_url: data.ogImageUrl,
        modified_at: timestamp,
      })
      .where('id', '=', data.id)
      .returningAll()
      .executeTakeFirst();

    return mapPublishedRow(row);
  }

  const row = await db
    .insertInto('published_presentations')
    .values({
      id: data.id,
      organization_id: orgId,
      presentation_id: data.presentationId,
      title: data.title,
      slug: data.slug,
      og_image_url: data.ogImageUrl,
    })
    .returningAll()
    .executeTakeFirst();

  return mapPublishedRow(row);
}

/**
 * Delete a publish row within the organization.
 * @param {string} publishId
 * @param {object} ctx - Storage context
 * @returns {Promise<boolean>}
 */
async function deletePublishedRow(publishId, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const result = await db
    .deleteFrom('published_presentations')
    .where('id', '=', publishId)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();

  return result.numDeletedRows > 0;
}

export function newPublishId() {
  // Short, URL-friendly, unique enough for public share links.
  return crypto.randomUUID().split('-')[0];
}

/**
 * The publish index of the storageScope's organization, keyed by publish id.
 * @param {import('../scope.js').StorageScope} storageScope
 * @returns {Promise<Object>}
 */
export async function getPublishedIndex(storageScope) {
  const ctx = resolveScope(storageScope, 'getPublishedIndex');
  const list = await listPublishedRows(ctx);
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

/**
 * Fetch one publish entry by its public publish id.
 *
 * The only cross-organization-capable function here: the publish id is the
 * authorization, and public viewer/embed routes have no session to take an
 * organization from.
 *
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} publishId
 * @returns {Promise<Object|null>}
 */
export async function getPublishedById(storageScope, publishId) {
  const allowCross = { allowCrossOrganization: true };
  resolveScope(storageScope, 'getPublishedById', allowCross);
  const id = String(publishId || '').trim();
  if (!id) return null;

  const entry = await getPublishedRow(id);
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

/**
 * Create or update the publish entry of a deck in the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {{publishId: string, presentationId: string, title?: string, ogImageUrl?: string}} entry
 * @returns {Promise<Object>}
 */
export async function upsertPublishedEntry(
  storageScope,
  { publishId, presentationId, title, ogImageUrl }
) {
  const ctx = resolveScope(storageScope, 'upsertPublishedEntry');
  const id = String(publishId || '').trim();
  const pid = String(presentationId || '').trim();
  if (!id) throw new Error('publishId is required');
  if (!pid) throw new Error('presentationId is required');

  const slug = safeSlug(title || 'presentation');
  const result = await upsertPublishedRow({
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

/**
 * Unpublish: drop the publish entry within the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} publishId
 * @returns {Promise<boolean>}
 */
export async function removePublishedEntry(storageScope, publishId) {
  const ctx = resolveScope(storageScope, 'removePublishedEntry');
  const id = String(publishId || '').trim();
  if (!id) return false;

  return deletePublishedRow(id, ctx);
}

/**
 * Rename the public slug of a publish entry in the storageScope's organization.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} publishId
 * @param {string} nextSlug
 * @returns {Promise<Object>}
 */
export async function updatePublishedSlug(storageScope, publishId, nextSlug) {
  const ctx = resolveScope(storageScope, 'updatePublishedSlug');
  const id = String(publishId || '').trim();
  if (!id) throw new Error('publishId is required');

  const existing = await getPublishedRow(id);
  if (!existing) throw new Error('Published entry not found');

  const slug = safeSlug(nextSlug);
  const result = await upsertPublishedRow({
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

/**
 * List published presentations with full metadata for RSS feed generation.
 * Joins published entries with presentation data, excludes opted-out decks.
 *
 * The feed lists one organization's published decks, so the caller states which
 * one; the per-deck read is then addressed by publish id and deliberately
 * unscoped (see {@link getPublishedById}).
 *
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {Object} [opts]
 * @param {number} [opts.limit=50] - Maximum items to return
 * @returns {Array} Enriched published presentation records
 */
export async function listPublishedForFeed(storageScope, opts = {}) {
  resolveScope(storageScope, 'listPublishedForFeed');
  const { limit = 50 } = opts;
  const repoRoot = repoRootOf(storageScope);

  const index = await getPublishedIndex(storageScope);
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
