import { confirmModal } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { icon } from '../../../lib/dom/icons.js';
import { createDropdown } from '../../../lib/dom/dropdown.js';
import { h } from '../../../lib/dom.js';
import { nav } from '../../../lib/state/router.js';

export function createEditorTopbarMoreMenu({
  root,
  toast,
  api,
  pres,
  id,
  requestSave,
  isDirty,
  onError,
  onTranslateOther,
  // A predicate, not a boolean: whether there is another language version to
  // retranslate changes while the menu exists (the language menu creates them),
  // so it is asked again every time the menu opens.
  canTranslate = () => true,
  onVersions,
  onLogout,
  // Responsive overflow item (shown at narrow widths via CSS)
  onToggleTheme,
  // Utilities demoted from their own topbar icons
  onAnalyze,
  onShowShortcuts,
  onOpenSettings,
  onOpenOverview,
  onSubscription,
} = {}) {
  const detachers = [];

  /**
   * Invoke an optional `on*` handler and route any failure to `onError`.
   *
   * The props are a mix of sync and async: `handler?.()` covers "no handler
   * was passed", but calling `.catch()` on what it returns only works when the
   * handler happens to be async. `openVersionsModal` is synchronous and
   * returns nothing, so `onVersions?.().catch?.(…)` threw a TypeError before
   * the menu item had done anything (B116). Awaiting inside a try/catch is one
   * shape that fits both kinds, and it also catches a synchronous throw.
   *
   * @param {Function|undefined} handler
   * @returns {Promise<void>}
   */
  const run = async (handler) => {
    try {
      await handler?.();
    } catch (e) {
      onError?.(e);
    }
  };

  /**
   * The dropdown's close function. Declared before the items because each item
   * closes the menu, and `createDropdown` — which hands the function back —
   * needs the items to exist first. The handlers only run after both halves
   * are wired, so the closure sees the real function by the time it is called.
   *
   * @type {() => void}
   */
  let closeMore = () => {};

  /**
   * A dropdown item: one button, one click handler, closing the menu **before**
   * it runs the action.
   *
   * The close used to be bolted on afterwards, by reading `btn.onclick` and
   * reassigning it. That never worked: `h()` wires an `onclick:` prop through
   * `addEventListener`, so the property was always `null`, the wrapper had no
   * previous handler to call, and the two handlers ran in registration
   * order — action first, close second, the exact inverse of what the comment
   * above it claimed (B117, same assumption class as B116).
   *
   * Closing first is the deliberate order. Several of these actions open a
   * modal, navigate away, or tear down the editor tree; running `closeMore()`
   * after that means touching an element that may be gone, which is why the
   * old wrapper needed a try/catch to survive itself.
   *
   * @param {Object} attrs - `h()` attributes; `onclick` is the item's action.
   * @returns {HTMLButtonElement}
   */
  const menuItem = ({ onclick, class: className, ...attrs }) =>
    h('button', {
      class: className || 'dropdown-item',
      type: 'button',
      ...attrs,
      onclick: (e) => {
        closeMore();
        return onclick?.(e);
      },
    });

  const btnTranslateOther = menuItem({
    text: t('editor.more.translate', 'Translate'),
    title: t(
      'editor.more.translate.title',
      'Refresh every other language version of this deck from the one you are editing.',
    ),
    onclick: () => run(onTranslateOther),
  });
  const syncTranslateItem = () => {
    btnTranslateOther.style.display = canTranslate?.() ? '' : 'none';
  };
  syncTranslateItem();

  const btnVersions = menuItem({
    text: t('editor.more.versions', 'Versions…'),
    onclick: () => run(onVersions),
  });

  const btnDuplicateDeck = menuItem({
    text: t('editor.more.duplicateDeck', 'Duplicate deck…'),
    title: t(
      'editor.more.duplicateDeck.title',
      'Create a private copy of this presentation.',
    ),
    onclick: async () => {
      if (isDirty?.()) {
        toast.info(t('common.savingFirst', 'Saving first…'), {
          id: 'duplicate-deck',
          durationMs: 5200,
        });
        await requestSave?.();
        if (isDirty?.()) {
          toast.error(
            t('common.saveFailedAborted', 'Could not save; aborted.'),
            {
              id: 'duplicate-deck',
            },
          );
          return;
        }
      }

      const ok = await confirmModal(root || document.body, {
        title: t('editor.more.duplicateDeck', 'Duplicate deck…'),
        message: t(
          'editor.more.duplicateDeck.confirm',
          'Duplicate “{title}”?',
          {
            title:
              pres?.title ||
              t(
                'editor.more.duplicateDeck.thisPresentation',
                'this presentation',
              ),
          },
        ),
      });
      if (!ok) return;

      try {
        const created = await api(`/api/presentations/${id}/duplicate`, {
          method: 'POST',
        });
        toast.success(
          t('editor.more.duplicateDeck.done', 'Duplicated. Opening copy…'),
          { id: 'duplicate-deck', durationMs: 1800 },
        );
        nav(`/app/${created.id}`);
      } catch (e) {
        toast.error(e, { id: 'duplicate-deck' });
      }
    },
  });

  const btnMoveToTrash = menuItem({
    class: 'dropdown-item is-danger',
    text: t('editor.more.trash', 'Move to trash…'),
    title: t('editor.more.trash.title', 'Move this presentation to trash.'),
    onclick: async () => {
      const ok = await confirmModal(root || document.body, {
        title: t('editor.more.trash', 'Move to trash…'),
        message: t('editor.more.trash.confirm', 'Move "{title}" to trash?', {
          title:
            pres?.title ||
            t(
              'editor.more.duplicateDeck.thisPresentation',
              'this presentation',
            ),
        }),
        confirmLabel: t('editor.more.trash', 'Move to trash…'),
        danger: true,
      });
      if (!ok) return;

      try {
        await api(`/api/presentations/${id}`, {
          method: 'DELETE',
        });
        toast.success(t('editor.more.trash.done', 'Moved to trash.'), {
          id: 'move-to-trash',
          durationMs: 1800,
        });
        nav('/app');
      } catch (e) {
        toast.error(e, { id: 'move-to-trash' });
      }
    },
  });

  const btnSubscription = menuItem({
    text: t('editor.more.subscription', 'Deck notifications…'),
    title: t(
      'editor.more.subscription.title',
      'Choose which comment activity on this deck notifies you.',
    ),
    onclick: () => run(onSubscription),
  });

  // Utilities demoted from their own topbar icons (2026-07-16 chrome
  // re-org): still one click away, without crowding the deck-action zone.
  const btnAnalyze = menuItem({
    text: t('editor.analyze', 'AI Analysis'),
    onclick: () => run(onAnalyze),
  });

  const btnSettings = menuItem({
    text: t('common.settings', 'Settings'),
    onclick: () => run(onOpenSettings),
  });

  const btnShortcuts = menuItem({
    text: `${t('editor.shortcuts.title', 'Keyboard shortcuts')} (?)`,
    onclick: () => run(onShowShortcuts),
  });

  // Mirror of the deck-grid topbar button; CSS shows it only at widths
  // where the bar hides that button.
  const btnOverview = menuItem({
    class: 'dropdown-item topbar-overflow-item-lg',
    text: t('editor.deckGrid.open', 'Slide overview'),
    onclick: () => run(onOpenOverview),
  });

  // Responsive overflow items - visible only at narrow widths (CSS hides on desktop)
  const btnThemeToggle = menuItem({
    class: 'dropdown-item topbar-overflow-item',
    text: t('common.toggleTheme', 'Toggle dark/light mode'),
    onclick: () => run(onToggleTheme),
  });

  const btnLogout = menuItem({
    class: 'dropdown-item is-danger',
    text: t('common.signOut', 'Sign out'),
    onclick: async () => {
      try {
        await onLogout?.();
      } catch (e) {
        console.error('Logout failed:', e);
      }
      nav('/login');
    },
  });

  // Close the "more" menu on outside click / Escape (capture-phase; robust
  // against stopPropagation()).
  const {
    details: moreDetails,
    close: closeDropdown,
    detach: detachMore,
  } = createDropdown({
    triggerClass: 'ghost-icon-btn',
    triggerContent: [icon('ellipsis', { size: 16 })],
    title: t('common.moreOptions', 'More options'),
    ariaLabel: t('common.moreOptions', 'More options'),
    menuClass: 'dropdown-menu-right',
    items: [
      btnOverview,
      btnAnalyze,
      btnTranslateOther,
      btnVersions,
      btnDuplicateDeck,
      h('div', { class: 'dropdown-sep' }),
      btnSubscription,
      btnSettings,
      btnShortcuts,
      // Responsive overflow item (visible only at narrow viewports)
      btnThemeToggle,
      h('div', { class: 'dropdown-sep' }),
      btnMoveToTrash,
      btnLogout,
    ],
  });
  detachers.push(detachMore);
  closeMore = closeDropdown;

  // Re-ask the state-dependent items on every open. Without this the Translate
  // item keeps the visibility it was built with, so a language added since the
  // topbar was created leaves it hidden.
  moreDetails.addEventListener('toggle', () => {
    if (moreDetails.open) syncTranslateItem();
  });

  // Warm the notes session or other actions can happen outside; keep module focused.
  // (No-op here.)

  return {
    el: moreDetails,
    detach: () => {
      for (const d of detachers) {
        try {
          if (typeof d === 'function') d();
        } catch {
          // ignore
        }
      }
    },
  };
}
