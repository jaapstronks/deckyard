/**
 * The Share dialog's status line (D354): who can reach the deck right now, in
 * one line above the tabs - "Private · 2 guest links · Published".
 *
 * Three facts, one per tab: the workspace visibility (Team), the number of
 * guest links that still work (Guests) and whether a public page exists
 * (Public). The dialog re-renders it whenever one of them changes.
 */

import { t } from '../../../../lib/ui-i18n.js';
import { h } from '../../../../lib/dom/index.js';

/**
 * Count the links that still let someone in: the list holds no revoked links,
 * but an expired one stays listed (as "Expired") until it is revoked.
 * @param {Array<{ expiresAt?: string|null }>} links
 * @param {Date} [now]
 * @returns {number}
 */
export function countActiveLinks(links, now = new Date()) {
  return (links || []).filter(
    (link) => !link.expiresAt || new Date(link.expiresAt) > now,
  ).length;
}

/**
 * The segments of the status line, in tab order.
 * @param {Object} state
 * @param {string} [state.visibility] - `'private'` or `'organization'`
 * @param {number|null} [state.activeLinks] - Working guest links; `null`
 *   while the list has not loaded, which leaves the segment out
 * @param {boolean|null} [state.published] - Whether a public page exists;
 *   `null` where publishing is unavailable (sandbox), which leaves it out
 * @returns {string[]}
 */
export function describeShareStatus({ visibility, activeLinks, published }) {
  const parts = [
    visibility === 'organization'
      ? t('share.status.workspace', 'In your organization')
      : t('share.status.private', 'Private'),
  ];
  if (typeof activeLinks === 'number') {
    parts.push(
      activeLinks === 0
        ? t('share.status.noLinks', 'No guest links')
        : t(
            'share.status.links',
            { one: '1 guest link', many: '{count} guest links' },
            { count: activeLinks },
          ),
    );
  }
  if (typeof published === 'boolean') {
    parts.push(
      published
        ? t('share.status.published', 'Published')
        : t('share.status.notPublished', 'Not published'),
    );
  }
  return parts;
}

/**
 * Create the status line element.
 * @returns {{ el: HTMLElement, update: (state: Object) => void }} `update`
 *   takes the same state as {@link describeShareStatus}
 */
export function createShareStatus() {
  const el = h('p', { class: 'share-status-line', 'aria-live': 'polite' });
  return {
    el,
    update(state) {
      el.textContent = describeShareStatus(state).join(' · ');
    },
  };
}
