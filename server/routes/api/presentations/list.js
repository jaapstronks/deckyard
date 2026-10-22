import { listPresentationPage } from '../../../services/presentations.js';
import { getTagsForPresentations } from '../../../storage/tags.js';
import { serveJson } from '../../../utils/http.js';
import { withDeckCardFields } from '../../../utils/deck-card-fields.js';
import {
  getPublishedPresentationIds,
  getCollaboratorCounts,
} from '../../../storage/presentations/index.js';

/**
 * The deck-list input as the internal API spells it in query parameters:
 * `ownership`, `visibility`, one `tag` per tag name, and the page (`limit`,
 * `cursor`; `offset` is passed on to be refused, D358). The service checks
 * every value.
 *
 * @param {URLSearchParams} params
 * @returns {Object}
 */
export function deckListInput(params) {
  return {
    ownership: params.get('ownership') ?? undefined,
    visibility: params.get('visibility') ?? undefined,
    tags: params.has('tag') ? params.getAll('tag') : undefined,
    limit: params.get('limit') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
    ...(params.has('offset') ? { offset: params.get('offset') } : {}),
  };
}

/**
 * The deck grid's cards for a page of listed decks: tags, published state and
 * collaborator count (this API's own enrichment), plus the fields every
 * deck-card producer owes the grid. Shared by Home, shared-with-me and search,
 * so a card looks the same whichever list it came from.
 *
 * @param {string} repoRoot
 * @param {import('../../../storage/scope.js').StorageScope} storageScope
 * @param {Object[]} presentations - Decks as `listDecks` projects them.
 * @returns {Promise<Object[]>}
 */
export async function toDeckGridCards(repoRoot, storageScope, presentations) {
  const ids = presentations.map((p) => p.id);
  // The organization rides along on the request's storage scope, so these
  // stay in the session's organization instead of resolving against the
  // instance default.
  const [tagsMap, publishedSet, collaboratorCounts] = await Promise.all([
    getTagsForPresentations(storageScope, ids),
    getPublishedPresentationIds(storageScope, ids),
    getCollaboratorCounts(storageScope, ids),
  ]);
  return withDeckCardFields(
    repoRoot,
    presentations.map((p) => ({
      ...p,
      tags: tagsMap.get(p.id) || [],
      isPublished: publishedSet.has(p.id),
      collaboratorCount: collaboratorCounts.get(p.id) || 0,
    })),
    storageScope,
  );
}

/**
 * GET /api/presentations — one page of the session user's decks (Home), on
 * the list-page contract (D358, B821): `{ presentations, nextCursor }`. Who
 * sees what, the filters and the page are `listPresentationPage`'s.
 */
export async function handlePresentationsList({
  repoRoot,
  storageScope,
  res,
  url,
  authedUser,
} = {}) {
  const { presentations, nextCursor } = await listPresentationPage(
    storageScope,
    { actor: authedUser },
    deckListInput(url.searchParams),
  );

  serveJson(res, 200, {
    presentations: await toDeckGridCards(repoRoot, storageScope, presentations),
    nextCursor,
  });
  return true;
}
