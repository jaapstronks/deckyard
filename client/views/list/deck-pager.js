import { createListPager } from '../../lib/dom/list-pager.js';
import { fetchDeckPage } from './data.js';

/** Decks per page on the deck grid. */
const DECK_PAGE_SIZE = 24;

/**
 * A deck list read page by page (D358, B821): the shared list pager
 * (`client/lib/dom/list-pager.js`) over one deck-list endpoint.
 *
 * @param {Object} opts
 * @param {(path: string) => Promise<any>} opts.api
 * @param {string} opts.path - The list endpoint.
 * @param {(decks: Object[], meta: { first: boolean }) => void} opts.onPage
 * @param {number} [opts.limit] - Decks per page.
 * @returns {{ el: HTMLElement, load: (params?: Object) => Promise<void>, hasMore: () => boolean }}
 */
export function createDeckPager({ api, path, onPage, limit = DECK_PAGE_SIZE }) {
  return createListPager({
    fetchPage: async (params, cursor) => {
      const page = await fetchDeckPage(api, path, {
        ...params,
        limit,
        ...(cursor ? { cursor } : {}),
      });
      return { items: page.decks, nextCursor: page.nextCursor };
    },
    onPage,
  });
}
