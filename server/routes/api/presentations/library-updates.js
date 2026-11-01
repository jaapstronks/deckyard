/**
 * GET /api/presentations/:id/library-updates - the library items with a newer
 * revision than a linked slide of this deck has taken in or set aside (B904,
 * D223).
 *
 * The editor marks those slides and offers Update / Ignore; an item comes with
 * its current content, so viewing and updating need no second request. Only
 * someone who may edit the deck asks, and only items they may read come back:
 * an organization-shelf item, or a personal item of their own
 * (`getLibraryItemsByIds`). A ref is written by the deck's editor, so it is no
 * proof of access. A trashed item reports nothing: there is nothing to choose
 * (brief § 8).
 */

import { methodNotAllowed, serveJson } from '../../../utils/http.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { getLibraryItemsByIds } from '../../../storage/slide-library.js';
import {
  isNewerLibraryRevision,
  libraryLinksOf,
} from '../../../../shared/slide-library/library-ref.js';

/**
 * The fields of an item the editor's notice, comparison and update read.
 * @param {object} item
 * @returns {object}
 */
function updateEntry(item) {
  return {
    id: item.id,
    revision: item.revision,
    name: item.name,
    slideType: item.slideType,
    themeId: item.themeId,
    content: item.content,
    i18n: item.i18n,
    updatedBy: item.updatedBy,
    updatedAt: item.updatedAt,
  };
}

export async function handlePresentationLibraryUpdates(
  { storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const pres = await withPresentationAuth({
    storageScope,
    id,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const links = libraryLinksOf(pres);
  const items = links.length
    ? await getLibraryItemsByIds(
        storageScope,
        links.map((l) => l.itemId),
        { userEmail: authedUser?.email },
      )
    : [];
  const news = items.filter(
    (item) =>
      !item.trashedAt &&
      links.some(
        (l) =>
          l.itemId === item.id &&
          isNewerLibraryRevision(
            {
              revision: l.revision,
              ignoredRevision: l.ignoredRevision ?? undefined,
            },
            item.revision,
          ),
      ),
  );

  serveJson(res, 200, { ok: true, items: news.map(updateEntry) });
  return true;
}
