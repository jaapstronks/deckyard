import { t } from '../../lib/ui-i18n.js';
import { h } from '../../lib/dom/index.js';
import { toast } from '../../lib/dom/toast.js';
import { fetchDeckPage } from './data.js';

/** Decks per page on the deck grid. */
const DECK_PAGE_SIZE = 24;

/**
 * A deck list read page by page (D358, B821): the first page on `load()`, the
 * next one behind a "Load more" button for as long as the server answers a
 * `nextCursor`.
 *
 * The pager owns the request state, the view owns the rendering: `onPage`
 * receives each page as it arrives (`first: true` for a fresh list). A
 * response that arrives after a newer `load()` (another filter, a refresh) is
 * dropped, so a slow page of the old filter never lands in the new list.
 *
 * @param {Object} opts
 * @param {(path: string) => Promise<any>} opts.api
 * @param {string} opts.path - The list endpoint.
 * @param {(decks: Object[], meta: { first: boolean }) => void} opts.onPage
 * @param {number} [opts.limit] - Decks per page.
 * @returns {{ el: HTMLElement, load: (params?: Object) => Promise<void>, hasMore: () => boolean }}
 *   `el` is the load-more row, hidden while there is nothing more to load;
 *   `load()` rejects when the first page fails, so the view can show its own
 *   error state.
 */
export function createDeckPager({ api, path, onPage, limit = DECK_PAGE_SIZE }) {
  let params = {};
  let nextCursor = null;
  let generation = 0;
  let loadingMore = false;

  const button = h('button', {
    class: 'btn btn-secondary deck-pager-more',
    type: 'button',
    text: t('list.loadMore', 'Load more'),
    onclick: () => loadMore(),
  });
  const el = h('div', { class: 'deck-pager', hidden: true }, [button]);

  function sync() {
    el.hidden = !nextCursor;
    button.disabled = loadingMore;
    button.textContent = loadingMore
      ? t('list.loadingMore', 'Loading…')
      : t('list.loadMore', 'Load more');
  }

  async function load(nextParams = params) {
    params = nextParams;
    const mine = ++generation;
    loadingMore = false;
    nextCursor = null;
    sync();
    const page = await fetchDeckPage(api, path, { ...params, limit });
    if (mine !== generation) return;
    nextCursor = page.nextCursor;
    onPage(page.decks, { first: true });
    sync();
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const mine = generation;
    loadingMore = true;
    sync();
    try {
      const page = await fetchDeckPage(api, path, {
        ...params,
        limit,
        cursor: nextCursor,
      });
      if (mine !== generation) return;
      nextCursor = page.nextCursor;
      onPage(page.decks, { first: false });
    } catch {
      // The button stays, so the person can try again.
      if (mine === generation) {
        toast.error(t('list.loadMoreError', 'Could not load more.'));
      }
    } finally {
      if (mine === generation) {
        loadingMore = false;
        sync();
      }
    }
  }

  return { el, load, hasMore: () => Boolean(nextCursor) };
}
