import { confirmModal } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { icon } from '../../../lib/dom/icons.js';
import { createDropdown } from '../../../lib/dom/dropdown.js';
import { h } from '../../../lib/dom.js';

export function createEditorTopbarMoreMenu({
  root,
  toast,
  api,
  pres,
  id,
  requestSave,
  isDirty,
  onError,
  nav,
  onTranslateOther,
  canTranslate = true,
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

  const btnTranslateOther = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.more.translate', 'Translate'),
    title: t(
      'editor.more.translate.title',
      'Create (or refresh) the other language version so follow-along and switching are ready.',
    ),
    onclick: () => run(onTranslateOther),
  });
  btnTranslateOther.style.display = canTranslate ? '' : 'none';

  const btnVersions = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.more.versions', 'Versions…'),
    onclick: () => run(onVersions),
  });

  const btnDuplicateDeck = h('button', {
    class: 'dropdown-item',
    type: 'button',
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
        nav?.(`/app/${created.id}`);
      } catch (e) {
        toast.error(e, { id: 'duplicate-deck' });
      }
    },
  });

  const btnMoveToTrash = h('button', {
    class: 'dropdown-item is-danger',
    type: 'button',
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
        nav?.('/app');
      } catch (e) {
        toast.error(e, { id: 'move-to-trash' });
      }
    },
  });

  const btnSubscription = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.more.subscription', 'Deck notifications…'),
    title: t(
      'editor.more.subscription.title',
      'Choose which comment activity on this deck notifies you.',
    ),
    onclick: () => run(onSubscription),
  });

  // Utilities demoted from their own topbar icons (2026-07-16 chrome
  // re-org): still one click away, without crowding the deck-action zone.
  const btnAnalyze = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.analyze', 'AI Analysis'),
    onclick: () => run(onAnalyze),
  });

  const btnSettings = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('common.settings', 'Settings'),
    onclick: () => run(onOpenSettings),
  });

  const btnShortcuts = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: `${t('editor.shortcuts.title', 'Keyboard shortcuts')} (?)`,
    onclick: () => run(onShowShortcuts),
  });

  // Mirror of the deck-grid topbar button; CSS shows it only at widths
  // where the bar hides that button.
  const btnOverview = h('button', {
    class: 'dropdown-item topbar-overflow-item-lg',
    type: 'button',
    text: t('editor.deckGrid.open', 'Slide overview'),
    onclick: () => run(onOpenOverview),
  });

  // Responsive overflow items - visible only at narrow widths (CSS hides on desktop)
  const btnThemeToggle = h('button', {
    class: 'dropdown-item topbar-overflow-item',
    type: 'button',
    text: t('common.toggleTheme', 'Toggle dark/light mode'),
    onclick: () => run(onToggleTheme),
  });

  const btnLogout = h('button', {
    class: 'dropdown-item is-danger',
    type: 'button',
    text: t('common.signOut', 'Sign out'),
    onclick: async () => {
      try {
        await onLogout?.();
      } catch (e) {
        console.error('Logout failed:', e);
      }
      nav?.('/login');
    },
  });

  // Close the "more" menu on outside click / Escape (capture-phase; robust
  // against stopPropagation()).
  const {
    details: moreDetails,
    close: closeMore,
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

  // Ensure menu items close the dropdown before executing actions.
  const closeMoreOnClick = (btn) => {
    const prev = btn.onclick;
    btn.onclick = (e) => {
      try {
        closeMore();
      } catch {
        // ignore
      }
      return prev?.(e);
    };
  };
  closeMoreOnClick(btnOverview);
  closeMoreOnClick(btnAnalyze);
  closeMoreOnClick(btnTranslateOther);
  closeMoreOnClick(btnVersions);
  closeMoreOnClick(btnDuplicateDeck);
  closeMoreOnClick(btnSubscription);
  closeMoreOnClick(btnSettings);
  closeMoreOnClick(btnShortcuts);
  closeMoreOnClick(btnThemeToggle);
  closeMoreOnClick(btnMoveToTrash);
  closeMoreOnClick(btnLogout);

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
