import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { chevronDownIcon } from '../../../lib/icons.js';

/**
 * Bulk "Collapse all / Expand all" toggle for multi-card slide editors.
 *
 * One button whose label and action flip based on the current state: while
 * any card is expanded it collapses everything; once all cards are collapsed
 * it expands everything. Renders nothing for fewer than two cards (a bulk
 * control adds no value over the per-card chevron there).
 *
 * @param {Object} o
 * @param {Object} o.state - a createCollapsedState() manager
 * @param {string[]} o.keys - the keys (state.getKey) of every card in the list
 * @param {() => void} [o.rerender] - editor rerender callback
 * @returns {HTMLElement|null}
 */
export function collapseAllToggle({ state, keys, rerender } = {}) {
  if (!state || !Array.isArray(keys) || keys.length < 2) return null;

  const allCollapsed = state.allCollapsed(keys);
  const label = allCollapsed
    ? t('editor.cards.expandAll', 'Expand all')
    : t('editor.cards.collapseAll', 'Collapse all');

  const btn = h('button', {
    type: 'button',
    class: `btn btn-secondary is-compact-sm collapse-all-toggle${allCollapsed ? ' is-all-collapsed' : ''}`,
    title: label,
    onclick: (e) => {
      e.preventDefault();
      state.setAll(keys, !allCollapsed);
      rerender?.();
    },
  });
  btn.appendChild(chevronDownIcon());
  btn.appendChild(h('span', { text: label }));
  return btn;
}
