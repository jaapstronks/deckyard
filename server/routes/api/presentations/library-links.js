/**
 * GET /api/presentations/:id/library-links - the library items this deck's
 * slides copy, as the deck's editor may see them (B904, B905, D223, D368).
 *
 * The editor reads two things from them. A slide whose item has a newer
 * revision than it took in or set aside gets the notice with View / Update /
 * Ignore (B904); an item comes with its current content, so viewing and
 * updating need no second request. A slide whose item the reader may not
 * change (`canEdit`, D170) is locked, labelled with its maker, until it is
 * unlinked (D368).
 *
 * Only someone who may edit the deck asks, and only items they may read come
 * back: an organization-shelf item, or a personal item of their own
 * (`getLibraryItemsByIds`). A ref is written by the deck's editor, so it is no
 * proof of access. A trashed item reports nothing: there is nothing to choose
 * and nobody left to defer to (brief § 8).
 */

import { methodNotAllowed, serveJson } from '../../../utils/http.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { getLibraryItemsByIds } from '../../../storage/slide-library.js';
import { canEditLibraryItem } from '../../../utils/library-item-authz.js';
import { libraryLinksOf } from '../../../../shared/slide-library/library-ref.js';

/**
 * The fields of an item the editor's notice, comparison, update and lock read.
 * @param {object} item
 * @param {object|null} authedUser
 * @returns {object}
 */
function linkEntry(item, authedUser) {
  return {
    id: item.id,
    revision: item.revision,
    name: item.name,
    slideType: item.slideType,
    themeId: item.themeId,
    content: item.content,
    i18n: item.i18n,
    createdBy: item.createdBy,
    updatedBy: item.updatedBy,
    updatedAt: item.updatedAt,
    canEdit: canEditLibraryItem(authedUser, item),
  };
}

export async function handlePresentationLibraryLinks(
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

  serveJson(res, 200, {
    ok: true,
    items: items
      .filter((item) => !item.trashedAt)
      .map((item) => linkEntry(item, authedUser)),
  });
  return true;
}
