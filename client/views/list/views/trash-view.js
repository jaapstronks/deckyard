import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom/index.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { getFeatures } from '../../../lib/state/features.js';
import { createDeckPager } from '../deck-pager.js';

/**
 * Create the trash view (lazy-loaded): the decks the person may restore,
 * most recently trashed first, one page at a time (D358, B821).
 *
 * @param {object} opts
 * @param {Function} opts.api - API client
 * @param {Function} opts.renderCard - Card renderer function
 * @returns {object} - { el, load, refresh }
 */
export function createTrashView({ api, renderCard }) {
  const trashView = h('div', { class: 'sidebar-view', 'data-view': 'trash' });
  const trashTitle = h('h2', {
    class: 'presentation-grid-title',
    text: t('list.trash.title', 'Trash'),
  });
  // The number comes from the server's TRASH_RETENTION_DAYS, the same value the
  // retention sweep deletes on — the hint states a promise, so it may not state
  // a different number than the one being kept. The snapshot always carries it;
  // the client keeps no default of its own (B405).
  const days = getFeatures()?.trashRetentionDays;
  const trashHint = h('p', {
    class: 'help',
    text: t(
      'list.trash.hint',
      'Items in trash will be permanently deleted after {days} days. You can restore them before then.',
      { days },
    ),
  });
  const trashList = h('div', { class: 'list presentation-grid' });
  const trashEmpty = h('div', {
    class: 'empty-note',
    text: t('list.trash.empty', 'Trash is empty.'),
  });
  const trashLoading = h('div', {
    class: 'help',
    text: t('list.trash.loading', 'Loading…'),
  });

  let loaded = false;

  const pager = createDeckPager({
    api,
    path: '/api/presentations/trash',
    onPage: (decks, { first }) => {
      if (first) {
        trashList.replaceChildren();
        trashView.replaceChildren(trashTitle, trashHint);
        trashView.append(decks.length === 0 ? trashEmpty : trashList, pager.el);
      }
      for (const p of decks) {
        trashList.append(
          renderCard(p, {
            isOrganization: p.visibility === 'organization',
            isTrashView: true,
          }),
        );
      }
    },
  });

  trashView.append(trashTitle, trashHint, trashLoading);

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      await pager.load();
    } catch {
      // The view could not load: a state of the view, announced politely.
      const loadError = createInlineError({ live: 'polite' });
      trashView.replaceChildren();
      trashView.append(trashTitle, trashHint, loadError.el);
      loadError.show(t('list.trash.loadError', 'Failed to load trash.'), {
        focus: false,
      });
    }
  }

  /** Reload the trash from the server; resolves once it is on screen. */
  function refresh() {
    loaded = false;
    return load();
  }

  return {
    el: trashView,
    load,
    refresh,
  };
}
