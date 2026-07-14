import { t } from '../../../lib/ui-i18n.js';
import { matchesSearch, getAllTags } from './utils.js';

/**
 * Creates the image library grid component
 * @param {Object} options - Component options
 * @returns {Object} Grid component API
 */
export function createImageLibraryGrid({
  h,
  items,
  onSelectItem,
  getActiveTag,
  setActiveTag,
  hideTagFilters = false,
  onToggleFavorite = null,
} = {}) {
  const filtersRow = h('div', { class: 'image-lib-filters', hidden: hideTagFilters });
  const grid = h('div', {
    class: 'row is-wrap is-start is-gap-lg image-library-grid',
  });

  const qInput = h('input', {
    class: 'form-input',
    placeholder: t(
      'imageLibrary.search.placeholder',
      'Search description, tags, photographer, alt text…'
    ),
  });

  // Search field wrapper (no label - placeholder is sufficient)
  const searchField = h('div', { class: 'media-lib-search-input-wrap' }, [qInput]);

  const renderTagFilters = () => {
    filtersRow.innerHTML = '';
    const allTags = getAllTags(items());
    const activeTag = getActiveTag();

    const mkChip = (label, tagValue) => {
      const isActive = activeTag === tagValue;
      const btn = h('button', {
        class: `btn btn-secondary is-compact-sm is-pill image-lib-tag-chip${
          isActive ? ' is-active' : ''
        }`,
        type: 'button',
        text: label,
        onclick: () => {
          setActiveTag(activeTag === tagValue ? '' : tagValue);
          renderTagFilters();
          renderGrid();
        },
      });
      return btn;
    };

    filtersRow.append(
      mkChip(t('imageLibrary.tags.all', 'All'), ''),
      ...allTags.map((tg) => mkChip(`#${tg}`, tg))
    );
  };

  const renderGrid = () => {
    grid.innerHTML = '';
    const q = qInput.value || '';
    const activeTag = getActiveTag();
    const filtered = items().filter((it) => matchesSearch(it, q, activeTag));

    if (!filtered.length) {
      grid.append(
        h('div', {
          class: 'help',
          text: q.trim()
            ? t('imageLibrary.noResults', 'No results.')
            : t('imageLibrary.empty', 'No items in the library yet.'),
        })
      );
      return;
    }

    for (const it of filtered) {
      const card = h('div', { class: 'image-lib-card' });

      const btn = h('button', {
        class: 'btn btn-secondary image-lib-item-btn',
        onclick: () => onSelectItem(it),
      });

      const tags = Array.isArray(it?.tags) ? it.tags : [];
      const tagsEl =
        tags.length > 0
          ? h(
              'div',
              { class: 'image-lib-tags' },
              tags.slice(0, 6).map((tg) =>
                h('span', { class: 'image-lib-tag', text: `#${tg}` })
              )
            )
          : null;

      // Favorite star button
      const isFavorite = !!it?.isFavorite;
      const starBtn = onToggleFavorite
        ? h('button', {
            class: `image-lib-favorite-btn${isFavorite ? ' is-favorite' : ''}`,
            type: 'button',
            title: isFavorite
              ? t('imageLibrary.unfavorite', 'Remove from favorites')
              : t('imageLibrary.favorite', 'Add to favorites'),
            onclick: (e) => {
              e.stopPropagation();
              onToggleFavorite(it);
            },
          })
        : null;

      if (starBtn) {
        starBtn.innerHTML = isFavorite
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
      }

      btn.append(
        h('img', {
          src: it.url,
          alt: '',
          class: 'image-lib-thumb',
          loading: 'lazy',
        }),
        h('div', { class: 'image-lib-meta' }, [
          h('div', {
            class: 'image-lib-title',
            text: it.description || t('imageLibrary.untitled', '(No description)'),
            title: it.description || '',
          }),
          h('div', {
            class: 'help',
            text: it.photographer
              ? t('imageLibrary.photographer', 'Photographer: {name}', {
                  name: it.photographer,
                })
              : t('imageLibrary.photographerEmpty', 'Photographer: —'),
          }),
          tagsEl,
        ])
      );

      card.append(btn);
      if (starBtn) card.append(starBtn);
      grid.append(card);
    }
  };

  qInput.addEventListener('input', () => renderGrid());

  // Arrow down from search moves to first grid item
  qInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const firstBtn = grid.querySelector('.image-lib-item-btn');
      if (firstBtn) firstBtn.focus();
    }
  });

  // Keyboard navigation for grid
  grid.addEventListener('keydown', (e) => {
    const cards = Array.from(grid.querySelectorAll('.image-lib-card'));
    const focused = document.activeElement;
    const currentCard = focused?.closest('.image-lib-card');
    const currentIndex = currentCard ? cards.indexOf(currentCard) : -1;

    if (currentIndex === -1) return;

    let nextIndex = -1;
    const cols = Math.floor(grid.offsetWidth / 230) || 1; // Approximate columns based on width

    switch (e.key) {
      case 'ArrowRight':
        nextIndex = Math.min(currentIndex + 1, cards.length - 1);
        break;
      case 'ArrowLeft':
        nextIndex = Math.max(currentIndex - 1, 0);
        break;
      case 'ArrowDown':
        nextIndex = Math.min(currentIndex + cols, cards.length - 1);
        break;
      case 'ArrowUp':
        nextIndex = Math.max(currentIndex - cols, 0);
        break;
      default:
        return;
    }

    if (nextIndex !== -1 && nextIndex !== currentIndex) {
      e.preventDefault();
      const nextBtn = cards[nextIndex]?.querySelector('.image-lib-item-btn');
      if (nextBtn) nextBtn.focus();
    }
  });

  const setDisabled = (disabled) => {
    qInput.disabled = disabled;
  };

  const focus = () => {
    qInput.focus();
  };

  // Focus first grid item
  const focusFirstItem = () => {
    const firstBtn = grid.querySelector('.image-lib-item-btn');
    if (firstBtn) firstBtn.focus();
  };

  return {
    searchField,
    filtersRow,
    grid,
    renderTagFilters,
    renderGrid,
    setDisabled,
    focus,
    focusFirstItem,
  };
}