import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { getFeatures } from '../../../lib/state/features.js';

/**
 * Create the trash view (lazy-loaded)
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
    class: 'help',
    text: t('list.trash.empty', 'Trash is empty.'),
  });
  const trashLoading = h('div', {
    class: 'help',
    text: t('list.trash.loading', 'Loading…'),
  });

  let loaded = false;

  trashView.append(trashTitle, trashHint, trashLoading);

  async function load() {
    if (loaded) return;

    try {
      const items = await api('/api/presentations/trash');

      loaded = true;
      trashView.innerHTML = '';
      trashView.append(trashTitle, trashHint);

      if (!items || items.length === 0) {
        trashView.append(trashEmpty);
      } else {
        for (const p of items) {
          trashList.append(
            renderCard(p, {
              isOrganization: p.visibility === 'organization',
              isTrashView: true,
            }),
          );
        }
        trashView.append(trashList);
      }
    } catch {
      // The view could not load: a state of the view, announced politely.
      const loadError = createInlineError({ live: 'polite' });
      loaded = true;
      trashView.innerHTML = '';
      trashView.append(trashTitle, trashHint, loadError.el);
      loadError.show(t('list.trash.loadError', 'Failed to load trash.'), {
        focus: false,
      });
    }
  }

  function refresh() {
    loaded = false;
    trashList.innerHTML = '';
    load();
  }

  return {
    el: trashView,
    load,
    refresh,
  };
}
