import { t } from '../../../lib/ui-i18n.js';
import { icon as uiIcon } from '../../../lib/dom/icons.js';
import { h } from '../../../lib/dom.js';

/**
 * Build a section header with icon, title, count badge, and optional "View all" button
 *
 * @param {object} opts
 * @param {string} opts.icon - Lucide icon name
 * @param {string} opts.title - Section title
 * @param {number} opts.count - Number of items
 * @param {Function} [opts.onViewAll] - Callback for "View all" button
 * @param {boolean} [opts.hideViewAll=false] - Whether to hide the "View all" button
 * @param {string} [opts.badge] - Override the badge text. Pass an empty string
 *   to hide the badge entirely; omit for the default "{count} presentations".
 * @returns {HTMLElement}
 */
export function buildSectionHeader({
  icon,
  title,
  count,
  onViewAll,
  hideViewAll = false,
  badge,
}) {
  const badgeText =
    badge !== undefined
      ? badge
      : t('list.section.count', '{count} presentations', { count });

  return h('div', { class: 'presentation-section-header' }, [
    h('div', { class: 'presentation-section-title' }, [
      h('span', { class: 'presentation-section-icon', 'aria-hidden': 'true' }, [
        uiIcon(icon, { size: 18 }),
      ]),
      document.createTextNode(title + ' '),
      badgeText
        ? h('span', { class: 'presentation-section-badge', text: badgeText })
        : null,
    ]),
    hideViewAll
      ? null
      : h('button', {
          class: 'presentation-section-link',
          type: 'button',
          text: t('list.section.viewAll', 'View all →'),
          onclick: () => onViewAll?.(),
        }),
  ]);
}
