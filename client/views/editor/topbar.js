/**
 * Editor topbar component.
 *
 * This module has been refactored to use focused sub-modules:
 * - topbar/language-mode.js - Language switching UI and logic
 * - topbar/more-menu.js - More menu dropdown
 */

import { createDropdown } from '../../lib/dom/dropdown.js';
import { openSettingsModal as openSettingsModalImpl } from './modals/settings-modal.js';
import { openVersionsModal as openVersionsModalImpl } from './modals/versions-modal.js';
import {
  getUiModePreference,
  setUiModePreference,
} from '../../lib/theme/ui-mode.js';
import { logout } from '../../lib/user/auth.js';
import { createEditorTopbarMoreMenu } from './topbar/more-menu.js';
import { openSubscriptionModal } from './modals/subscription-modal.js';
import { createLanguageMode } from './topbar/language-mode.js';
import { t } from '../../lib/ui-i18n.js';
import { createAvatar, updateAvatar } from '../../lib/user/avatar.js';
import { getUserProfileAsync } from '../../lib/user/user-profiles.js';
import { displayNameFromEmail } from '../../lib/user/user-format.js';
import { createUserMenu } from '../../lib/user/user-menu.js';
import { createNotificationBell } from '../../lib/user/notification-bell.js';
import { icon } from '../../lib/dom/icons.js';
import { h } from '../../lib/dom.js';
import { nav } from '../../lib/state/router.js';

export function createEditorTopbar({
  api,
  toast,
  root,
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
  topbarExportEl,
  topbarShareEl,
  onExport,
  onShare,
  syncShareUi,
  markDirty,
  onAnalyze,
  onOpenOverview,
  collabLanguage,
} = {}) {
  const detachers = [];

  // ============================================================
  // AUTHOR DISPLAY
  // ============================================================

  // The owner's address is one a viewer of their own deck may see (D22), so it
  // still seeds the initials; the profile lookup keys on the stable id.
  const ownerEmail = pres?.ownerEmail || '';
  const ownerId = pres?.ownerId || pres?.createdBy?.id || '';
  const authorDisplayEl = h('div', { class: 'topbar-author topbar-fold-xl' });

  if (ownerEmail || ownerId) {
    // Start from the name the address derives; the profile lookup below
    // replaces it with the real one (and the image) when there is one.
    const ownerName = displayNameFromEmail(ownerEmail);
    const authorAvatar = createAvatar({
      seed: ownerId || ownerEmail,
      name: ownerName,
      size: 'xs',
      className: 'topbar-author-avatar',
    });

    const authorNameEl = h('span', {
      class: 'topbar-author-name',
      text: ownerName.split(' ')[0], // First name only initially
    });

    authorDisplayEl.append(authorAvatar, authorNameEl);

    // Fetch profile and update
    getUserProfileAsync(ownerId)
      .then((profile) => {
        // Pass the resolved name along, not just the image: the initials were
        // derived from the address ("dev@local.test" → "DE"), so without this the
        // chip keeps showing e-mail initials next to the profile's real name.
        if (profile?.imageUrl || profile?.name) {
          updateAvatar(authorAvatar, {
            ...(profile.imageUrl ? { imageUrl: profile.imageUrl } : {}),
            ...(profile.name ? { name: profile.name } : {}),
          });
        }
        if (profile?.name) {
          const firstName = profile.name.split(' ')[0];
          authorNameEl.textContent = firstName;
        }
      })
      .catch(() => {
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
    h('span', { class: 'topbar-pres-title-text', text: pres.title }),
    icon('pencil', { size: 12, className: 'topbar-title-pencil' }),
  );

  // ============================================================
  // SAVE STATUS CHIP
  // ============================================================
  // Persistent indicator of whether the current work is saved. Driven by the
  // save manager via setSaveStatus(); the text differs per state so the cue
  // does not rely on colour alone.

  const saveStatusEl = h('span', {
    class: 'topbar-save-status topbar-fold-lg',
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
    root,
    pres,
    id,
    api,
    requestSave,
    isDirty,
    markDirty,
    normalizeLang,
    getSelectedSlideId,
    setSelectedSlideId,
    editorState,
    topbarTitleEl,
    toast,
    collabLanguage,
  });

  // ============================================================
  // SETTINGS BUTTON
  // ============================================================

  const openSettings = () =>
    openSettingsModalImpl({
      root,
      pres,
      api,
      markDirty,
      requestSave,
    });

  // ============================================================
  // DECK OVERVIEW (LIGHT TABLE) BUTTON
  // ============================================================

  const btnOverview = h('button', {
    class: 'ghost-icon-btn topbar-overview-btn topbar-fold-lg',
    type: 'button',
    title: t('editor.deckGrid.open', 'Slide overview'),
    'aria-label': t('editor.deckGrid.open', 'Slide overview'),
    onclick: () => onOpenOverview?.(),
  });
  btnOverview.append(icon('layout-grid', { size: 16 }));

  // ============================================================
  // THEME TOGGLE
  // ============================================================

  const toggleTheme = () => {
    const current = getUiModePreference();
    const next =
      current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
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
        toast.error(e);
      });
  };

  // ============================================================
  // USER MENU
  // ============================================================

  const userMenu = createUserMenu({
    user,
    onLogout: () => logout(),
  });
  detachers.push(userMenu.detach);

  // ============================================================
  // NOTIFICATION BELL
  // ============================================================

  const notificationBell = createNotificationBell({
    api,
  });
  detachers.push(notificationBell.detach);

  // ============================================================
  // MORE MENU
  // ============================================================

  const moreMenu = createEditorTopbarMoreMenu({
    root,
    toast,
    api,
    pres,
    id,
    requestSave,
    isDirty,
    onError,
    onTranslateOther: languageMode.translateOtherLanguage,
    canTranslate: languageMode.canTranslate,
    onVersions: () =>
      openVersionsModalImpl({
        api,
        root,
        pres,
        id,
        requestSave,
        isDirty,
        theme,
      }),
    onLogout: () => logout(),
    onToggleTheme: toggleTheme,
    // Stand-ins for the Export and Share buttons at the widths where the bar
    // folds them away. Same openers, so there is one action per concept.
    onExport,
    onShare,
    // Demoted from their own topbar icons (2026-07-16 chrome re-org): the
    // bar keeps deck-level actions; utilities live here.
    onAnalyze,
    onOpenAnalytics: () => nav(`/analytics/${id}`),
    onShowShortcuts: () => onShowShortcuts?.(),
    onOpenSettings: () => openSettings(),
    onSubscription: () =>
      openSubscriptionModal({ api, toast, presentationId: id }),
    onOpenOverview: () => onOpenOverview?.(),
    onOpenCompanion: () => openNotesQr(),
  });
  detachers.push(moreMenu.detach);

  // ============================================================
  // ANALYTICS BUTTON
  // ============================================================

  const btnAnalytics = h('button', {
    class: 'ghost-icon-btn topbar-analytics-btn topbar-fold-lg',
    type: 'button',
    title: t('editor.analytics', 'Analytics'),
    'aria-label': t('editor.analytics', 'Analytics'),
    onclick: () => nav(`/analytics/${id}`),
  });
  btnAnalytics.append(icon('chart-column', { size: 16 }));

  /**
   * Analytics is a control with two conditions, not one: the fold ladder says
   * *where* it lives (bar above 1024px, ⋯ menu below), and this says whether
   * it exists at all — analytics only counts external viewers, so a deck with
   * neither a publication nor a share link has nothing to show.
   *
   * Both halves go through here, which is what makes the ladder's invariant
   * hold for this control too: one home at any width, never both, never
   * neither (B354 round 2). An inline `display: none` outranks the fold rule,
   * and clearing it hands the decision back to CSS.
   *
   * @param {boolean} available
   * @returns {void}
   */
  const setAnalyticsAvailable = (available) => {
    btnAnalytics.style.display = available ? '' : 'none';
    moreMenu.setAnalyticsAvailable(available);
  };

  const isPublished = !!pres?.published?.id;
  if (isPublished) {
    setAnalyticsAvailable(true);
  } else {
    // Not published: the deck may still have an audience through a share link.
    setAnalyticsAvailable(false);
    api(`/api/presentations/${id}/share-links`)
      .then((resp) => {
        setAnalyticsAvailable(
          Array.isArray(resp?.shareLinks) && resp.shareLinks.length > 0,
        );
      })
      .catch(() => {
        // On error, keep hidden
      });
  }

  // ============================================================
  // PRESENT BUTTON
  // ============================================================

  // No `title`: the button carries its own word below, and a tooltip that
  // repeats the visible label is noise on a desktop. Where the label is hidden
  // (≤480px, a touch device) a tooltip never appears anyway. The name is the
  // `aria-label`, the same word as the label, so it survives the label's
  // `display: none` there (B361).
  const btnPresent = h('button', {
    class: 'btn btn-primary',
    'aria-label': t('editor.present', 'Present'),
    onclick: async () => {
      if (isDirty?.()) {
        toast.info(t('common.savingFirst', 'Saving first…'), {
          id: 'editor-present',
          durationMs: 5200,
        });
        await requestSave?.();
        if (isDirty?.()) {
          toast.error(
            t(
              'editor.present.abortedSaveFailed',
              'Could not save; presenting aborted.',
            ),
            {
              id: 'editor-present',
            },
          );
          return;
        }
      }

      const sid = getSelectedSlideId?.();
      const idx = (pres.slides || []).findIndex((s) => s.id === sid);
      const slideId = idx >= 0 ? pres.slides[idx].id : null;
      const u = new URL(`/present/${id}`, location.origin);
      if (slideId) u.searchParams.set('slideId', slideId);
      const deckLang = normalizeLang(pres?.i18n?.active);
      if (deckLang) u.searchParams.set('lang', deckLang);
      window.open(u.pathname + u.search, '_blank', 'noopener,noreferrer');

      try {
        syncShareUi?.();
      } catch {
        // ignore
      }
    },
  });
  // Icon plus label, so the primary CTA can shed its word on a phone without
  // shedding the action (B354). Below the xs rung the label is gone; the
  // button's `aria-label` above keeps its name.
  btnPresent.append(
    icon('play', { size: 16, className: 'topbar-present-icon' }),
    h('span', {
      class: 'topbar-present-label',
      text: t('editor.present', 'Present'),
    }),
  );

  // Present is the primary CTA; the attached caret menu holds the live-
  // presenting extras you never need while editing (Companion phone remote).
  // The caret is the one part of the group on the ladder: Present never
  // leaves the bar, its extras do.
  const presentCompanionItem = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.companion', 'Companion'),
    title: t(
      'editor.companion.title',
      'Open speaker notes companion on your phone (QR code).',
    ),
    onclick: () => {
      closePresentMenu();
      openNotesQr();
    },
  });
  const {
    details: presentMenuDetails,
    close: closePresentMenu,
    detach: detachPresentMenu,
  } = createDropdown({
    triggerClass: 'btn btn-primary btn-icon topbar-present-caret',
    triggerContent: [icon('chevron-down', { size: 14 })],
    title: t('editor.present.more', 'More presenting options'),
    ariaLabel: t('editor.present.more', 'More presenting options'),
    // Folds at sm into the ⋯ Companion entry; see Topbar Responsive.
    detailsClass: 'topbar-present-more topbar-fold-sm',
    menuClass: 'dropdown-menu-right',
    items: [presentCompanionItem],
  });
  detachers.push(detachPresentMenu);
  const presentGroup = h('div', { class: 'topbar-present-group' }, [
    btnPresent,
    presentMenuDetails,
  ]);

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
  btnUndo.append(icon('undo', { size: 16 }));

  const btnRedo = h('button', {
    class: 'ghost-icon-btn topbar-redo-btn',
    type: 'button',
    'aria-label': t('editor.redo', 'Redo'),
    title: `${t('editor.redo', 'Redo')} (⇧⌘Z)`,
    disabled: true,
    onclick: () => onRedo?.(),
  });
  btnRedo.append(icon('redo', { size: 16 }));

  const undoRedoGroup = h(
    'div',
    { class: 'topbar-undo-group topbar-fold-lg' },
    [btnUndo, btnRedo],
  );

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
  //   1. identity/navigation: back, title, save status, author; the collab
  //      avatar stack sits right of the spacer, against zone 2
  //   2. edit session: undo/redo, language
  //   3. deliver: overview/analytics/more as quiet ghosts, then Export,
  //      Share and the Present CTA - with the user avatar in the corner,
  //      its natural place, separated as the one global (non-deck) element.
  const backBtn = h('button', {
    class: 'ghost-icon-btn topbar-back-btn',
    'aria-label': t('common.back', 'Back'),
    title: t('common.back', 'Back'),
    onclick: () => nav('/app'),
  });
  backBtn.append(icon('arrow-left', { size: 16 }));

  // The fold rung of a control the bar does not build itself. The rung belongs
  // to the bar's width budget, not to the button, so it is stamped here next
  // to the layout it serves - the ladder is documented in
  // `styles/base/01-core/10-shell-topbar-dropdown.css` (Topbar Responsive).
  // The collab avatar stack's place in the bar. The bar builds it rather than
  // the presence module, so it is a child of the bar and sits on the ladder
  // like every other one: five avatars and a +N chip spend 124px, which the
  // phone floor cannot carry, so it folds at sm into the ⋯ entry that names
  // the same peers. Hidden inline until presence reports a peer - an inline
  // `display: none` beats the fold rule, so a deck nobody else has open
  // spends no width at any width. Empty and hidden where collab is off.
  const presenceSlot = h('div', {
    class: 'topbar-presence topbar-fold-sm',
    role: 'group',
    'aria-label': t('editor.presence.here', 'Also here'),
  });
  presenceSlot.style.display = 'none';

  /**
   * Show or hide both halves of the presence stack in one go - the bar slot
   * and its ⋯ entry - so a peer cannot be named in one half and absent from
   * the other. The avatars themselves are the presence module's to draw.
   *
   * @param {string[]} names - display names of the other people in the deck
   * @returns {void}
   */
  const setPresenceNames = (names) => {
    presenceSlot.style.display = names.length ? '' : 'none';
    moreMenu.setPresenceNames(names);
  };

  topbarExportEl?.classList?.add('topbar-fold-lg');
  topbarShareEl?.classList?.add('topbar-fold-md');
  userMenu.el.classList.add('topbar-fold-sm');

  const topbarEl = h('div', { class: 'topbar' }, [
    backBtn,
    topbarTitleEl,
    saveStatusEl,
    authorDisplayEl,
    h('div', { class: 'topbar-spacer' }),
    presenceSlot,
    undoRedoGroup,
    languageMode.el,
    h('div', {
      class: 'topbar-zone-sep topbar-fold-sm',
      'aria-hidden': 'true',
    }),
    btnOverview,
    btnAnalytics,
    moreMenu.el,
    topbarExportEl,
    topbarShareEl,
    presentGroup,
    h('div', {
      class: 'topbar-zone-sep topbar-fold-sm',
      'aria-hidden': 'true',
    }),
    notificationBell.el,
    userMenu.el,
  ]);

  detachers.push(languageMode.detach);

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

  return {
    topbarEl,
    topbarTitleEl,
    presenceSlot,
    setPresenceNames,
    setSaveStatus,
    syncLangUi: languageMode.syncLangUi,
    syncUndoButtons,
    openNotesQr,
    detach,
  };
}
