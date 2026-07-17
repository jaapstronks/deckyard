/**
 * Pane tabs for the inspector rail: Inspector / Comments / Notes.
 *
 * Lives at the far right of the slide toolbar (the row above the canvas),
 * directly above the rail it controls - the panes are slide-scoped, so they
 * belong in the slide row, not between the deck-level topbar actions (chrome
 * re-org 2026-07-17). Pressed = "rail open on MY pane"; clicking the active
 * tab dismisses the rail. Always visible (also with the rail closed), which
 * is what makes the rail findable.
 */

import { t } from '../../lib/ui-i18n.js';
import { iconUrl } from '../../../shared/icon-names.js';

/**
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {Function} [options.onToggleInspector]
 * @param {Function} [options.onToggleComments]
 * @param {Function} [options.onToggleNotes]
 * @returns {{ el: HTMLElement, setState: Function, updateBadge: Function }}
 */
export function createPaneTabs({
  h,
  onToggleInspector,
  onToggleComments,
  onToggleNotes,
} = {}) {
  const makeTab = ({ icon, label, title, extraClass, onclick }) => {
    const btn = h('button', {
      class: `pane-tab${extraClass ? ` ${extraClass}` : ''}`,
      type: 'button',
      title,
      'aria-pressed': 'false',
      onclick,
    });
    btn.append(
      h('img', { class: 'pane-tab-icon', src: iconUrl(icon), alt: '', 'aria-hidden': 'true' }),
      h('span', { class: 'pane-tab-label', text: label })
    );
    return btn;
  };

  const btnInspector = makeTab({
    icon: 'sliders-horizontal',
    label: t('editor.inspector.title', 'Inspector'),
    title: t('editor.inspector.toggle', 'Show or hide the inspector'),
    onclick: () => onToggleInspector?.(),
  });

  const badgeEl = h('span', { class: 'pane-tab-badge', text: '' });
  badgeEl.hidden = true;
  const btnComments = makeTab({
    icon: 'message-circle',
    label: t('editor.comments', 'Comments'),
    title: t('editor.comments', 'Comments'),
    onclick: () => onToggleComments?.(),
  });
  btnComments.append(badgeEl);

  const btnNotes = makeTab({
    icon: 'file-text',
    label: t('editor.notes.tab', 'Notes'),
    title: t('editor.notes.title', 'Presenter notes'),
    onclick: () => onToggleNotes?.(),
  });

  const el = h(
    'div',
    { class: 'pane-tabs', role: 'group', 'aria-label': t('editor.panes.label', 'Side panels') },
    [btnInspector, btnComments, btnNotes]
  );

  /**
   * Reflect the rail state on the tabs. Pressed means "the rail is open on
   * MY pane", not merely "the rail is open" - so a pane switch flips one tab
   * off and the other on.
   * @param {{ open: boolean, pane: string|null }} state
   */
  const setState = ({ open, pane } = {}) => {
    for (const [btn, name] of [
      [btnInspector, 'settings'],
      [btnComments, 'comments'],
      [btnNotes, 'notes'],
    ]) {
      const active = Boolean(open) && pane === name;
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('is-active', active);
    }
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
