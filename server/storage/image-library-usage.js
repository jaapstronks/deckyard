/**
 * Image library usage lookup.
 *
 * Answers "which decks use this image, and are any of them published" for one
 * image library URL. It reads the decks straight from the presentations store
 * and joins them against the organization's publish index, so it takes a
 * storage scope rather than a bare repo root — see server/storage/scope.js.
 */

import { getStorage } from './adapters/index.js';
import { toStorageContext } from './backend-dispatch.js';
import { getPublishedIndex } from './published/index.js';

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
 * Where an image library URL is used across the scope's organization.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} url - The image URL to look for.
 * @returns {Promise<Array<Object>>} Newest-modified first.
 */
export async function getImageLibraryUsage(scope, url) {
  const ctx = toStorageContext(scope, 'getImageLibraryUsage');
  const u = String(url || '').trim();
  if (!u) return [];

  const idx = await getPublishedIndex(scope);
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

  const storage = getStorage();
  const decks = await storage.findPresentationsUsingUrl(u, ctx);

  return decks.map((pres) => ({
    id: pres.id,
    title: pickTitle(pres),
    modified: pres.modified || null,
    published: publishedByPresId.get(pres.id) || [],
  }));
}
