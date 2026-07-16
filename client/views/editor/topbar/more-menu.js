import { installDismissOnOutside } from '../../../lib/dom.js';
import { confirmModal } from '../../../lib/modal.js';
import { t } from '../../../lib/ui-i18n.js';

export function createEditorTopbarMoreMenu({
  h,
  root,
  toast,
  api,
  pres,
  id,
  requestSave,
  isDirty,
  openOverlayClosers,
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
} = {}) {
  const detachers = [];

  const btnTranslateOther = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.more.translate', 'Translate'),
    title:
      t(
        'editor.more.translate.title',
        'Create (or refresh) the other language version so follow-along and switching are ready.'
      ),
    onclick: () => onTranslateOther?.().catch?.((e) => onError?.(e)),
  });
  btnTranslateOther.style.display = canTranslate ? '' : 'none';

  const btnVersions = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.more.versions', 'Versions…'),
    onclick: () => onVersions?.({ openOverlayClosers }).catch?.((e) => onError?.(e)),
  });

  const btnDuplicateDeck = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.more.duplicateDeck', 'Duplicate deck…'),
    title: t(
      'editor.more.duplicateDeck.title',
      'Create a private copy of this presentation.'
    ),
    onclick: async () => {
      if (isDirty?.()) {
        toast.info(t('common.savingFirst', 'Saving first…'), {
          id: 'duplicate-deck',
          durationMs: 5200,
        });
        await requestSave?.();
        if (isDirty?.()) {
          toast.error(t('common.saveFailedAborted', 'Could not save; aborted.'), {
            id: 'duplicate-deck',
          });
          return;
        }
      }

      const ok = await confirmModal(h, root || document.body, {
        title: t('editor.more.duplicateDeck', 'Duplicate deck…'),
        message: t(
          'editor.more.duplicateDeck.confirm',
          'Duplicate "{title}"?',
          {
            title:
              pres?.title ||
              t('editor.more.duplicateDeck.thisPresentation', 'this presentation'),
          }
        ),
      });
      if (!ok) return;

      try {
        const created = await api(`/api/presentations/${id}/duplicate`, {
          method: 'POST',
        });
        toast.success(
          t('editor.more.duplicateDeck.done', 'Duplicated. Opening copy…'),
          { id: 'duplicate-deck', durationMs: 1800 }
        );
        nav?.(`/app/${created.id}`);
      } catch (e) {
        toast.error(String(e?.message || e), { id: 'duplicate-deck' });
      }
    },
  });

  const btnMoveToTrash = h('button', {
    class: 'dropdown-item is-danger',
    type: 'button',
    text: t('editor.more.trash', 'Move to trash…'),
    title: t(
      'editor.more.trash.title',
      'Move this presentation to trash.'
    ),
    onclick: async () => {
      const ok = await confirmModal(h, root || document.body, {
        title: t('editor.more.trash', 'Move to trash…'),
        message: t(
          'editor.more.trash.confirm',
          'Move "{title}" to trash?',
          {
            title:
              pres?.title ||
              t('editor.more.duplicateDeck.thisPresentation', 'this presentation'),
          }
        ),
        confirmLabel: t('editor.more.trash', 'Move to trash…'),
        danger: true,
      });
      if (!ok) return;

      try {
        await api(`/api/presentations/${id}`, {
          method: 'DELETE',
        });
        toast.success(
          t('editor.more.trash.done', 'Moved to trash.'),
          { id: 'move-to-trash', durationMs: 1800 }
        );
        nav?.('/app');
      } catch (e) {
        toast.error(String(e?.message || e), { id: 'move-to-trash' });
      }
    },
  });

  // Utilities demoted from their own topbar icons (2026-07-16 chrome
  // re-org): still one click away, without crowding the deck-action zone.
  const btnAnalyze = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.analyze', 'AI Analysis'),
    onclick: () => onAnalyze?.(),
  });

  const btnSettings = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('common.settings', 'Settings'),
    onclick: () => onOpenSettings?.(),
  });

  const btnShortcuts = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: `${t('editor.shortcuts.title', 'Keyboard shortcuts')} (?)`,
    onclick: () => onShowShortcuts?.(),
  });

  // Mirror of the deck-grid topbar button; CSS shows it only at widths
  // where the bar hides that button.
  const btnOverview = h('button', {
    class: 'dropdown-item topbar-overflow-item-lg',
    type: 'button',
    text: t('editor.deckGrid.open', 'Slide overview'),
    onclick: () => onOpenOverview?.(),
  });

  // Responsive overflow items - visible only at narrow widths (CSS hides on desktop)
  const btnThemeToggle = h('button', {
    class: 'dropdown-item topbar-overflow-item',
    type: 'button',
    text: t('common.toggleTheme', 'Toggle dark/light mode'),
    onclick: () => onToggleTheme?.(),
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

  const moreDetails = h('details', { class: 'dropdown' });
  const moreSummary = h(
    'summary',
    {
      class: 'btn btn-secondary btn-icon dropdown-trigger',
      title: t('common.moreOptions', 'More options'),
      'aria-label': t('common.moreOptions', 'More options'),
    },
    [h('span', { text: '⋯', 'aria-hidden': 'true' })]
  );
  const moreMenu = h('div', { class: 'dropdown-menu dropdown-menu-right' }, [
    btnOverview,
    btnAnalyze,
    btnTranslateOther,
    btnVersions,
    btnDuplicateDeck,
    h('div', { class: 'dropdown-sep' }),
    btnSettings,
    btnShortcuts,
    // Responsive overflow item (visible only at narrow viewports)
    btnThemeToggle,
    h('div', { class: 'dropdown-sep' }),
    btnMoveToTrash,
    btnLogout,
  ]);
  moreDetails.append(moreSummary, moreMenu);

  // Close the "more" menu on outside click / Escape (capture-phase; robust against stopPropagation()).
  detachers.push(
    installDismissOnOutside({
      rootEl: moreDetails,
      isOpen: () => !!moreDetails.open,
      close: () => {
        moreDetails.open = false;
      },
    })
  );

  // Ensure menu items close the dropdown before executing actions.
  const closeMoreOnClick = (btn) => {
    const prev = btn.onclick;
    btn.onclick = (e) => {
      try {
        moreDetails.open = false;
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
