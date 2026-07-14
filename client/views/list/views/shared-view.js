import { t } from '../../../lib/ui-i18n.js';
import { displayNameFromEmail, initialsForName } from '../../../lib/user-format.js';

/**
 * Subtle background colors for author groups (HSL values for light mode)
 * These cycle through for different authors
 */
const AUTHOR_GROUP_COLORS = [
  { bg: '220 60% 97%', accent: '220 70% 50%' },   // Blue
  { bg: '280 50% 97%', accent: '280 60% 50%' },   // Purple
  { bg: '160 50% 96%', accent: '160 60% 40%' },   // Teal
  { bg: '30 70% 96%', accent: '30 80% 45%' },     // Orange
  { bg: '340 50% 97%', accent: '340 60% 50%' },   // Pink
  { bg: '200 60% 96%', accent: '200 70% 45%' },   // Cyan
];

/**
 * Create the "shared with me" view (lazy-loaded)
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Function} opts.api - API client
 * @param {Function} opts.renderCard - Card renderer function
 * @returns {object} - { el, load }
 */
export function createSharedWithMeView({ h, api, renderCard }) {
  const sharedWithMeView = h('div', { class: 'sidebar-view', 'data-view': 'sharedWithMe' });
  const sharedWithMeTitle = h('h2', { class: 'presentation-grid-title', text: t('list.sharedWithMe.title', 'Shared with me') });
  const sharedWithMeEmpty = h('div', { class: 'help', text: t('list.sharedWithMe.empty', 'No presentations have been shared with you yet.') });
  const sharedWithMeLoading = h('div', { class: 'help', text: t('list.sharedWithMe.loading', 'Loading...') });

  let loaded = false;

  sharedWithMeView.append(sharedWithMeTitle, sharedWithMeLoading);

  /**
   * Group presentations by author (sharedBy)
   * @param {Array} presentations - List of presentations
   * @returns {Map} - Map of author email -> presentations
   */
  function groupByAuthor(presentations) {
    const groups = new Map();
    for (const p of presentations) {
      const author = p.sharedBy || 'unknown';
      if (!groups.has(author)) {
        groups.set(author, []);
      }
      groups.get(author).push(p);
    }
    // Sort groups by total count (most presentations first)
    return new Map([...groups.entries()].sort((a, b) => b[1].length - a[1].length));
  }

  /**
   * Create an author group section
   * @param {string} authorEmail - Author's email
   * @param {Array} presentations - Presentations shared by this author
   * @param {number} colorIndex - Index for color selection
   * @returns {HTMLElement} - Group section element
   */
  function createAuthorGroup(authorEmail, presentations, colorIndex) {
    const authorName = displayNameFromEmail(authorEmail);
    const initials = initialsForName(authorName);
    const color = AUTHOR_GROUP_COLORS[colorIndex % AUTHOR_GROUP_COLORS.length];
    const count = presentations.length;

    const group = h('div', {
      class: 'shared-author-group',
      style: `--author-group-bg: ${color.bg}; --author-group-accent: ${color.accent};`,
    });

    // Author header
    const header = h('div', { class: 'shared-author-header' }, [
      h('div', { class: 'shared-author-avatar', text: initials }),
      h('div', { class: 'shared-author-info' }, [
        h('span', { class: 'shared-author-name', text: authorName }),
        h('span', {
          class: 'shared-author-count',
          text: t('list.sharedWithMe.deckCount', '{count} presentation{s}', {
            count,
            s: count === 1 ? '' : 's',
          }),
        }),
      ]),
    ]);

    // Presentation grid for this author
    const grid = h('div', { class: 'list presentation-grid shared-author-grid' });
    for (const p of presentations) {
      grid.append(renderCard(p, {
        isWorkspace: false,
        isSharedWithMe: true,
        sharedBy: p.sharedBy,
        permission: p.permission,
      }));
    }

    group.append(header, grid);
    return group;
  }

  async function load() {
    if (loaded) return;

    try {
      const resp = await api('/api/presentations/shared-with-me');
      const presentations = resp?.presentations || [];

      loaded = true;
      sharedWithMeView.innerHTML = '';
      sharedWithMeView.append(sharedWithMeTitle);

      if (presentations.length === 0) {
        sharedWithMeView.append(sharedWithMeEmpty);
      } else {
        // Group presentations by author
        const groups = groupByAuthor(presentations);

        // Create container for all groups
        const groupsContainer = h('div', { class: 'shared-author-groups' });

        let colorIndex = 0;
        for (const [authorEmail, authorPresentations] of groups) {
          groupsContainer.append(
            createAuthorGroup(authorEmail, authorPresentations, colorIndex)
          );
          colorIndex++;
        }

        sharedWithMeView.append(groupsContainer);
      }
    } catch {
      loaded = true;
      sharedWithMeView.innerHTML = '';
      sharedWithMeView.append(
        sharedWithMeTitle,
        h('div', { class: 'help is-error', text: t('list.sharedWithMe.loadError', 'Failed to load shared presentations.') })
      );
    }
  }

  return {
    el: sharedWithMeView,
    load,
  };
}