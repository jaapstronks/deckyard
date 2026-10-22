import { t } from '../ui-i18n.js';
import { h } from './index.js';
import { toast } from './toast.js';

/**
 * A list read page by page on the list-page contract (D358): the first page
 * on `load()`, the next one behind a "Load more" button for as long as the
 * server answers a `nextCursor`.
 *
 * The pager owns the request state, the caller owns fetching and rendering:
 * `fetchPage(params, cursor)` reads one page, `onPage` receives each page as
 * it arrives (`first: true` for a fresh list). A response that arrives after
 * a newer `load()` (another filter, a refresh) is dropped, so a slow page of
 * the old filter never lands in the new list. A failed "Load more" keeps the
 * button, so the person can try again.
 *
 * @template T
 * @param {Object} opts
 * @param {(params: Object, cursor: string|null) => Promise<{items: T[], nextCursor: string|null}>} opts.fetchPage
 * @param {(items: T[], meta: { first: boolean }) => void} opts.onPage
 * @returns {{ el: HTMLElement, load: (params?: Object) => Promise<void>, hasMore: () => boolean }}
 *   `el` is the load-more row, hidden while there is nothing more to load;
 *   `load()` rejects when the first page fails, so the view can show its own
 *   error state.
 */
export function createListPager({ fetchPage, onPage }) {
  let params = {};
  let nextCursor = null;
  let generation = 0;
  let loadingMore = false;

  const button = h('button', {
    class: 'btn btn-secondary list-pager-more',
    type: 'button',
    text: t('common.loadMore', 'Load more'),
    onclick: () => loadMore(),
  });
  const el = h('div', { class: 'list-pager', hidden: true }, [button]);

  function sync() {
    el.hidden = !nextCursor;
    button.disabled = loadingMore;
    button.textContent = loadingMore
      ? t('common.loadingMore', 'Loading…')
      : t('common.loadMore', 'Load more');
  }

  async function load(nextParams = params) {
    params = nextParams;
    const mine = ++generation;
    loadingMore = false;
    nextCursor = null;
    sync();
    const page = await fetchPage(params, null);
    if (mine !== generation) return;
    nextCursor = page.nextCursor || null;
    onPage(page.items, { first: true });
    sync();
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const mine = generation;
    loadingMore = true;
    sync();
    try {
      const page = await fetchPage(params, nextCursor);
      if (mine !== generation) return;
      nextCursor = page.nextCursor || null;
      onPage(page.items, { first: false });
    } catch {
      if (mine === generation) {
        toast.error(t('common.loadMoreError', 'Could not load more.'));
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
