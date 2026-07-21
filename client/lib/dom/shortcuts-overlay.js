import { h } from '../dom.js';
import { t } from '../ui-i18n.js';
import { openModal } from './modal.js';

/**
 * Shared keyboard-shortcut help overlay.
 *
 * Both the presenter (`views/presenter/shortcuts-overlay.js`) and the editor
 * (`views/editor/shortcuts.js`) feed their own grouped shortcut lists into this
 * renderer, so the markup + styling live in one place. Uses the shared modal
 * helper, so focus trap, Esc-to-close and backdrop dismissal come for free.
 *
 * @module shortcuts-overlay
 */

/**
 * @typedef {{ keys: string[], desc: string }} ShortcutRow
 * @typedef {{ title: string, rows: ShortcutRow[] }} ShortcutGroup
 */

/**
 * Render grouped shortcuts into `<section>` elements (title + a <dl> of
 * key-captions → description). Each key in a row renders as a `<kbd>`, joined
 * by a localized "or".
 *
 * @param {ShortcutGroup[]} groups
 * @returns {HTMLElement[]}
 */
export function renderShortcutGroups(groups = []) {
  return groups.map((group) =>
    h('section', { class: 'shortcuts-group' }, [
      h('h3', { class: 'shortcuts-group-title', text: group.title }),
      h(
        'dl',
        { class: 'shortcuts-list' },
        group.rows.flatMap((row) => [
          h(
            'dt',
            { class: 'shortcuts-keys' },
            row.keys.flatMap((key, i) =>
              i === 0
                ? [h('kbd', { text: key })]
                : [
                    h('span', { class: 'shortcuts-or', text: t('shortcuts.or', 'or') }),
                    h('kbd', { text: key }),
                  ]
            )
          ),
          h('dd', { class: 'shortcuts-desc', text: row.desc }),
        ])
      ),
    ])
  );
}

/**
 * Open a keyboard-shortcut help overlay.
 *
 * @param {Object} opts
 * @param {string} [opts.title] - Modal title (falls back to a generic label).
 * @param {ShortcutGroup[]} opts.groups - Grouped shortcut rows.
 * @param {string} [opts.modalClass='shortcuts-modal'] - Extra modal class.
 * @param {() => void} [opts.onClose] - Called when the overlay closes.
 * @returns {{ close: () => void }}
 */
export function openShortcutsOverlay({
  title,
  groups = [],
  modalClass = 'shortcuts-modal',
  onClose,
} = {}) {
  const modalApi = openModal(h, document.body, {
    title: title || t('shortcuts.title', 'Keyboard shortcuts'),
    modalClass,
    onClose: () => onClose?.(),
  });
  modalApi.append(h('div', { class: 'shortcuts' }, renderShortcutGroups(groups)));
  return { close: () => modalApi.close() };
}
