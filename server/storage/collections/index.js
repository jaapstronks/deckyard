/**
 * Slide collections storage facade.
 *
 * A collection is a named, ordered, scoped set of slide-library item ids. It
 * references existing slide_library rows via the slide_collection_items join
 * table (ordered by `position`); it never copies slide content.
 *
 * Every function takes a **storage scope** rather than a bare `repoRoot`, so the
 * organization comes from the caller instead of a hardcoded default — see
 * server/storage/scope.js. `userEmail` stays separate where it appears: it names
 * the subject of a personal-collection operation, not who the write is
 * attributed to.
 *
 * Two unrelated axes live here, and they no longer share a word: the storage
 * scope (which organization) and a collection's own `shelf: 'personal' |
 * 'organization'` (which shelf it lives on — a person's or the shared one).
 *
 * Queries run directly through Kysely (B79/D34 removed the adapter
 * indirection); getDb() throws on an uninitialized database.
 */

import { getDb } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { resolveIdentityByEmail } from '../identity-resolver.js';
import { toStorageContext } from '../scope.js';

/** @returns {string} current ISO timestamp */
function now() {
  return new Date().toISOString();
}

function cleanName(input) {
  return typeof input?.name === 'string' ? input.name.trim() : '';
}

/**
 * Map a slide_collections row to the facade's API object.
 * @param {object} row - Database row from slide_collections
 * @param {string[]} [slideIds] - Ordered member slide-library ids
 * @returns {object}
 */
function mapSlideCollectionRow(row, slideIds = []) {
  return {
    id: row.id,
    shelf: row.shelf,
    ownerEmail: row.owner_email,
    name: row.name,
    description: row.description || '',
    slideIds: Array.isArray(slideIds) ? slideIds : [],
    slideCount: Array.isArray(slideIds) ? slideIds.length : 0,
    // Identity pair (T10 PR F2): the team-collection mutate guard matches on
    // `createdById`, with the e-mail as the fallback. See shared/identity-match.js.
    createdById: row.created_by_user_id || null,
    createdBy: row.created_by,
    updatedById: row.updated_by_user_id || null,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Load ordered member slide ids for a set of collections.
 * @param {import('kysely').Kysely} db
 * @param {string[]} collectionIds
 * @returns {Promise<Map<string, string[]>>} collectionId -> ordered slideIds
 */
async function loadMembership(db, collectionIds) {
  const result = new Map();
  if (!collectionIds || collectionIds.length === 0) return result;

  const rows = await db
    .selectFrom('slide_collection_items')
    .select(['collection_id', 'slide_library_id', 'position'])
    .where('collection_id', 'in', collectionIds)
    .orderBy('position', 'asc')
    .execute();

  for (const row of rows) {
    if (!result.has(row.collection_id)) result.set(row.collection_id, []);
    result.get(row.collection_id).push(row.slide_library_id);
  }
  return result;
}

/**
 * Keep only ids that reference existing slide_library rows in this org,
 * de-duplicated and preserving the requested order. Guards the join-table FK.
 * @param {import('kysely').Kysely} db
 * @param {string} orgId
 * @param {string[]} slideIds
 * @returns {Promise<string[]>}
 */
async function filterExistingSlideIds(db, orgId, slideIds) {
  const cleaned = [];
  const seen = new Set();
  for (const raw of Array.isArray(slideIds) ? slideIds : []) {
    const id = String(raw || '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      cleaned.push(id);
    }
  }
  if (cleaned.length === 0) return [];

  const rows = await db
    .selectFrom('slide_library')
    .select('id')
    .where('organization_id', '=', orgId)
    .where('id', 'in', cleaned)
    .execute();
  const existing = new Set(rows.map((r) => String(r.id)));
  return cleaned.filter((id) => existing.has(id));
}

/**
 * Replace a collection's ordered membership.
 * @param {import('kysely').Kysely} db
 * @param {string} orgId
 * @param {string} collectionId
 * @param {string[]} slideIds
 * @returns {Promise<string[]>} the stored (validated) slide ids in order
 */
async function replaceMembership(db, orgId, collectionId, slideIds) {
  const valid = await filterExistingSlideIds(db, orgId, slideIds);

  await db
    .deleteFrom('slide_collection_items')
    .where('collection_id', '=', collectionId)
    .execute();

  if (valid.length > 0) {
    await db
      .insertInto('slide_collection_items')
      .values(
        valid.map((slideId, index) => ({
          collection_id: collectionId,
          slide_library_id: slideId,
          position: index,
          created_at: now(),
        }))
      )
      .execute();
  }
  return valid;
}

// ============================================================
// Storage queries (organization-scoped)
// ============================================================

/**
 * @param {object} ctx - Storage context
 * @param {object} [opts]
 * @param {string} [opts.shelf] - 'personal' or 'organization'
 * @param {string} [opts.ownerEmail] - filter to an owner (personal)
 */
async function listSlideCollections(ctx, opts = {}) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  let query = db
    .selectFrom('slide_collections')
    .selectAll()
    .where('organization_id', '=', orgId);

  if (opts?.shelf) query = query.where('shelf', '=', opts.shelf);
  if (opts?.ownerEmail) query = query.where('owner_email', '=', opts.ownerEmail);

  query = query.orderBy('created_at', 'desc');
  const rows = await query.execute();

  const membership = await loadMembership(db, rows.map((r) => r.id));
  return rows.map((row) => mapSlideCollectionRow(row, membership.get(row.id) || []));
}

async function getSlideCollection(id, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const row = await db
    .selectFrom('slide_collections')
    .selectAll()
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();

  if (!row) return null;
  const membership = await loadMembership(db, [row.id]);
  return mapSlideCollectionRow(row, membership.get(row.id) || []);
}

async function createSlideCollection(data, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  // Dual-key (T10 PR F2): resolve the id once and stamp it beside both the
  // created_by and updated_by e-mail (the same actor at create), so the
  // team-collection mutate guard can match on the stable id.
  const actorEmail = ctx?.actorEmail || null;
  const actorResolution = actorEmail ? await resolveIdentityByEmail(actorEmail) : null;
  const actorUserId = actorResolution?.userId ?? null;

  const row = await db
    .insertInto('slide_collections')
    .values({
      organization_id: orgId,
      owner_email: data.ownerEmail || ctx?.actorEmail || null,
      shelf: data.shelf || 'personal',
      name: data.name,
      description: data.description || null,
      created_by: actorEmail,
      created_by_user_id: actorUserId,
      updated_by: actorEmail,
      updated_by_user_id: actorUserId,
    })
    .returningAll()
    .executeTakeFirst();

  const slideIds = await replaceMembership(db, orgId, row.id, data.slideIds || []);
  return mapSlideCollectionRow(row, slideIds);
}

async function updateSlideCollection(id, data, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  // Dual-key (T10 PR F2): stamp updated_by_user_id from the same resolution
  // only when there is an actor, so an actor-less write never nulls the id
  // half while the e-mail half keeps the previous writer.
  const updateData = {
    updated_at: now(),
  };
  if (ctx?.actorEmail) {
    const actorResolution = await resolveIdentityByEmail(ctx.actorEmail);
    updateData.updated_by = ctx.actorEmail;
    updateData.updated_by_user_id = actorResolution?.userId ?? null;
  }
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;

  const row = await db
    .updateTable('slide_collections')
    .set(updateData)
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .returningAll()
    .executeTakeFirst();

  if (!row) return null;

  let slideIds;
  if (data.slideIds !== undefined) {
    slideIds = await replaceMembership(db, orgId, id, data.slideIds || []);
  } else {
    const membership = await loadMembership(db, [id]);
    slideIds = membership.get(id) || [];
  }
  return mapSlideCollectionRow(row, slideIds);
}

async function deleteSlideCollection(id, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const result = await db
    .deleteFrom('slide_collections')
    .where('id', '=', id)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();

  return result.numDeletedRows > 0;
}

// ============================================================
// Personal collections
// ============================================================

export async function listPersonalCollections(storageScope, userEmail) {
  const ctx = toStorageContext(storageScope, 'listPersonalCollections', { userEmail });
  const items = await listSlideCollections(ctx, {
    shelf: 'personal',
    ownerEmail: String(userEmail || '').toLowerCase(),
  });
  return { items };
}

export async function getPersonalCollection(storageScope, userEmail, id) {
  const ctx = toStorageContext(storageScope, 'getPersonalCollection', { userEmail });
  const item = await getSlideCollection(id, ctx);
  if (!item || item.shelf !== 'personal') return null;
  const owner = String(userEmail || '').toLowerCase();
  if (String(item.ownerEmail || '').toLowerCase() !== owner) return null;
  return item;
}

export async function createPersonalCollection(storageScope, userEmail, input, { actorEmail } = {}) {
  const ctx = toStorageContext(storageScope, 'createPersonalCollection', { userEmail, actorEmail });
  if (!cleanName(input)) return { ok: false, reason: 'name_required' };
  const item = await createSlideCollection(
    {
      name: cleanName(input),
      description: input?.description,
      slideIds: input?.slideIds,
      shelf: 'personal',
      ownerEmail: String(userEmail || '').toLowerCase(),
    },
    ctx
  );
  if (!item) return { ok: false, reason: 'create_failed' };
  return { ok: true, item };
}

export async function updatePersonalCollection(storageScope, userEmail, id, patch, { actorEmail } = {}) {
  const ctx = toStorageContext(storageScope, 'updatePersonalCollection', { userEmail, actorEmail });
  // Ownership check: only the owner may mutate their personal collection.
  const existing = await getSlideCollection(id, ctx);
  const owner = String(userEmail || '').toLowerCase();
  if (
    !existing ||
    existing.shelf !== 'personal' ||
    String(existing.ownerEmail || '').toLowerCase() !== owner
  ) {
    return { ok: false, reason: 'not_found' };
  }
  const item = await updateSlideCollection(id, patch, ctx);
  if (!item) return { ok: false, reason: 'not_found' };
  return { ok: true, item };
}

export async function deletePersonalCollection(storageScope, userEmail, id) {
  const ctx = toStorageContext(storageScope, 'deletePersonalCollection', { userEmail });
  const existing = await getSlideCollection(id, ctx);
  const owner = String(userEmail || '').toLowerCase();
  if (
    !existing ||
    existing.shelf !== 'personal' ||
    String(existing.ownerEmail || '').toLowerCase() !== owner
  ) {
    return { ok: false, reason: 'not_found' };
  }
  const deleted = await deleteSlideCollection(id, ctx);
  if (!deleted) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

// ============================================================
// Team collections
// ============================================================

export async function listTeamCollections(storageScope, { userEmail = '' } = {}) {
  const ctx = toStorageContext(storageScope, 'listTeamCollections', { userEmail });
  const items = await listSlideCollections(ctx, { shelf: 'organization' });
  return { items };
}

export async function getTeamCollection(storageScope, id, { userEmail = '' } = {}) {
  const ctx = toStorageContext(storageScope, 'getTeamCollection', { userEmail });
  const item = await getSlideCollection(id, ctx);
  if (!item || item.shelf !== 'organization') return null;
  return item;
}

export async function createTeamCollection(storageScope, input, { actorEmail } = {}) {
  const ctx = toStorageContext(storageScope, 'createTeamCollection', { actorEmail });
  if (!cleanName(input)) return { ok: false, reason: 'name_required' };
  const item = await createSlideCollection(
    {
      name: cleanName(input),
      description: input?.description,
      slideIds: input?.slideIds,
      shelf: 'organization',
    },
    ctx
  );
  if (!item) return { ok: false, reason: 'create_failed' };
  return { ok: true, item };
}

export async function updateTeamCollection(storageScope, id, patch, { actorEmail, allowMutate } = {}) {
  const ctx = toStorageContext(storageScope, 'updateTeamCollection', { actorEmail });
  const existing = await getSlideCollection(id, ctx);
  if (!existing || existing.shelf !== 'organization') return { ok: false, reason: 'not_found' };
  if (typeof allowMutate === 'function') {
    const ok = await allowMutate(existing, { actorEmail });
    if (!ok) return { ok: false, reason: 'forbidden' };
  }
  const item = await updateSlideCollection(id, patch, ctx);
  if (!item) return { ok: false, reason: 'not_found' };
  return { ok: true, item };
}

export async function deleteTeamCollection(storageScope, id, { actorEmail, allowMutate } = {}) {
  const ctx = toStorageContext(storageScope, 'deleteTeamCollection', { actorEmail });
  const existing = await getSlideCollection(id, ctx);
  if (!existing || existing.shelf !== 'organization') return { ok: false, reason: 'not_found' };
  if (typeof allowMutate === 'function') {
    const ok = await allowMutate(existing, { actorEmail });
    if (!ok) return { ok: false, reason: 'forbidden' };
  }
  const deleted = await deleteSlideCollection(id, ctx);
  if (!deleted) return { ok: false, reason: 'not_found' };
  return { ok: true };
}
