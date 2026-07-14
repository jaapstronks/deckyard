import { t } from '../../../lib/ui-i18n.js';

/**
 * Create the trash view (lazy-loaded)
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Function} opts.api - API client
 * @param {Function} opts.renderCard - Card renderer function
 * @returns {object} - { el, load, refresh }
 */
export function createTrashView({ h, api, renderCard }) {
  const trashView = h('div', { class: 'sidebar-view', 'data-view': 'trash' });
  const trashTitle = h('h2', { class: 'presentation-grid-title', text: t('list.trash.title', 'Trash') });
  const trashHint = h('p', { class: 'help', text: t('list.trash.hint', 'Items in trash will be permanently deleted after 30 days. You can restore them before then.') });
  const trashList = h('div', { class: 'list presentation-grid' });
  const trashEmpty = h('div', { class: 'help', text: t('list.trash.empty', 'Trash is empty.') });
  const trashLoading = h('div', { class: 'help', text: t('list.trash.loading', 'Loading...') });

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
          trashList.append(renderCard(p, {
            isWorkspace: p.scope === 'workspace',
            isTrashView: true,
          }));
        }
        trashView.append(trashList);
      }
    } catch {
      loaded = true;
      trashView.innerHTML = '';
      trashView.append(
        trashTitle,
        trashHint,
        h('div', { class: 'help is-error', text: t('list.trash.loadError', 'Failed to load trash.') })
      );
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