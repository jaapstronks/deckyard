/**
 * Image library usage lookup.
 *
 * Answers "which decks use this image, and are any of them published" for one
 * image library URL. It reads the decks straight from the presentations store
 * and joins them against the organization's publish index, so it takes a
 * storage scope rather than a bare repo root — see server/storage/scope.js.
 */

import { getDb, sql } from '../db/client.js';
import { getOrgId } from '../utils/context.js';
import { toStorageContext } from './scope.js';
import { getPublishedIndex } from './published.js';

/**
 * The title to show for a deck: its dominant language version's title when it
 * has one, the deck title otherwise.
 * @param {{title?: string, i18n?: Object|null}} pres
 * @returns {string}
 */
function pickTitle(pres) {
  const dominant =
    pres?.i18n?.dominant === 'nl' || pres?.i18n?.dominant === 'en-GB'
      ? pres.i18n.dominant
      : null;
  if (
    dominant &&
    pres?.i18n?.versions &&
    typeof pres.i18n.versions === 'object' &&
    pres.i18n.versions?.[dominant] &&
    typeof pres.i18n.versions[dominant] === 'object' &&
    typeof pres.i18n.versions[dominant].title === 'string' &&
    pres.i18n.versions[dominant].title.trim()
  ) {
    return pres.i18n.versions[dominant].title.trim();
  }
  return typeof pres?.title === 'string' ? pres.title : '';
}

/**
 * Find every (non-trashed) deck in the organization that uses an image URL.
 *
 * The match is a whole-value string equality anywhere under a slide's
 * `content`, in the base deck and in every `i18n` language version. It is
 * deliberately not a substring search: a deck uses an image when a field *is*
 * that URL, not when some prose happens to mention it. Trashed decks are
 * excluded, like the deck list: usage the user cannot see would only confuse
 * the count.
 *
 * @param {string} url - The exact URL to look for (already trimmed, non-empty).
 * @param {object} ctx - Storage context
 * @returns {Promise<Array<{id: string, title: string, modified: string, i18n: Object|null}>>}
 */
async function findPresentationsUsingUrl(url, ctx) {
  const db = getDb();
  const orgId = getOrgId(ctx);

  const rows = await db
    .selectFrom('presentations')
    .select(['id', 'title', 'i18n', 'modified_at as modified'])
    .where('organization_id', '=', orgId)
    .where('trashed_at', 'is', null)
    .where(
      sql`jsonb_path_exists(slides, '$[*].content.** ? (@ == $u)', jsonb_build_object('u', ${url}::text))
          or jsonb_path_exists(i18n, '$.versions.*.slides[*].content.** ? (@ == $u)', jsonb_build_object('u', ${url}::text))`,
    )
    .orderBy('modified_at', 'desc')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    modified: row.modified,
    i18n: row.i18n && typeof row.i18n === 'object' ? row.i18n : null,
  }));
}

/**
 * Where an image library URL is used across the storageScope's organization.
 *
 * @param {import('./scope.js').StorageScope} storageScope
 * @param {string} url - The image URL to look for.
 * @returns {Promise<Array<Object>>} Newest-modified first.
 */
export async function getImageLibraryUsage(storageScope, url) {
  const ctx = toStorageContext(storageScope, 'getImageLibraryUsage');
  const u = String(url || '').trim();
  if (!u) return [];

  const idx = await getPublishedIndex(storageScope);
  const publishedByPresId = new Map();
  for (const [publishId, entry] of Object.entries(idx || {})) {
    const pid = String(entry?.presentationId || '').trim();
    if (!pid) continue;
    const arr = publishedByPresId.get(pid) || [];
    arr.push({
      publishId,
      slug: entry?.slug || '',
      modified: entry?.modified || null,
      created: entry?.created || null,
    });
    publishedByPresId.set(pid, arr);
  }

  const decks = await findPresentationsUsingUrl(u, ctx);

  return decks.map((pres) => ({
    id: pres.id,
    title: pickTitle(pres),
    modified: pres.modified || null,
    published: publishedByPresId.get(pres.id) || [],
  }));
}
