import { t } from '../../../lib/ui-i18n.js';
import { iconUrl } from '../../../../shared/icon-names.js';

/**
 * Build a section header with icon, title, count badge, and optional "View all" button
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper function
 * @param {string} opts.icon - Lucide icon name
 * @param {string} opts.title - Section title
 * @param {number} opts.count - Number of items
 * @param {Function} [opts.onViewAll] - Callback for "View all" button
 * @param {boolean} [opts.hideViewAll=false] - Whether to hide the "View all" button
 * @returns {HTMLElement}
 */
export function buildSectionHeader({ h, icon, title, count, onViewAll, hideViewAll = false }) {
  return h('div', { class: 'presentation-section-header' }, [
    h('div', { class: 'presentation-section-title' }, [
      h('img', { class: 'presentation-section-icon', src: iconUrl(icon), alt: '', 'aria-hidden': 'true' }),
      document.createTextNode(title + ' '),
      h('span', {
        class: 'presentation-section-badge',
        text: t('list.section.count', '{count} presentations', { count }),
      }),
    ]),
    hideViewAll ? null : h('button', {
      class: 'presentation-section-link',
      type: 'button',
      text: t('list.section.viewAll', 'View all'),
      onclick: () => onViewAll?.(),
    }),
  ]);
}