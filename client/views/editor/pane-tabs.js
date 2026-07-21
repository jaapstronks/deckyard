/**
 * Pane openers for the inspector rail: Inspector / Comments.
 *
 * Lives at the far right of the topbar, directly above the rail it controls
 * (Keynote model, chrome re-org 2026-07-19). The opener is workspace chrome -
 * "show the side panel" - even though the panes' CONTENTS are slide-scoped; a
 * full-width strip is the only home that stays put when the rail collapses, so
 * the rail is always re-openable. Rendered `compact` (icon-only) there to sit
 * with the topbar's other icon controls. Pressed = "rail open on MY pane";
 * clicking the active opener dismisses the rail.
 *
 * Presenter notes are no longer an opener here - they live in a strip under the
 * slide (notes-strip.js), so the rail is Inspector + Comments only.
 */

import { t } from '../../lib/ui-i18n.js';
import { iconUrl } from '../../../shared/icon-names.js';
import { createSegmented } from '../../lib/dom/segmented.js';

/**
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {Function} [options.onToggleInspector]
 * @param {Function} [options.onToggleComments]
 * @param {boolean} [options.compact] - Icon-only (no visible labels), for the
 *   topbar. The accessible name moves to `aria-label` on each button.
 * @returns {{ el: HTMLElement, setState: Function, updateBadge: Function }}
 */
export function createPaneTabs({
  h,
  onToggleInspector,
  onToggleComments,
  compact = false,
} = {}) {
  const tabContent = (icon, label) => {
    const iconEl = h('img', { class: 'pane-tab-icon', src: iconUrl(icon), alt: '', 'aria-hidden': 'true' });
    if (compact) return [iconEl];
    return [iconEl, h('span', { class: 'pane-tab-label', text: label })];
  };

  const badgeEl = h('span', { class: 'pane-tab-badge', text: '' });
  badgeEl.hidden = true;

  const inspectorLabel = t('editor.inspector.title', 'Inspector');
  const commentsLabel = t('editor.comments', 'Comments');

  // The rail owns the selection - clicking the active tab dismisses it rather
  // than re-selecting - so the control reports clicks and setState drives the
  // highlight.
  const segmented = createSegmented({
    h,
    outlined: true,
    className: compact ? 'pane-tabs is-compact' : 'pane-tabs',
    buttonClass: 'pane-tab',
    ariaLabel: t('editor.panes.label', 'Side panels'),
    value: null,
    selectOnClick: false,
    segments: [
      {
        value: 'settings',
        title: t('editor.inspector.toggle', 'Show or hide the inspector'),
        ...(compact ? { ariaLabel: inspectorLabel } : {}),
        content: tabContent('sliders-horizontal', inspectorLabel),
      },
      {
        value: 'comments',
        title: commentsLabel,
        ...(compact ? { ariaLabel: commentsLabel } : {}),
        content: [...tabContent('message-circle', commentsLabel), badgeEl],
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
