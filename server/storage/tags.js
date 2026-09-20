/**
 * Tags storage facade.
 *
 * Tags are per-organization, and these functions used to have no way of hearing
 * which one: they built their own context from a hardcoded default. Every
 * function now takes a **storage scope** as its first argument, so the
 * organization is the caller's answer, not storage's guess — see
 * server/storage/scope.js.
 *
 * These used to degrade to empty results when storage was uninitialized. That
 * case no longer exists: PostgreSQL is the only backend, so an uninitialized
 * database is a boot bug and `getDb()` throws instead of quietly returning
 * nothing. Queries run directly through Kysely (B79/D34 removed the adapter
 * indirection); the shapes below are the storage contract for tags.
 */

import { sql } from 'kysely';

import { getDb, transaction } from '../db/client.js';
import { getOrgId } from '../utils/context.js';
import { nowIso } from '../utils/normalize.js';
import { checkTagName, TAG_NAME_MESSAGES } from '../../shared/tag-name.js';
import { resolveScope } from './scope.js';

/**
 * The tables that link a tag to a row, and the column each keys the row on.
 * One mapping, so a caller names the table and cannot pair it with the wrong
 * column.
 */
const LINK_COLUMN = {
  presentation_tags: 'presentation_id',
  slide_library_tags: 'slide_library_id',
};

/**
 * The located half of an `invalid` result for a refused tag name — everything
 * but the field, which each mint site spells out as a literal so the
 * vocabulary gate can read it (`tests/storage-reason-vocabulary.test.js`).
 * `index` rides along only when the name came out of a list, because there is
 * nowhere to point otherwise.
 *
 * @param {string} code
 * @param {number|null} index
 * @returns {{fieldProblem: object, message: string}}
 */
function tagNameProblem(code, index) {
  return {
    fieldProblem: index == null ? { code } : { code, index },
    message: TAG_NAME_MESSAGES[code],
  };
}

/**
 * Validate a whole list of tag names, refusing on the first bad one and saying
 * where it sits — `details.field` plus `details.index` on the wire, so a client
 * can point at the offending chip instead of parsing a sentence.
 *
 * The list is **not** deduplicated here. Two names are the same tag when the
 * database says so (`idx_tags_org_name` is unique on `lower(name)`), and
 * JavaScript's fold is not the database's: `'İ'.toLowerCase()` is `i` + a
 * combining dot, where PostgreSQL's `lower('İ')` is a plain `i`. A second fold
 * here would be a second authority on tag identity, and it was exactly that
 * disagreement that let two names through as one tag row and crashed the write
 * (B370). {@link replaceTagLinks} dedupes on the resolved tag instead.
 *
 * @param {string[]} tagNames
 * @returns {{ok: true, names: string[]}|{ok: false, reason: 'invalid', field: 'tags', fieldProblem: {code: string, index: number}, message: string}}
 */
function validateTagNames(tagNames) {
  const names = [];
  const list = tagNames || [];
  for (let index = 0; index < list.length; index += 1) {
    const checked = checkTagName(list[index]);
    if (!checked.ok) {
      return {
        ok: false,
        reason: 'invalid',
        field: 'tags',
        ...tagNameProblem(checked.code, index),
      };
    }
    names.push(checked.name);
  }
  return { ok: true, names };
}

/**
 * Replace every tag link of one row — the single tag-replacement path, for
 * presentations and for library items alike (D184).
 *
 * Selection, delete and insert run in **one transaction** (B343). They used to
 * be loose statements in two near-identical copies: the delete landed, and a
 * failure anywhere after it left the row with no tags at all — data loss with
 * no way back. A failure now rolls the whole replacement back, so the previous
 * tags stay and the caller sees the error.
 *
 * Tags themselves are the organization's, reused case-insensitively and created
 * on first use. **The database owns that fold**: `idx_tags_org_name` is unique
 * on `(organization_id, lower(name))`, so the lookup lowercases through
 * PostgreSQL and the list is deduplicated on the tag it resolved to, never on a
 * JavaScript approximation of `lower()` (B370).
 *
 * @param {object} params
 * @param {'presentation_tags'|'slide_library_tags'} params.linkTable
 * @param {string} params.rowId - The presentation or library item
 * @param {string} params.orgId
 * @param {string[]} params.tagNames
 * @returns {Promise<{ok: true, tags: Array<{id: string, name: string}>}|{ok: false, reason: 'invalid', field: 'tags', fieldProblem: object, message: string}>}
 */
export async function replaceTagLinks({ linkTable, rowId, orgId, tagNames }) {
  const linkColumn = LINK_COLUMN[linkTable];
  // Reaching this with another table is a caller bug, not an input error.
  if (!linkColumn) {
    throw new TypeError(`replaceTagLinks: unknown link table "${linkTable}"`);
  }
  const validated = validateTagNames(tagNames);
  if (!validated.ok) return validated;
  const names = validated.names;

  const tags = await transaction(async (trx) => {
    await trx.deleteFrom(linkTable).where(linkColumn, '=', rowId).execute();
    if (names.length === 0) return [];

    /** The tags this row will carry, in first-seen order, each one once. */
    const resolved = [];
    const seenIds = new Set();
    for (const name of names) {
      let tag = await trx
        .selectFrom('tags')
        .select(['id', 'name'])
        .where('organization_id', '=', orgId)
        .where(trx.fn('lower', ['name']), '=', trx.fn('lower', [sql.val(name)]))
        .executeTakeFirst();

      if (!tag) {
        tag = await trx
          .insertInto('tags')
          .values({ organization_id: orgId, name, created_at: nowIso() })
          .returning(['id', 'name'])
          .executeTakeFirst();
      }

      if (seenIds.has(tag.id)) continue;
      seenIds.add(tag.id);
      resolved.push({ id: tag.id, name: tag.name });
    }

    await trx
      .insertInto(linkTable)
      .values(
        resolved.map((tag) => ({
          [linkColumn]: rowId,
          tag_id: tag.id,
          created_at: nowIso(),
        })),
      )
      .execute();

    return resolved;
  });

  return { ok: true, tags };
}

/**
 * List all tags of the storageScope's organization.
 * @param {import('./scope.js').StorageScope} storageScope
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export async function listTags(storageScope) {
  const ctx = resolveScope(storageScope, 'listTags');
  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('tags')
    .leftJoin('presentation_tags', 'tags.id', 'presentation_tags.tag_id')
    .select([
      'tags.id',
      'tags.name',
      db.fn.count('presentation_tags.presentation_id').as('count'),
    ])
    .where('tags.organization_id', '=', orgId)
    .groupBy(['tags.id', 'tags.name'])
    .orderBy('tags.name', 'asc')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    count: Number(row.count) || 0,
  }));
}

/**
 * Get tags for a specific presentation.
 * @param {import('./scope.js').StorageScope} storageScope
 * @param {string} presentationId - Presentation ID
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function getTagsForPresentation(storageScope, presentationId) {
  const ctx = resolveScope(storageScope, 'getTagsForPresentation');
  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('tags')
    .innerJoin('presentation_tags', 'tags.id', 'presentation_tags.tag_id')
    .select(['tags.id', 'tags.name'])
    .where('presentation_tags.presentation_id', '=', presentationId)
    .where('tags.organization_id', '=', orgId)
    .orderBy('tags.name', 'asc')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
  }));
}

/**
 * Get tags for multiple presentations at once (for list views).
 * @param {import('./scope.js').StorageScope} storageScope
 * @param {string[]} presentationIds - Array of presentation IDs
 * @returns {Promise<Map<string, Array<{id: string, name: string}>>>}
 */
export async function getTagsForPresentations(storageScope, presentationIds) {
  const ctx = resolveScope(storageScope, 'getTagsForPresentations');
  if (!presentationIds || presentationIds.length === 0) {
    return new Map();
  }

  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('tags')
    .innerJoin('presentation_tags', 'tags.id', 'presentation_tags.tag_id')
    .select([
      'presentation_tags.presentation_id as presentationId',
      'tags.id',
      'tags.name',
    ])
    .where('presentation_tags.presentation_id', 'in', presentationIds)
    .where('tags.organization_id', '=', orgId)
    .orderBy('tags.name', 'asc')
    .execute();

  const result = new Map();
  for (const row of rows) {
    if (!result.has(row.presentationId)) {
      result.set(row.presentationId, []);
    }
    result.get(row.presentationId).push({
      id: row.id,
      name: row.name,
    });
  }

  return result;
}

/**
 * Set tags for a presentation (replaces existing tags).
 * Creates new tags if they don't exist. Atomic: see {@link replaceTagLinks}.
 * @param {import('./scope.js').StorageScope} storageScope
 * @param {string} presentationId - Presentation ID
 * @param {string[]} tagNames - Array of tag names
 * @returns {Promise<{ok: true, tags: Array<{id: string, name: string}>}|{ok: false, reason: 'invalid', field: 'tags', fieldProblem: object, message: string}>}
 */
export async function setTagsForPresentation(
  storageScope,
  presentationId,
  tagNames,
) {
  const ctx = resolveScope(storageScope, 'setTagsForPresentation');
  return replaceTagLinks({
    linkTable: 'presentation_tags',
    rowId: presentationId,
    orgId: getOrgId(ctx),
    tagNames,
  });
}

/**
 * Create a new tag in the storageScope's organization (if it doesn't exist).
 *
 * Takes the same name contract as a tag write ({@link replaceTagLinks}) — one
 * answer to "what may a tag be called", not one per entry point — and refuses
 * through the storage vocabulary rather than a thrown 400, so both surfaces
 * answer in the one envelope `storageError()` writes.
 *
 * @param {import('./scope.js').StorageScope} storageScope
 * @param {string} name - Tag name
 * @returns {Promise<{ok: true, tag: {id: string, name: string}}|{ok: false, reason: 'invalid', field: 'name', fieldProblem: object, message: string}>}
 */
export async function createTag(storageScope, name) {
  const ctx = resolveScope(storageScope, 'createTag');

  // The name is judged before the database is reached: a refusal is the
  // caller's input, and it needs nothing looked up to say so.
  const checked = checkTagName(name);
  if (!checked.ok) {
    return {
      ok: false,
      reason: 'invalid',
      field: 'name',
      ...tagNameProblem(checked.code, null),
    };
  }
  const tagName = checked.name;

  const db = getDb();
  const orgId = getOrgId(ctx);

  // Check if tag already exists — through the database's fold, the same one
  // `idx_tags_org_name` keys on.
  const existing = await db
    .selectFrom('tags')
    .select(['id', 'name'])
    .where('organization_id', '=', orgId)
    .where(db.fn('lower', ['name']), '=', db.fn('lower', [sql.val(tagName)]))
    .executeTakeFirst();

  if (existing) {
    return { ok: true, tag: { id: existing.id, name: existing.name } };
  }

  // Create new tag.
  const row = await db
    .insertInto('tags')
    .values({
      organization_id: orgId,
      name: tagName,
      created_at: nowIso(),
    })
    .returning(['id', 'name'])
    .executeTakeFirst();

  return { ok: true, tag: { id: row.id, name: row.name } };
}

/**
 * Delete a tag from the storageScope's organization (and all its associations).
 * @param {import('./scope.js').StorageScope} storageScope
 * @param {string} tagId - Tag ID
 * @returns {Promise<boolean>}
 */
export async function deleteTag(storageScope, tagId) {
  const ctx = resolveScope(storageScope, 'deleteTag');
  const db = getDb();
  const orgId = getOrgId(ctx);

  const result = await db
    .deleteFrom('tags')
    .where('id', '=', tagId)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();

  return result.numDeletedRows > 0;
}

/**
 * Search tags by prefix (for autocomplete).
 * @param {import('./scope.js').StorageScope} storageScope
 * @param {string} prefix - Search prefix
 * @param {number} [limit=10] - Max results
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export async function searchTags(storageScope, prefix, limit = 10) {
  const ctx = resolveScope(storageScope, 'searchTags');
  const db = getDb();
  const orgId = getOrgId(ctx);

  const searchTerm = String(prefix || '')
    .trim()
    .toLowerCase();
  if (!searchTerm) {
    return listTags(storageScope);
  }

  const rows = await db
    .selectFrom('tags')
    .leftJoin('presentation_tags', 'tags.id', 'presentation_tags.tag_id')
    .select([
      'tags.id',
      'tags.name',
      db.fn.count('presentation_tags.presentation_id').as('count'),
    ])
    .where('tags.organization_id', '=', orgId)
    .where(db.fn('lower', ['tags.name']), 'like', `${searchTerm}%`)
    .groupBy(['tags.id', 'tags.name'])
    .orderBy('tags.name', 'asc')
    .limit(limit)
    .execute();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    count: Number(row.count) || 0,
  }));
}
