/**
 * Editor topbar component.
 *
 * This module has been refactored to use focused sub-modules:
 * - topbar/language-mode.js - Language switching UI and logic
 * - topbar/lock-request.js - Lock state and access request UI
 * - topbar/more-menu.js - More menu dropdown
 */

import { createDropdown } from '../../lib/dom/dropdown.js';
import { openSettingsModal as openSettingsModalImpl } from './modals/settings-modal.js';
import { openVersionsModal as openVersionsModalImpl } from './modals/versions-modal.js';
import { getUiModePreference, setUiModePreference } from '../../lib/theme/ui-mode.js';
import { logout } from '../../lib/user/auth.js';
import { createEditorTopbarMoreMenu } from './topbar/more-menu.js';
import { openSubscriptionModal } from './modals/subscription-modal.js';
import { createLanguageMode } from './topbar/language-mode.js';
import { iconUrl } from '../../../shared/icon-names.js';
import { createLockRequestUI } from './topbar/lock-request.js';
import { t } from '../../lib/ui-i18n.js';
import { createAvatar, updateAvatar } from '../../lib/user/avatar.js';
import { getUserProfileAsync } from '../../lib/user/user-profiles.js';
import { displayNameFromEmail } from '../../lib/user/user-format.js';
import { createUserMenu } from '../../lib/user/user-menu.js';
import { createNotificationBell } from '../../lib/user/notification-bell.js';
import { chevronDownIcon } from '../../lib/dom/icons.js';

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
    h('img', { class: 'topbar-title-pencil', src: iconUrl('pencil'), alt: '', 'aria-hidden': 'true' })
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
  // DECK OVERVIEW (LIGHT TABLE) BUTTON
  // ============================================================

  const btnOverview = h('button', {
    class: 'ghost-icon-btn topbar-overview-btn',
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
  // NOTIFICATION BELL
  // ============================================================

  const notificationBell = createNotificationBell({
    api,
    onNavigate: (path) => nav?.(path),
  });
  detachers.push(notificationBell.detach);

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
    onSubscription: () => openSubscriptionModal({ h, api, toast, presentationId: id }),
    onOpenOverview: () => onOpenOverview?.(),
  });
  detachers.push(moreMenu.detach);

  // ============================================================
  // ANALYTICS BUTTON
  // ============================================================

  const btnAnalytics = h('button', {
    class: 'ghost-icon-btn topbar-analytics-btn',
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
  const presentCompanionItem = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.companion', 'Companion'),
    title: t(
      'editor.companion.title',
      'Open speaker notes companion on your phone (QR code).'
    ),
    onclick: () => {
      closePresentMenu();
      openNotesQr();
    },
  });
  const { details: presentMenuDetails, close: closePresentMenu, detach: detachPresentMenu } = createDropdown({
    h,
    triggerClass: 'btn btn-primary btn-icon topbar-present-caret',
    triggerContent: [chevronDownIcon({ size: 14 })],
    title: t('editor.present.more', 'More presenting options'),
    ariaLabel: t('editor.present.more', 'More presenting options'),
    detailsClass: 'topbar-present-more',
    menuClass: 'dropdown-menu-right',
    items: [presentCompanionItem],
  });
  detachers.push(detachPresentMenu);
  const presentGroup = h('div', { class: 'topbar-present-group' }, [btnPresent, presentMenuDetails]);

  // ============================================================
  // UNDO / REDO
  // ============================================================

  const btnUndo = h('button', {
    class: 'ghost-icon-btn topbar-undo-btn',
    type: 'button',
    'aria-label': t('editor.undo', 'Undo'),
    title: `${t('editor.undo', 'Undo')} (⌘Z)`,
    disabled: true,
    onclick: () => onUndo?.(),
  });
  btnUndo.append(h('img', { class: 'topbar-btn-icon', src: iconUrl('undo'), alt: '', 'aria-hidden': 'true' }));

  const btnRedo = h('button', {
    class: 'ghost-icon-btn topbar-redo-btn',
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

  // Three zones (chrome re-org 2026-07-19). The topbar is deck-level only: the
  // pane openers moved to the slide bar (Option A), docked at its far right
  // above the inspector column they control.
  //   1. identity/navigation: back, title, save status, author + presence
  //   2. edit session: undo/redo, language, lock-request state
  //   3. deliver: overview/analytics/more as quiet ghosts, then Export,
  //      Share and the Present CTA - with the user avatar in the corner,
  //      its natural place, separated as the one global (non-deck) element.
  const backBtn = h('button', {
    class: 'ghost-icon-btn topbar-back-btn',
    'aria-label': t('common.back', 'Back'),
    title: t('common.back', 'Back'),
    onclick: () => nav?.('/app'),
  });
  backBtn.append(h('img', { class: 'topbar-btn-icon', src: iconUrl('arrow-left'), alt: '', 'aria-hidden': 'true' }));

  const topbarEl = h('div', { class: 'topbar' }, [
    backBtn,
    topbarTitleEl,
    saveStatusEl,
    authorDisplayEl,
    h('div', { class: 'topbar-spacer' }, [presenceEl]),
    undoRedoGroup,
    languageMode.el,
    lockRequestUI.el,
    h('div', { class: 'topbar-zone-sep', 'aria-hidden': 'true' }),
    btnOverview,
    btnAnalytics,
    moreMenu.el,
    topbarExportEl,
    topbarShareEl,
    presentGroup,
    h('div', { class: 'topbar-zone-sep', 'aria-hidden': 'true' }),
    notificationBell.el,
    userMenu.el,
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

  return { topbarEl, topbarTitleEl, setSaveStatus, syncLangUi: languageMode.syncLangUi, syncUndoButtons, openNotesQr, detach };
}