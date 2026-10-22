/**
 * Deck-list transport for the list views, on the list-page contract (D358,
 * B821): every request is one page, `{ presentations, nextCursor }`, and the
 * server decides which decks a filter keeps. The views never filter, count or
 * sort decks on their own: they would only see the pages loaded so far.
 */

/**
 * The query string of a deck-list request. `tags` becomes one `tag` per name;
 * an empty or missing value is left out.
 *
 * @param {Object} [params]
 * @param {string} [params.ownership] - `collection` | `owned` | `shared` | `all`
 * @param {string} [params.visibility] - `private` | `organization`
 * @param {string[]} [params.tags] - Keep decks carrying one of these tags.
 * @param {number} [params.limit]
 * @param {string|null} [params.cursor] - `nextCursor` of the previous page.
 * @returns {string} `?…`, or '' without parameters.
 */
function deckListQuery({ ownership, visibility, tags, limit, cursor } = {}) {
  const params = new URLSearchParams();
  if (ownership) params.set('ownership', ownership);
  if (visibility) params.set('visibility', visibility);
  for (const tag of tags || []) params.append('tag', tag);
  if (limit) params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * A listed deck as the grid reads it. A deck the reader holds through a
 * collaborator row carries the grant (`permission`, `sharedBy`); the card
 * marks it as shared with them.
 *
 * @param {Object} deck - A deck as the list endpoints answer it.
 * @returns {Object}
 */
export function toGridDeck(deck) {
  return { ...deck, isSharedWithMe: Boolean(deck?.permission) };
}

/**
 * Fetch one page of a deck list.
 *
 * @param {(path: string) => Promise<any>} api
 * @param {string} path - `/api/presentations`, `…/shared-with-me` or `…/trash`.
 * @param {Object} [params] - See {@link deckListQuery}.
 * @returns {Promise<{ decks: Object[], nextCursor: string|null }>}
 */
export async function fetchDeckPage(api, path, params = {}) {
  const resp = await api(`${path}${deckListQuery(params)}`);
  return {
    decks: (Array.isArray(resp?.presentations) ? resp.presentations : []).map(
      toGridDeck,
    ),
    nextCursor: resp?.nextCursor || null,
  };
}
