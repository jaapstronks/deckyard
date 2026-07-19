/**
 * Pane tabs for the inspector rail: Inspector / Comments.
 *
 * Lives at the far right of the slide toolbar (the row above the canvas),
 * directly above the rail it controls - the panes are slide-scoped, so they
 * belong in the slide row, not between the deck-level topbar actions (chrome
 * re-org 2026-07-17). Pressed = "rail open on MY pane"; clicking the active
 * tab dismisses the rail. Always visible (also with the rail closed), which
 * is what makes the rail findable.
 *
 * Presenter notes are no longer a tab here - they live in a strip under the
 * slide (notes-strip.js), so the rail is Inspector + Comments only.
 */

import { t } from '../../lib/ui-i18n.js';
import { iconUrl } from '../../../shared/icon-names.js';
import { createSegmented } from '../../lib/segmented.js';

/**
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {Function} [options.onToggleInspector]
 * @param {Function} [options.onToggleComments]
 * @returns {{ el: HTMLElement, setState: Function, updateBadge: Function }}
 */
export function createPaneTabs({
  h,
  onToggleInspector,
  onToggleComments,
} = {}) {
  const tabContent = (icon, label) => [
    h('img', { class: 'pane-tab-icon', src: iconUrl(icon), alt: '', 'aria-hidden': 'true' }),
    h('span', { class: 'pane-tab-label', text: label }),
  ];

  const badgeEl = h('span', { class: 'pane-tab-badge', text: '' });
  badgeEl.hidden = true;

  // The rail owns the selection - clicking the active tab dismisses it rather
  // than re-selecting - so the control reports clicks and setState drives the
  // highlight.
  const segmented = createSegmented({
    h,
    outlined: true,
    className: 'pane-tabs',
    buttonClass: 'pane-tab',
    ariaLabel: t('editor.panes.label', 'Side panels'),
    value: null,
    selectOnClick: false,
    segments: [
      {
        value: 'settings',
        title: t('editor.inspector.toggle', 'Show or hide the inspector'),
        content: tabContent('sliders-horizontal', t('editor.inspector.title', 'Inspector')),
      },
      {
        value: 'comments',
        title: t('editor.comments', 'Comments'),
        content: [...tabContent('message-circle', t('editor.comments', 'Comments')), badgeEl],
      },
    ],
    onSelect: (pane) =>
      pane === 'settings' ? onToggleInspector?.() : onToggleComments?.(),
  });
  const el = segmented.el;

  /**
   * Reflect the rail state on the tabs. Pressed means "the rail is open on
   * MY pane", not merely "the rail is open" - so a pane switch flips one tab
   * off and the other on.
   * @param {{ open: boolean, pane: string|null }} state
   */
  const setState = ({ open, pane } = {}) => {
    segmented.setValue(open ? pane ?? null : null);
  };

  /**
   * Update the unresolved-comments count on the Comments tab.
   * @param {number|{count: number, hasNew: boolean}} data - count, or
   *   { count, hasNew } where hasNew=false renders the "seen" (grey) state
   */
  const updateBadge = (data) => {
    const n = typeof data === 'object' ? (Number(data?.count) || 0) : (Number(data) || 0);
    const hasNew = typeof data === 'object' ? Boolean(data?.hasNew) : true;
    badgeEl.textContent = n > 0 ? String(n) : '';
    badgeEl.hidden = n === 0;
    badgeEl.classList.toggle('pane-tab-badge--seen', !hasNew && n > 0);
  };

  return { el, setState, updateBadge };
}
