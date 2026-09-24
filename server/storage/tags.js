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
import { escapeLikePattern } from './utils/index.js';

/**
 * The tables that link a tag to a row: the column each keys the row on, and the
 * table that row lives in. One mapping, so a caller names the link table and
 * cannot pair it with the wrong column or the wrong owner.
 */
const LINK_TABLES = {
  presentation_tags: { column: 'presentation_id', owner: 'presentations' },
  slide_library_tags: { column: 'slide_library_id', owner: 'slide_library' },
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
 * The conflict target of `idx_tags_org_name`, spelled as the index spells it.
 *
 * The index is functional — `CREATE UNIQUE INDEX idx_tags_org_name ON tags
 * (organization_id, lower(name))` (migration 018) — so `ON CONFLICT` has to
 * name the expression, not a column pair; a column list would target an index
 * that does not exist and PostgreSQL would refuse the statement outright.
 */
const TAG_NAME_INDEX = sql`organization_id, lower(name)`;

/**
 * Resolve one tag name to the organization's tag row, creating it on first use
 * — the single place where a name becomes a tag (B373).
 *
 * It is written as an insert that may find the tag already there, rather than a
 * look followed by an insert, because those are two statements with a gap
 * between them: two requests in one organization writing the same not-yet-
 * existing name both missed the look, both inserted, and one came back with a
 * `23505` the client saw as a 500. Within a single request it could not happen
 * — a transaction sees its own insert — so it was a race *between* requests,
 * and D187 left it outside the fold decision for that reason.
 *
 * The shape removes the race instead of catching it: `ON CONFLICT … DO NOTHING`
 * makes a name another writer already took a no-op rather than an error, and
 * the select that follows reads the row that won. **That select is not a race
 * arm.** It answers "the tag the database already had", whether from last week
 * or from a writer that committed a millisecond ago — the two cases are one
 * case, which is why there is no retry and no error swallowed anywhere here.
 * `DO UPDATE` would also return the row in one statement, but it rewrites and
 * row-locks every tag on every save, and two saves touching the same two tags
 * in opposite order would deadlock — a 500 traded for a rarer 500.
 *
 * **The fold stays the database's** (D187): the index keys on PostgreSQL's
 * `lower()`, so both the conflict target and the lookup below lowercase in SQL.
 * A JavaScript `toLowerCase()` here would be a second authority on tag identity
 * and is exactly what B370 removed.
 *
 * @param {import('kysely').Kysely<any>|import('kysely').Transaction<any>} executor
 * @param {string} orgId
 * @param {string} name - Already validated by {@link validateTagNames}
 * @returns {Promise<{id: string, name: string}>}
 */
async function resolveTag(executor, orgId, name) {
  const inserted = await executor
    .insertInto('tags')
    .values({ organization_id: orgId, name, created_at: nowIso() })
    .onConflict((oc) => oc.expression(TAG_NAME_INDEX).doNothing())
    .returning(['id', 'name'])
    .executeTakeFirst();
  if (inserted) return inserted;

  const existing = await executor
    .selectFrom('tags')
    .select(['id', 'name'])
    .where('organization_id', '=', orgId)
    .where(
      executor.fn('lower', ['name']),
      '=',
      executor.fn('lower', [sql.val(name)]),
    )
    .executeTakeFirst();
  if (existing) return existing;

  // Neither inserted nor found: the row the insert yielded to is gone again,
  // which takes a concurrent delete landing in the gap. Say so rather than
  // hand the caller an undefined tag id.
  throw new Error(`resolveTag: tag "${name}" was neither inserted nor found`);
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
 * **The row must be the organization's** (B436). The replacement first
 * selects the row by id *and* `orgId`, locking it, and answers `not_found`
 * when it is not there; only then does it delete. The caller authorizes the row
 * (a deck route through `withPresentationAuth`, a library item through
 * `whereItem`), so this is defense in depth: a caller that forgets cannot wipe
 * another organization's links. Before B436 the presentation route did forget,
 * and the delete ran on the id alone.
 *
 * Selection, delete and insert run in **one transaction** (B343). They used to
 * be loose statements in two near-identical copies: the delete landed, and a
 * failure anywhere after it left the row with no tags at all — data loss with
 * no way back. A failure now rolls the whole replacement back, so the previous
 * tags stay and the caller sees the error.
 *
 * Tags themselves are the organization's, reused case-insensitively and created
 * on first use through {@link resolveTag}. **The database owns that fold**:
 * `idx_tags_org_name` is unique on `(organization_id, lower(name))`, so the
 * lookup lowercases through PostgreSQL and the list is deduplicated on the tag
 * it resolved to, never on a JavaScript approximation of `lower()` (B370).
 *
 * @param {object} params
 * @param {'presentation_tags'|'slide_library_tags'} params.linkTable
 * @param {string} params.rowId - The presentation or library item
 * @param {string} params.orgId
 * @param {string[]} params.tagNames
 * @returns {Promise<{ok: true, tags: Array<{id: string, name: string}>}|{ok: false, reason: 'not_found'}|{ok: false, reason: 'invalid', field: 'tags', fieldProblem: object, message: string}>}
 */
export async function replaceTagLinks({ linkTable, rowId, orgId, tagNames }) {
  const link = LINK_TABLES[linkTable];
  // Reaching this with another table is a caller bug, not an input error.
  if (!link) {
    throw new TypeError(`replaceTagLinks: unknown link table "${linkTable}"`);
  }
  const { column: linkColumn, owner } = link;
  const validated = validateTagNames(tagNames);
  if (!validated.ok) return validated;
  const names = validated.names;

  const tags = await transaction(async (trx) => {
    const row = await trx
      .selectFrom(owner)
      .select('id')
      .where('id', '=', rowId)
      .where('organization_id', '=', orgId)
      .forUpdate()
      .executeTakeFirst();
    if (!row) return null;

    await trx.deleteFrom(linkTable).where(linkColumn, '=', rowId).execute();
    if (names.length === 0) return [];

    /** The tags this row will carry, in first-seen order, each one once. */
    const resolved = [];
    const seenIds = new Set();
    for (const name of names) {
      const tag = await resolveTag(trx, orgId, name);

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

  if (!tags) return { ok: false, reason: 'not_found' };
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
 * A deck outside the scope's organization is `not_found`.
 * @param {import('./scope.js').StorageScope} storageScope
 * @param {string} presentationId - Presentation ID
 * @param {string[]} tagNames - Array of tag names
 * @returns {Promise<{ok: true, tags: Array<{id: string, name: string}>}|{ok: false, reason: 'not_found'}|{ok: false, reason: 'invalid', field: 'tags', fieldProblem: object, message: string}>}
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
 * answer to "what may a tag be called", not one per entry point — and creates
 * it through the same {@link resolveTag}, so neither entry point carries a
 * lookup-then-insert gap the other has closed. It refuses through the storage
 * vocabulary rather than a thrown 400, so both surfaces answer in the one
 * envelope `storageError()` writes.
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

  // Create-or-get runs through the same resolver as a tag write: one place
  // where a name becomes a tag, so this entry point cannot race where the
  // other one does not (B373).
  const tag = await resolveTag(db, orgId, tagName);

  return { ok: true, tag: { id: tag.id, name: tag.name } };
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
 *
 * Case folding is PostgreSQL's, once: `lower()` on both sides of the
 * comparison. That is the same authority tag *identity* runs on — the unique
 * index on `(organization_id, lower(name))` from migration 018, which
 * `resolveTag` matches against — so search cannot disagree with it about what
 * two spellings of a name mean. Folding the prefix in JavaScript instead put a
 * second folder on one comparison, and the two can differ: `'İ'` (U+0130)
 * lowercases to `i` + a combining dot in JavaScript, and to a bare `i` under
 * PostgreSQL's `lower()` (measured on `en_US.utf8`), so a tag whose name
 * starts with it could not be found by typing that name.
 *
 * The prefix is escaped, so a typed `%`, `_` or `\` is a letter to match and
 * not a wildcard.
 *
 * @param {import('./scope.js').StorageScope} storageScope
 * @param {string} prefix - Search prefix
 * @param {number} [limit=10] - Max results
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export async function searchTags(storageScope, prefix, limit = 10) {
  const ctx = resolveScope(storageScope, 'searchTags');
  const db = getDb();
  const orgId = getOrgId(ctx);

  const searchTerm = String(prefix || '').trim();
  if (!searchTerm) {
    return listTags(storageScope);
  }
  const pattern = `${escapeLikePattern(searchTerm)}%`;

  const rows = await db
    .selectFrom('tags')
    .leftJoin('presentation_tags', 'tags.id', 'presentation_tags.tag_id')
    .select([
      'tags.id',
      'tags.name',
      db.fn.count('presentation_tags.presentation_id').as('count'),
    ])
    .where('tags.organization_id', '=', orgId)
    .where(
      db.fn('lower', ['tags.name']),
      'like',
      db.fn('lower', [sql.val(pattern)]),
    )
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
