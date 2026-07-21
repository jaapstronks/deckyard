import { t } from '../../lib/ui-i18n.js';
import { openShortcutsOverlay } from '../../lib/dom/shortcuts-overlay.js';

/**
 * Presenter keyboard-shortcut reference, grouped for the help overlay.
 * Each entry: `keys` is an array of key captions rendered as <kbd>, `desc` is
 * the human description. Kept in sync with `presenter/keys.js`.
 * @returns {Array<{ title: string, rows: Array<{ keys: string[], desc: string }> }>}
 */
function getShortcutGroups() {
  return [
    {
      title: t('presenter.shortcuts.group.navigate', 'Navigate'),
      rows: [
        {
          keys: ['→', 'Space', 'PgDn'],
          desc: t('presenter.shortcuts.next', 'Next slide / build'),
        },
        {
          keys: ['←', 'PgUp'],
          desc: t('presenter.shortcuts.prev', 'Previous slide / build'),
        },
        {
          keys: ['↓'],
          desc: t('presenter.shortcuts.revealAll', 'Reveal all builds'),
        },
        {
          keys: ['↑'],
          desc: t('presenter.shortcuts.collapse', 'Collapse builds / step back'),
        },
        {
          keys: ['Home'],
          desc: t('presenter.shortcuts.first', 'First slide'),
        },
        {
          keys: ['End'],
          desc: t('presenter.shortcuts.last', 'Last slide'),
        },
      ],
    },
    {
      title: t('presenter.shortcuts.group.tools', 'Tools'),
      rows: [
        {
          keys: ['F'],
          desc: t('presenter.shortcuts.fullscreen', 'Toggle fullscreen'),
        },
        {
          keys: ['L'],
          desc: t('presenter.shortcuts.laser', 'Laser pointer'),
        },
        {
          keys: ['D'],
          desc: t('presenter.shortcuts.draw', 'Draw mode'),
        },
        {
          keys: ['C'],
          desc: t('presenter.shortcuts.clear', 'Clear drawings'),
        },
        {
          keys: ['P'],
          desc: t('presenter.shortcuts.persistentDraw', 'Persistent drawings'),
        },
        {
          keys: ['A'],
          desc: t('presenter.shortcuts.autoAdvance', 'Toggle auto-advance'),
        },
      ],
    },
    {
      title: t('presenter.shortcuts.group.general', 'General'),
      rows: [
        {
          keys: ['?'],
          desc: t('presenter.shortcuts.help', 'Show this help'),
        },
        {
          keys: ['Esc'],
          desc: t('presenter.shortcuts.escape', 'Exit / back to editor'),
        },
      ],
    },
  ];
}

/**
 * Open the presenter keyboard-shortcut help overlay.
 * Uses the shared modal helper, so focus trap, Esc-to-close and backdrop
 * dismissal come for free. Idempotent per-caller via the returned handle.
 *
 * @param {Object} [opts]
 * @param {() => void} [opts.onClose] Called when the overlay closes.
 * @returns {{ close: () => void }}
 */
export function openPresenterShortcuts({ onClose } = {}) {
  return openShortcutsOverlay({
    title: t('presenter.shortcuts.title', 'Keyboard shortcuts'),
    groups: getShortcutGroups(),
    modalClass: 'presenter-shortcuts-modal',
    onClose,
  });
}
