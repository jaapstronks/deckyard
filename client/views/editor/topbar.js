/**
 * Editor topbar component.
 *
 * This module has been refactored to use focused sub-modules:
 * - topbar/language-mode.js - Language switching UI and logic
 * - topbar/lock-request.js - Lock state and access request UI
 * - topbar/more-menu.js - More menu dropdown
 */

import { installDismissOnOutside } from '../../lib/dom.js';
import { openSettingsModal as openSettingsModalImpl } from './modals/settings-modal.js';
import { openVersionsModal as openVersionsModalImpl } from './modals/versions-modal.js';
import { getUiModePreference, setUiModePreference } from '../../lib/ui-mode.js';
import { logout } from '../../lib/auth.js';
import { createEditorTopbarMoreMenu } from './topbar/more-menu.js';
import { createLanguageMode } from './topbar/language-mode.js';
import { iconUrl } from '../../../shared/icon-names.js';
import { createLockRequestUI } from './topbar/lock-request.js';
import { t } from '../../lib/ui-i18n.js';
import { createAvatar, updateAvatar } from '../../lib/avatar.js';
import { getUserProfileAsync } from '../../lib/user-profiles.js';
import { displayNameFromEmail } from '../../lib/user-format.js';
import { createUserMenu } from '../../lib/user-menu.js';

export function createEditorTopbar({
  h,
  api,
  toast,
  root,
  nav,
  pres,
  theme,
  id,
  user,
  requestSave,
  isDirty,
  getSelectedSlideId,
  setSelectedSlideId,
  editorState,
  openTitleModal,
  ensureNotesSession,
  getNotesSessionId,
  onError,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onShowShortcuts,
  normalizeLang,
  otherLang,
  topbarExportEl,
  topbarShareEl,
  syncShareUi,
  openOverlayClosers,
  markDirty,
  setPresenceText,
  onToggleComments,
  onToggleInspector,
  onToggleNotes,
  setCommentsBadge,
  setLockStateCallback,
  onReadOnlyChange,
  onAnalyze,
  onOpenOverview,
  collabLanguage,
} = {}) {
  const detachers = [];

  // ============================================================
  // PRESENCE INDICATOR
  // ============================================================

  const presenceEl = h('div', {
    class: 'topbar-presence',
    text: '',
  });
  const setPresence = (t) => {
    const s = String(t || '').trim();
    presenceEl.textContent = s;
    presenceEl.style.display = s ? '' : 'none';
  };
  if (typeof setPresenceText === 'function') {
    try {
      setPresenceText(setPresence);
    } catch {
      // ignore
    }
  }
  setPresence('');

  // ============================================================
  // AUTHOR DISPLAY
  // ============================================================

  const ownerEmail = pres?.ownerEmail || pres?.createdBy || '';
  const authorDisplayEl = h('div', { class: 'topbar-author' });

  if (ownerEmail) {
    // Create initial avatar with just email (will update with profile data)
    const authorAvatar = createAvatar({
      email: ownerEmail,
      name: '',
      size: 'xs',
      className: 'topbar-author-avatar',
    });

    const authorNameEl = h('span', {
      class: 'topbar-author-name',
      text: displayNameFromEmail(ownerEmail).split(' ')[0], // First name only initially
    });

    authorDisplayEl.append(authorAvatar, authorNameEl);

    // Fetch profile and update
    getUserProfileAsync(ownerEmail).then((profile) => {
      if (profile?.imageUrl) {
        updateAvatar(authorAvatar, { imageUrl: profile.imageUrl });
      }
      if (profile?.name) {
        const firstName = profile.name.split(' ')[0];
        authorNameEl.textContent = firstName;
      }
    }).catch(() => {
      // Keep initial values on error
    });
  }

  // ============================================================
  // TITLE
  // ============================================================

  const topbarTitleEl = h('button', {
    class: 'topbar-pres-title',
    type: 'button',
    title: pres.title,
    onclick: () => openTitleModal?.({ mode: 'edit' }),
  });
  topbarTitleEl.append(
    h('span', { text: pres.title }),
    h('span', { text: '✎', 'aria-hidden': 'true' })
  );

  // ============================================================
  // SAVE STATUS CHIP
  // ============================================================
  // Persistent indicator of whether the current work is saved. Driven by the
  // save manager via setSaveStatus(); the text differs per state so the cue
  // does not rely on colour alone.

  const saveStatusEl = h('span', {
    class: 'topbar-save-status',
    role: 'status',
    'aria-live': 'polite',
  });
  const saveStatusCopy = {
    saving: () => t('editor.saveStatus.saving', 'Saving…'),
    saved: () => t('editor.saveStatus.saved', 'Saved'),
    unsaved: () => t('editor.saveStatus.unsaved', 'Unsaved changes'),
    error: () => t('editor.saveStatus.failed', 'Save failed'),
  };
  const setSaveStatus = (status) => {
    const key = saveStatusCopy[status] ? status : 'idle';
    if (key === 'idle') {
      saveStatusEl.textContent = '';
      saveStatusEl.className = 'topbar-save-status';
      saveStatusEl.style.display = 'none';
      return;
    }
    saveStatusEl.style.display = '';
    saveStatusEl.className = `topbar-save-status is-${key}`;
    saveStatusEl.textContent = saveStatusCopy[key]();
  };
  setSaveStatus('idle');

  // ============================================================
  // LANGUAGE MODE
  // ============================================================

  const languageMode = createLanguageMode({
    h,
    root,
    pres,
    id,
    api,
    requestSave,
    isDirty,
    markDirty,
    normalizeLang,
    otherLang,
    getSelectedSlideId,
    setSelectedSlideId,
    editorState,
    topbarTitleEl,
    toast,
    collabLanguage,
  });

  // ============================================================
  // LOCK REQUEST UI
  // ============================================================

  const lockRequestUI = createLockRequestUI({
    h,
    root,
    toast,
    setLockStateCallback,
    onReadOnlyChange,
  });

  // ============================================================
  // SETTINGS BUTTON
  // ============================================================

  const openSettings = () =>
    openSettingsModalImpl({
      h,
      root,
      pres,
      api,
      openOverlayClosers,
      markDirty,
      requestSave,
    });

  // ============================================================
  // PANE SWITCHER (Inspector / Comments — Notes joins as a third pane)
  // ============================================================

  // Labeled tabs at the far right of the topbar, visually one group sitting
  // exactly above the rail they control. Pressed = "rail open on MY pane";
  // clicking the active tab dismisses the rail. Always visible (also with
  // the rail closed), which is what makes the rail findable.
  const commentsBadgeEl = h('span', { class: 'comments-badge', text: '' });
  const btnComments = h('button', {
    class: 'topbar-pane-tab topbar-comments-btn',
    type: 'button',
    title: t('editor.comments', 'Comments'),
    'aria-pressed': 'false',
    onclick: () => onToggleComments?.(),
  });
  btnComments.append(
    h('img', { class: 'topbar-btn-icon', src: iconUrl('message-circle'), alt: '', 'aria-hidden': 'true' }),
    h('span', { class: 'topbar-pane-tab-label', text: t('editor.comments', 'Comments') }),
    commentsBadgeEl
  );

  /**
   * Update comments badge.
   * @param {number|{count: number, hasNew: boolean}} data - Count or object with count and hasNew flag
   */
  const updateCommentsBadge = (data) => {
    // Support both old (number) and new ({ count, hasNew }) formats
    const n = typeof data === 'object' ? (Number(data.count) || 0) : (Number(data) || 0);
    const hasNew = typeof data === 'object' ? Boolean(data.hasNew) : true;

    commentsBadgeEl.textContent = n > 0 ? String(n) : '';
    commentsBadgeEl.hidden = n === 0;

    // Red = new/unseen, grey = seen but unresolved
    commentsBadgeEl.classList.toggle('comments-badge--seen', !hasNew && n > 0);
  };
  if (typeof setCommentsBadge === 'function') {
    try {
      setCommentsBadge(updateCommentsBadge);
    } catch {
      // ignore
    }
  }

  const btnInspector = h('button', {
    class: 'topbar-pane-tab topbar-inspector-btn',
    type: 'button',
    title: t('editor.inspector.toggle', 'Show or hide the inspector'),
    'aria-pressed': 'false',
    onclick: () => onToggleInspector?.(),
  });
  btnInspector.append(
    h('img', { class: 'topbar-btn-icon', src: iconUrl('sliders-horizontal'), alt: '', 'aria-hidden': 'true' }),
    h('span', { class: 'topbar-pane-tab-label', text: t('editor.inspector.title', 'Inspector') })
  );

  const btnNotes = h('button', {
    class: 'topbar-pane-tab topbar-notes-btn',
    type: 'button',
    title: t('editor.notes.title', 'Presenter notes'),
    'aria-pressed': 'false',
    onclick: () => onToggleNotes?.(),
  });
  btnNotes.append(
    h('img', { class: 'topbar-btn-icon', src: iconUrl('file-text'), alt: '', 'aria-hidden': 'true' }),
    h('span', { class: 'topbar-pane-tab-label', text: t('editor.notes.tab', 'Notes') })
  );

  const paneSwitcher = h(
    'div',
    { class: 'topbar-pane-switcher', role: 'group', 'aria-label': t('editor.panes.label', 'Side panels') },
    [btnInspector, btnComments, btnNotes]
  );

  /**
   * Reflect the rail state on the pane toggles. Pressed means "the rail is
   * open on MY pane", not merely "the rail is open" - so a pane switch flips
   * one tab off and the other on.
   * @param {{ open: boolean, pane: string|null }} state
   */
  const setInspectorPaneState = ({ open, pane } = {}) => {
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

  // ============================================================
  // DECK OVERVIEW (LIGHT TABLE) BUTTON
  // ============================================================

  const btnOverview = h('button', {
    class: 'btn btn-secondary btn-icon topbar-overview-btn',
    type: 'button',
    title: t('editor.deckGrid.open', 'Slide overview'),
    'aria-label': t('editor.deckGrid.open', 'Slide overview'),
    onclick: () => onOpenOverview?.(),
  });
  btnOverview.append(h('img', { class: 'topbar-btn-icon', src: iconUrl('layout-grid'), alt: '', 'aria-hidden': 'true' }));

  // ============================================================
  // THEME TOGGLE
  // ============================================================

  const toggleTheme = () => {
    const current = getUiModePreference();
    const next = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
    setUiModePreference(next);
  };

  // ============================================================
  // NOTES QR / COMPANION
  // ============================================================

  const openNotesQr = () => {
    const existing = getNotesSessionId?.();
    if (existing) {
      const u = new URL(`/notes-join/${existing}`, location.origin);
      window.open(u.pathname + u.search, '_blank', 'noopener,noreferrer');
      return;
    }

    const w = window.open('about:blank', '_blank');
    try {
      if (w) w.opener = null;
    } catch {}

    ensureNotesSession?.()
      .then((sid) => {
        const u = new URL(`/notes-join/${sid}`, location.origin);
        const path = u.pathname + u.search;
        try {
          if (w && !w.closed) w.location.href = path;
          else window.open(path, '_blank', 'noopener,noreferrer');
        } catch {
          location.href = path;
        }
      })
      .catch((e) => {
        try {
          if (w && !w.closed) w.close();
        } catch {}
        toast.error(String(e?.message || e));
      });
  };

  // ============================================================
  // USER MENU
  // ============================================================

  const userMenu = createUserMenu({
    h,
    user,
    nav,
    onLogout: () => logout(),
  });
  detachers.push(userMenu.detach);

  // ============================================================
  // MORE MENU
  // ============================================================

  const moreMenu = createEditorTopbarMoreMenu({
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
    onTranslateOther: languageMode.translateOtherLanguage,
    canTranslate: languageMode.canTranslate(),
    onVersions: () =>
      openVersionsModalImpl({
        h,
        api,
        root,
        pres,
        id,
        requestSave,
        isDirty,
        openOverlayClosers,
        theme,
      }),
    onLogout: () => logout(),
    onToggleTheme: toggleTheme,
    // Demoted from their own topbar icons (2026-07-16 chrome re-org): the
    // bar keeps deck-level actions; utilities live here.
    onAnalyze: () => onAnalyze?.(),
    onShowShortcuts: () => onShowShortcuts?.(),
    onOpenSettings: () => openSettings(),
    onOpenOverview: () => onOpenOverview?.(),
  });
  detachers.push(moreMenu.detach);

  // ============================================================
  // ANALYTICS BUTTON
  // ============================================================

  const btnAnalytics = h('button', {
    class: 'btn btn-secondary btn-icon topbar-analytics-btn',
    type: 'button',
    title: t('editor.analytics', 'Analytics'),
    'aria-label': t('editor.analytics', 'Analytics'),
    onclick: () => nav?.(`/analytics/${id}`),
  });
  btnAnalytics.append(h('img', { class: 'topbar-btn-icon', src: iconUrl('chart-column'), alt: '', 'aria-hidden': 'true' }));

  // Only show analytics button if presentation is published or has share links
  // (analytics only tracks external viewers via share links/follow mode)
  const isPublished = !!(pres?.published?.id);
  if (isPublished) {
    // Already published - show analytics button immediately
    btnAnalytics.style.display = '';
  } else {
    // Not published - check for share links
    btnAnalytics.style.display = 'none';
    api(`/api/presentations/${id}/share-links`)
      .then((resp) => {
        const hasShareLinks = Array.isArray(resp?.shareLinks) && resp.shareLinks.length > 0;
        btnAnalytics.style.display = hasShareLinks ? '' : 'none';
      })
      .catch(() => {
        // On error, keep hidden
      });
  }

  // ============================================================
  // PRESENT BUTTON
  // ============================================================

  const btnPresent = h('button', {
    class: 'btn btn-primary',
    text: t('editor.present', 'Present'),
    onclick: async () => {
      if (isDirty?.()) {
        toast.info(t('common.savingFirst', 'Saving first…'), {
          id: 'editor-present',
          durationMs: 5200,
        });
        await requestSave?.();
        if (isDirty?.()) {
          toast.error(t('editor.present.abortedSaveFailed', 'Could not save; presenting aborted.'), {
            id: 'editor-present',
          });
          return;
        }
      }

      const sid = getSelectedSlideId?.();
      const idx = (pres.slides || []).findIndex((s) => s.id === sid);
      const slideId = idx >= 0 ? pres.slides[idx].id : null;
      const u = new URL(`/present/${id}`, location.origin);
      if (slideId) u.searchParams.set('slideId', slideId);
      if (pres?.i18n?.active === 'nl' || pres?.i18n?.active === 'en-GB')
        u.searchParams.set('lang', pres.i18n.active);
      window.open(u.pathname + u.search, '_blank', 'noopener,noreferrer');

      try {
        syncShareUi?.();
      } catch {
        // ignore
      }
    },
  });

  // Present is the primary CTA; the attached caret menu holds the live-
  // presenting extras you never need while editing (Companion phone remote).
  const presentMenuDetails = h('details', { class: 'dropdown topbar-present-more' });
  const presentMenuSummary = h(
    'summary',
    {
      class: 'btn btn-primary btn-icon dropdown-trigger topbar-present-caret',
      title: t('editor.present.more', 'More presenting options'),
      'aria-label': t('editor.present.more', 'More presenting options'),
    },
    [h('span', { text: '▾', 'aria-hidden': 'true' })]
  );
  const presentCompanionItem = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.companion', 'Companion'),
    title: t(
      'editor.companion.title',
      'Open speaker notes companion on your phone (QR code).'
    ),
    onclick: () => {
      presentMenuDetails.open = false;
      openNotesQr();
    },
  });
  presentMenuDetails.append(
    presentMenuSummary,
    h('div', { class: 'dropdown-menu dropdown-menu-right' }, [presentCompanionItem])
  );
  detachers.push(
    installDismissOnOutside({
      rootEl: presentMenuDetails,
      isOpen: () => !!presentMenuDetails.open,
      close: () => {
        presentMenuDetails.open = false;
      },
    })
  );
  const presentGroup = h('div', { class: 'topbar-present-group' }, [btnPresent, presentMenuDetails]);

  // ============================================================
  // UNDO / REDO
  // ============================================================

  const btnUndo = h('button', {
    class: 'btn btn-secondary btn-icon topbar-undo-btn',
    type: 'button',
    'aria-label': t('editor.undo', 'Undo'),
    title: `${t('editor.undo', 'Undo')} (⌘Z)`,
    disabled: true,
    onclick: () => onUndo?.(),
  });
  btnUndo.append(h('img', { class: 'topbar-btn-icon', src: iconUrl('undo'), alt: '', 'aria-hidden': 'true' }));

  const btnRedo = h('button', {
    class: 'btn btn-secondary btn-icon topbar-redo-btn',
    type: 'button',
    'aria-label': t('editor.redo', 'Redo'),
    title: `${t('editor.redo', 'Redo')} (⇧⌘Z)`,
    disabled: true,
    onclick: () => onRedo?.(),
  });
  btnRedo.append(h('img', { class: 'topbar-btn-icon', src: iconUrl('redo'), alt: '', 'aria-hidden': 'true' }));

  const undoRedoGroup = h('div', { class: 'topbar-undo-group' }, [btnUndo, btnRedo]);

  // Reflect the undo manager's stacks on the buttons. Called on every stack change.
  const syncUndoButtons = () => {
    btnUndo.disabled = !(canUndo?.() ?? false);
    btnRedo.disabled = !(canRedo?.() ?? false);
  };

  // ============================================================
  // TOPBAR LAYOUT
  // ============================================================

  const topbarEl = h('div', { class: 'topbar' }, [
    h('button', {
      class: 'btn btn-secondary btn-icon',
      'aria-label': t('common.back', 'Back'),
      title: t('common.back', 'Back'),
      text: '←',
      onclick: () => nav?.('/app'),
    }),
    topbarTitleEl,
    saveStatusEl,
    authorDisplayEl,
    h('div', { class: 'topbar-spacer' }, [presenceEl]),
    undoRedoGroup,
    languageMode.el,
    lockRequestUI.el,
    topbarExportEl,
    topbarShareEl,
    btnOverview,
    btnAnalytics,
    presentGroup,
    userMenu.el,
    moreMenu.el,
    // Far right, visually its own zone: the pane switcher sits exactly above
    // the rail it controls (see the chrome re-org plan, 2026-07-16).
    h('div', { class: 'topbar-zone-sep', 'aria-hidden': 'true' }),
    paneSwitcher,
  ]);

  // Warm the notes session in the background
  ensureNotesSession?.().catch(() => {});

  languageMode.syncLangUi();

  const detach = () => {
    for (const d of detachers) {
      try {
        if (typeof d === 'function') d();
      } catch {
        // ignore
      }
    }
  };

  return { topbarEl, topbarTitleEl, setSaveStatus, syncLangUi: languageMode.syncLangUi, syncUndoButtons, setInspectorPaneState, openNotesQr, detach };
}