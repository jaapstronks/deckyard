/**
 * Pane tabs for the inspector rail: Inspector / Comments.
 *
 * They head the right-hand column they switch (D335), the way Canvas | Fields
 * heads the canvas column, instead of docking in the slide bar. The head is
 * its own grid cell (`.rail-head`), so it stays when the rail is dismissed and
 * the rail is always re-openable from where it was. Selected = "rail open on
 * MY pane"; clicking the selected tab dismisses the rail, leaving no tab
 * selected.
 *
 * Presenter notes are not a pane - they live in a strip under the slide
 * (notes-strip.js).
 */

import { t } from '../../lib/ui-i18n.js';
import { icon } from '../../lib/dom/icons.js';
import { createColumnTabs } from '../../lib/dom/column-tabs.js';
import { h } from '../../lib/dom/index.js';

/**
 * @param {Object} options
 * @param {Function} [options.onToggleInspector]
 * @param {Function} [options.onToggleComments]
 * @returns {{ el: HTMLElement, setState: Function, updateBadge: Function }}
 */
export function createPaneTabs({ onToggleInspector, onToggleComments } = {}) {
  const tabContent = (name, label) => [
    icon(name, { size: 15 }),
    h('span', { class: 'pane-tab-label', text: label }),
  ];

  const badgeEl = h('span', { class: 'pane-tab-badge', text: '' });
  badgeEl.hidden = true;

  const inspectorLabel = t('editor.inspector.title', 'Inspector');
  const commentsLabel = t('editor.comments', 'Comments');

  // The rail owns the selection - clicking the active tab dismisses it rather
  // than re-selecting - so the strip reports clicks and setState drives it.
  // The labels hide when the rail is dismissed (icons stay), so each tab
  // carries its name as aria-label too.
  const strip = createColumnTabs({
    className: 'pane-tabs',
    ariaLabel: t('editor.panes.label', 'Side panels'),
    value: null,
    selectOnClick: false,
    tabs: [
      {
        value: 'settings',
        title: t('editor.inspector.toggle', 'Show or hide the inspector'),
        ariaLabel: inspectorLabel,
        content: tabContent('sliders-horizontal', inspectorLabel),
      },
      {
        value: 'comments',
        title: commentsLabel,
        ariaLabel: commentsLabel,
        content: [...tabContent('message-circle', commentsLabel), badgeEl],
      },
    ],
    onSelect: (pane) =>
      pane === 'settings' ? onToggleInspector?.() : onToggleComments?.(),
  });

  /**
   * Reflect the rail state on the tabs. Selected means "the rail is open on
   * MY pane", not merely "the rail is open" - so a pane switch moves the
   * selection from one tab to the other.
   * @param {{ open: boolean, pane: string|null }} state
   */
  const setState = ({ open, pane } = {}) => {
    strip.setValue(open ? (pane ?? null) : null);
  };

  /**
   * Update the unresolved-comments count on the Comments tab.
   * @param {number|{count: number, hasNew: boolean}} data - count, or
   *   { count, hasNew } where hasNew=false renders the "seen" (grey) state
   */
  const updateBadge = (data) => {
    const n =
      typeof data === 'object' ? Number(data?.count) || 0 : Number(data) || 0;
    const hasNew = typeof data === 'object' ? Boolean(data?.hasNew) : true;
    badgeEl.textContent = n > 0 ? String(n) : '';
    badgeEl.hidden = n === 0;
    badgeEl.classList.toggle('pane-tab-badge--seen', !hasNew && n > 0);
  };

  return { el: strip.el, setState, updateBadge };
}
