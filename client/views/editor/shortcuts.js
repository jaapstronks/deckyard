import { t } from '../../lib/ui-i18n.js';
import { openShortcutsOverlay } from '../../lib/dom/shortcuts-overlay.js';

/**
 * Editor keyboard-shortcut reference + help-overlay trigger.
 *
 * This module is the single, human-facing source of truth for the editor's
 * shortcuts. The actual key handling lives in `slide-list/keyboard-nav.js` and
 * `find-shortcut.js`; keep the groups below in sync with those handlers.
 *
 * @module editor/shortcuts
 */

// Show the platform-appropriate modifier caption. The handlers accept both
// Cmd and Ctrl; the overlay just reflects the user's likely key.
const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(
  (typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || ''
);
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const SHIFT = IS_MAC ? '⇧' : 'Shift';
/** Join a modifier with a key, e.g. "⌘D" on mac, "Ctrl+D" elsewhere. */
const combo = (...parts) => parts.join(IS_MAC ? '' : '+');

/**
 * @returns {Array<{ title: string, rows: Array<{ keys: string[], desc: string }> }>}
 */
function getEditorShortcutGroups() {
  return [
    {
      title: t('editor.shortcuts.group.slides', 'Slides'),
      rows: [
        { keys: ['↑', '↓'], desc: t('editor.shortcuts.navigate', 'Previous / next slide') },
        {
          keys: [combo(SHIFT, '↑'), combo(SHIFT, '↓')],
          desc: t('editor.shortcuts.extend', 'Extend selection'),
        },
        { keys: [combo(MOD, 'D')], desc: t('editor.shortcuts.duplicate', 'Duplicate slide(s)') },
        { keys: [combo(MOD, 'C')], desc: t('editor.shortcuts.copy', 'Copy slide(s)') },
        { keys: [combo(MOD, 'V')], desc: t('editor.shortcuts.paste', 'Paste slide(s)') },
        {
          keys: ['Delete', 'Backspace'],
          desc: t('editor.shortcuts.delete', 'Delete selected slide(s)'),
        },
      ],
    },
    {
      title: t('editor.shortcuts.group.editing', 'Editing'),
      rows: [
        { keys: [combo(MOD, 'Z')], desc: t('editor.shortcuts.undo', 'Undo') },
        { keys: [combo(SHIFT, MOD, 'Z')], desc: t('editor.shortcuts.redo', 'Redo') },
        { keys: [combo(MOD, 'F')], desc: t('editor.shortcuts.find', 'Search slides') },
      ],
    },
    {
      title: t('editor.shortcuts.group.general', 'General'),
      rows: [
        { keys: ['?', combo(MOD, '/')], desc: t('editor.shortcuts.help', 'Show this help') },
        { keys: ['Esc'], desc: t('editor.shortcuts.escape', 'Close dialogs') },
      ],
    },
  ];
}

/**
 * Open the editor keyboard-shortcut help overlay.
 * @param {Object} [opts]
 * @param {() => void} [opts.onClose]
 * @returns {{ close: () => void }}
 */
export function openEditorShortcuts({ onClose } = {}) {
  return openShortcutsOverlay({
    title: t('editor.shortcuts.title', 'Keyboard shortcuts'),
    groups: getEditorShortcutGroups(),
    modalClass: 'editor-shortcuts-modal',
    onClose,
  });
}

/**
 * Install the `?` / Cmd+/ global listener that toggles the shortcut overlay,
 * and expose `open()` for a topbar button. Ignores keystrokes while the user is
 * typing in a field. Returns `{ open, detach }`.
 *
 * @param {Object} [opts]
 * @param {() => boolean} [opts.isEnabled] - Optional gate (e.g. skip when a
 *   modal already owns the keyboard).
 * @returns {{ open: () => void, detach: () => void }}
 */
export function attachEditorShortcutsHelp({ isEnabled } = {}) {
  let overlay = null;

  const open = () => {
    if (overlay) {
      overlay.close();
      overlay = null;
      return;
    }
    overlay = openEditorShortcuts({
      onClose: () => {
        overlay = null;
      },
    });
  };

  const onKey = (e) => {
    const key = e.key;
    const isHelp = key === '?' || ((e.metaKey || e.ctrlKey) && key === '/');
    if (!isHelp) return;

    const el = e.target;
    const tag = String(el?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (el?.isContentEditable) return;
    if (typeof isEnabled === 'function' && !isEnabled()) return;

    e.preventDefault();
    open();
  };

  window.addEventListener('keydown', onKey);

  return {
    open,
    detach: () => {
      window.removeEventListener('keydown', onKey);
      if (overlay) {
        overlay.close();
        overlay = null;
      }
    },
  };
}
