/**
 * Editor Controller
 * Main orchestrator for the presentation editor
 *
 * This file coordinates between multiple subsystems:
 * - Topbar (navigation, actions, presence)
 * - Slides panel (slide list, bulk actions)
 * - Editor form (content editing)
 * - Preview panel (slide preview, notes, comments)
 * - Save manager (autosave, dirty state)
 * - Comments panel (discussion, AI analysis)
 */

import { api } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { h } from '../../lib/dom.js';
import { attachThumbScale, attachThumbScaleContain } from '../../lib/thumb-scale.js';
import {
  cleanupSlideRuntimes,
  mountSlideInto,
  renderSlideElement,
} from '../../lib/slide-render.js';
import { lockDocumentScroll } from './editor-utils.js';
import { openAiAppendWizard as openAiAppendWizardModal } from './ai-append.js';
import {
  openImageLibraryPicker,
  readFileAsDataUrl,
} from './image-library-picker.js';
import { openImageKitPicker } from './imagekit-picker.js';
import { createImagePickerSeam } from './media/picker-provider.js';
import { createFieldRenderers } from './fields.js';
import { setupSlideList } from './slide-list.js';
import { createRerenderEditor } from './editor-form.js';
import { createBulkEditModal } from './bulk-edit-modal.js';
import { createNotesStrip } from './notes-strip.js';
import { createPreviewPanel } from './preview-panel.js';
import { createInspectorResize } from './inspector-resize.js';
import { createInspectorPanes } from './inspector-panes.js';
import { createInlineEditor } from './inline-edit/inline-editor.js';
import {
  canConvertSlideTo,
  convertSlideWithConfirm,
} from './convert-slide-action.js';
import { createEditorTopbar } from './topbar.js';
import { createPaneTabs } from './pane-tabs.js';
import { createSlidesPanel } from './slides-panel.js';
import { createSaveManager } from './save-manager.js';
import { openTitleModal as openTitleModalImpl } from './modals/title-modal.js';
import { setDocumentTitle } from '../../lib/branding.js';
import { openTranslateSlideModal as openTranslateSlideModalImpl } from './modals/translate-slide-modal.js';
import { openTranslateFieldModal as openTranslateFieldModalImpl } from './modals/translate-field-modal.js';
import { openConflictModal as openConflictModalImpl } from './modals/conflict-modal.js';
import { openRemoteMergeModal } from './modals/remote-merge-modal.js';
import { openAnalyzeModal as openAnalyzeModalImpl } from './modals/analyze-modal.js';
import { openDeckOverviewModal } from './modals/deck-overview-modal.js';
import { openAiDeckReviewModal } from './modals/ai-deck-review-modal.js';
import { normalizeLang, otherLang } from '../../lib/i18n.js';
import { t } from '../../lib/ui-i18n.js';
import { iconUrl } from '../../../shared/icon-names.js';
import {
  createNotesSessionEnsurer,
  createSlidesCollapsedPreference,
  createCollapsedClassPreference,
} from './bootstrap.js';
import { loadEditorModel } from './load-editor-model.js';
import { attachEditorLifecycle } from './editor-lifecycle.js';
import { getFeatures } from '../../lib/features.js';
import { attachPresentationPresenceLock } from './presence-lock.js';
import { createSlideLockManager } from './slide-lock-manager.js';
import { syncSlideIdInUrl } from './slide-url.js';
import { createCommentsPanel } from './comments-panel.js';
import { createCommentsApi } from './comments-api.js';
import { createEditorTitleController } from './title-controller.js';
import { attachEditorFindShortcut } from './find-shortcut.js';
import { attachEditorShortcutsHelp } from './shortcuts.js';
import { translatableKeysForType } from './translatable.js';
import { focusSearchHitInEditor } from './search-focus.js';
import { createOverlayRegistry } from './overlays.js';
import { createResponsiveDrawers } from './responsive-drawers.js';
import { createEditorStateUpdater } from '../../lib/editor-state.js';
import { createEditorDropdowns } from './editor-dropdowns.js';
import { createEditorCleanupRegistry } from './editor-cleanup.js';
import { isPresentationAuthor, isSlideLockedForUser } from '../../lib/slide-lock-authz.js';
import { createUndoManager } from '../../lib/undo-manager.js';
import { createUndoActions } from './slide-list/undo-actions.js';
import { createSlideUpdateHandler } from './slide-update-handler.js';
import { createRemoteRefresh } from './remote-refresh.js';

export async function createEditorController({
  root,
  id,
  nav,
  user,
  initialPres = null,
} = {}) {
  if (!root) throw new Error('createEditorController: root is required');
  if (!id) throw new Error('createEditorController: id is required');

  const features = getFeatures() || {};
  const cleanup = createEditorCleanupRegistry();

  // Live collaborative editing (ADR 001 fase 2, stap 3). When on, the shared
  // Y.Doc is the write target: markDirty routes into the live-edits binder,
  // undo/redo switch to Y.UndoManager, autosave/If-Match stay inert (the
  // saveManager never sees a dirty state), the SSE slide-update handler is
  // not attached (changes arrive through the doc) and slide locks are not
  // acquired (CRDT merging replaces edit exclusivity; presence shows who is
  // where). With the flag off, every one of those paths is untouched.
  const liveEditsActive = !!(features.collab && features.collabLiveEdits && user?.email);
  let liveEdits = null; // handle from ./live-edits/index.js (dynamic import)
  let liveEditsHadEarlyEdits = false;

  // ============================================================
  // UI PREFERENCES
  // ============================================================

  const slidesCollapsedPref = createSlidesCollapsedPreference({
    storageKey: 'ps:slides-collapsed',
  });
  slidesCollapsedPref.loadInitial();

  // Collapsible inspector rail:
  // dismissing it gives the slide canvas the extra width. Every path that
  // flips this goes through setInspectorCollapsed below so the topbar toggle
  // stays in sync.
  const inspectorCollapsedPref = createCollapsedClassPreference({
    storageKey: 'ps:inspector-collapsed',
    className: 'is-inspector-collapsed',
  });
  inspectorCollapsedPref.loadInitial();

  const isInspectorCollapsed = () =>
    document.documentElement.classList.contains('is-inspector-collapsed');

  // Late-bound: reassigned once topbar, panes and comments panel all exist.
  // Reflects the rail state everywhere it is mirrored: the per-pane topbar
  // toggles (pressed = rail open on MY pane) and the comments panel's
  // visible/seen state.
  let syncRailState = () => {};
  const setInspectorCollapsed = (v) => {
    inspectorCollapsedPref.set(v);
    syncRailState();
  };

  // ============================================================
  // LOAD MODEL
  // ============================================================

  const [editorModel, orgSettingsData] = await Promise.all([
    loadEditorModel({ id, api, initialPres }),
    api('/api/settings/organization').catch(() => ({})),
  ]);

  const {
    startUrl,
    pres,
    theme,
    SLIDE_TYPES,
    PARTNER_LOGOS,
    BACKGROUNDS,
    newTitleKey,
  } = editorModel;

  const orgSettings = orgSettingsData?.settings || {};
  const disabledSlideTypes = Array.isArray(orgSettings.disabledSlideTypes)
    ? orgSettings.disabledSlideTypes
    : [];

  // Make presentation ID globally available for lead capture forms (preview mode)
  window.__PRESENTATION_ID__ = id;

  // ============================================================
  // EDITOR STATE
  // ============================================================

  const initialSlideId =
    startUrl?.searchParams?.get?.('slideId') ||
    startUrl?.searchParams?.get?.('s') ||
    '';
  const shouldScrollSelectionOnLoad = !!initialSlideId;

  let selectedSlideId = pres.slides?.[0]?.id || null;
  if (initialSlideId && Array.isArray(pres?.slides)) {
    const exists = pres.slides.some((s) => s?.id === initialSlideId);
    if (exists) selectedSlideId = initialSlideId;
  }

  let selectedSlideIds = new Set();
  // Selection-aware inspector: the canvas element ({kind:'image'|'card', idx})
  // whose settings the inspector's element tab shows, or null for slide-only.
  // Cleared on slide change; set by canvas interactions via setSelectedElement.
  let selectedElement = null;
  let uiRefreshTimer = null;
  let commentsPanel = null;
  let setCommentsBadgeFn = () => {};
  let setLockStateCallbackFn = () => {};
  let slideCommentCounts = {};

  // ============================================================
  // AUTHOR HELPERS
  // ============================================================

  // Check if current user is the author (owner/creator/admin)
  const isAuthor = () => isPresentationAuthor(user, pres);

  // Check if a slide is author-locked for the current user
  const isSlideAuthorLockedForUser = (slideId) => {
    const slide = pres.slides?.find((s) => s.id === slideId);
    return slide ? isSlideLockedForUser(slide, user, pres) : false;
  };

  // ============================================================
  // SLIDE LOCK MANAGER (for concurrent editing)
  // ============================================================

  const slideLockManager = createSlideLockManager({
    api,
    presentationId: id,
    getSelectedSlideId: () => selectedSlideId,
    onLocksChanged: ({ currentSlideIsLocked } = {}) => {
      // Rerender slide list to update lock indicators
      try {
        rerenderSlideList?.();
      } catch {
        // ignore
      }
      // Check for author lock on current slide (in addition to concurrent lock)
      const authorLocked = isSlideAuthorLockedForUser(selectedSlideId);
      const isLocked = !!currentSlideIsLocked || authorLocked;
      // Toggle slide-locked class on shell to disable editing of locked slides
      try {
        shell?.classList?.toggle?.('is-slide-locked', isLocked);
        shell?.classList?.toggle?.('is-author-locked-slide', authorLocked);
        if (currentSlideIsLocked) {
          const bannerText = t('editor.slideLocked.banner', 'This slide is being edited by someone else');
          shell?.style?.setProperty?.('--slide-locked-banner-text', `"${bannerText}"`);
        } else if (authorLocked) {
          const bannerText = t('editor.authorLocked.banner', 'This slide is locked by the author');
          shell?.style?.setProperty?.('--slide-locked-banner-text', `"${bannerText}"`);
        }
      } catch {
        // ignore
      }
    },
    onLockFailed: ({ slideId, lock }) => {
      const name = lock?.holderName || lock?.holderEmail || 'another user';
      toast?.warn?.(t('editor.slideLocked.toast', 'This slide is being edited by {name}', { name }));
    },
  });

  // Single state-driven lock seam for every editing surface (bulk-edit
  // modal, inline editor, future inspector panes). Body-mounted overlays
  // escape the shell-scoped locked-slide CSS, so gating must come from
  // state, not stylesheets. The server enforces the same rules (423).
  const getSlideLockKind = (slideId) => {
    if (isSlideAuthorLockedForUser(slideId)) return 'author';
    if (!liveEditsActive && slideLockManager.isLockedByOther?.(slideId)) return 'other';
    return null;
  };

  // State mirror of the shell's is-read-only class (presentation-level lock
  // by another user); surfaces read this instead of the classList.
  let readOnlyMode = false;

  // Store user email for SSE event filtering
  if (user?.email) {
    window.__currentUserEmail = user.email;
  }

  // Collaborator presence (initialized further down when features.collab)
  let presenceHandle = null;

  // Wrapper for setSelectedSlideId that also acquires slide lock.
  // Single seam for slide selection: slide list, comments jump, undo/redo,
  // lightbox, overview grid and collab-driven reselection all pass through
  // here, so this is also where the URL learns about the selection.
  const setSelectedSlideIdWithLock = (v) => {
    selectedSlideId = v;
    // A different slide means a different element context; drop any selection
    // so the new slide opens on its slide-only inspector (no stale element tab).
    selectedElement = null;
    syncSlideIdInUrl(v);
    presenceHandle?.setViewSlide?.(v);
    // Check for author lock on the newly selected slide
    const authorLocked = isSlideAuthorLockedForUser(v);
    try {
      shell?.classList?.toggle?.('is-author-locked-slide', authorLocked);
      shell?.classList?.toggle?.('is-slide-locked', authorLocked);
      if (authorLocked) {
        const bannerText = t('editor.authorLocked.banner', 'This slide is locked by the author');
        shell?.style?.setProperty?.('--slide-locked-banner-text', `"${bannerText}"`);
      }
    } catch { /* ignore */ }
    // Acquire lock on the newly selected slide (not in live-edit mode:
    // concurrent editing is the point, presence covers awareness)
    if (!liveEditsActive) slideLockManager.onSlideSelected(v).catch(() => {});
    // A slide-scoped comments pane follows the selection.
    commentsPanel?.onSlideChanged?.();
  };

  const { openOverlayClosers, closeAll: closeAllOverlays } = createOverlayRegistry();
  let conflictModalShown = false;

  // ============================================================
  // SAVE MANAGER
  // ============================================================

  // Bridges save-state transitions to the topbar chip. Reassigned once the
  // topbar exists (created later in this controller); a no-op until then.
  let setSaveStatus = () => {};

  const saveManager = createSaveManager({
    api,
    toast,
    pres,
    id,
    SLIDE_TYPES,
    normalizeLang,
    otherLang,
    onStatusChange: (status) => setSaveStatus(status),
    getSelectedSlideId: () => selectedSlideId,
    onConflict: (err) => {
      if (conflictModalShown) return;
      conflictModalShown = true;
      openConflictModalImpl({
        h,
        root,
        pres,
        conflictDetails: err?.details || null,
        openOverlayClosers,
      });
    },
    onRemoteMerge: ({ changedSlideIds } = {}) => {
      // The server merged our save with another editor's changes and we
      // adopted their slides locally — reflect that in the UI.
      try { rerenderSlideList(); } catch { /* ignore */ }
      try { rerenderPreview(); } catch { /* ignore */ }
      if (Array.isArray(changedSlideIds) && changedSlideIds.includes(selectedSlideId)) {
        try { rerenderEditor(); } catch { /* ignore */ }
      }
      if (changedSlideIds?.length) {
        const mergedIds = [...changedSlideIds];
        toast.info(
          t('editor.save.remoteMerged', 'Changes from another editor were merged in'),
          {
            id: 'remote-update',
            durationMs: 8000,
            action: {
              label: t('editor.save.remoteMergedSee', 'See what changed'),
              onClick: () =>
                openRemoteMergeModal({
                  h,
                  root,
                  slides: pres.slides,
                  changedSlideIds: mergedIds,
                  onJumpToSlide: (sid) => {
                    setSelectedSlideIdWithLock(sid);
                    try { rerenderSlideList(); } catch { /* ignore */ }
                    try { rerenderEditor(); } catch { /* ignore */ }
                    try { rerenderPreview(); } catch { /* ignore */ }
                  },
                  openOverlayClosers,
                }),
            },
          }
        );
      }
    },
  });

  const { markDirty: rawMarkDirty, requestSave, updatePills } = saveManager;

  // ============================================================
  // UNDO MANAGER
  // ============================================================

  // Late-bound so the undo manager (created now) can notify the topbar buttons
  // (created later) whenever the undo/redo stacks change.
  let syncTopbarUndo = () => {};
  const notifyUndoChange = () => {
    try {
      syncTopbarUndo();
    } catch {
      // ignore
    }
  };

  const undoManager = createUndoManager({
    maxDepth: 50,
    debounceMs: 400,
    onChange: notifyUndoChange,
  });

  // Initialize undo manager with the current presentation state
  // This establishes the "before" state for the first edit sequence
  undoManager.init(pres);

  /**
   * Wrap markDirty to capture undo snapshots.
   * The undo manager tracks edit sequences and captures the state
   * BEFORE each new sequence starts (not after each individual edit).
   */
  const markDirty = (opts = {}) => {
    if (liveEditsActive) {
      // Live-edit mode: the mutation is already in pres; push it into the
      // shared doc. No snapshot undo (Y.UndoManager) and no autosave (the
      // server persists the doc), so the saveManager stays untouched/clean.
      if (liveEdits) liveEdits.localEdit(opts);
      else liveEditsHadEarlyEdits = true;
      return undefined;
    }
    // Notify undo manager of the change (it tracks sequences internally)
    undoManager.captureSnapshot(pres, {
      slideId: opts?.slideId || selectedSlideId,
      action: opts?.action || 'edit',
    });
    return rawMarkDirty(opts);
  };

  // ============================================================
  // NOTES SESSION
  // ============================================================

  const notesSession = createNotesSessionEnsurer({
    api,
    presentationId: id,
  });

  // ============================================================
  // SHELL & TITLE CONTROLLER
  // ============================================================

  const shell = h('div', { class: 'app-shell editor-shell' });
  let topbarTitle = null;

  setDocumentTitle(pres?.title);
  const titleCtl = createEditorTitleController({
    pres,
    markDirty,
    requestSave,
    onTitleChanged: (next) => {
      if (!topbarTitle) return;
      topbarTitle.textContent = next;
      topbarTitle.title = next;
      setDocumentTitle(next);
    },
  });

  const openTitleModal = ({ mode = 'edit' } = {}) =>
    openTitleModalImpl({
      h,
      root,
      pres,
      setTitle: titleCtl.setTitle,
      openOverlayClosers,
      newTitleKey,
      mode,
    });

  // ============================================================
  // RERENDER PLACEHOLDERS
  // ============================================================

  let rerenderSlideList = () => {};
  let rerenderEditor = () => {};
  let rerenderPreview = () => {};
  let updateSelectedSlideListItem = () => {};
  let lastNotesSlideId = null;

  const scheduleUiRefresh = () => {
    if (uiRefreshTimer) clearTimeout(uiRefreshTimer);
    uiRefreshTimer = setTimeout(() => {
      uiRefreshTimer = null;
      updateSelectedSlideListItem?.();
      rerenderPreview();
    }, 120);
  };

  const translatableKeysForSlideType = (type) =>
    translatableKeysForType({ SLIDE_TYPES, type });

  // Consolidated state updater
  const editorState = createEditorStateUpdater({
    markDirty,
    rerenderSlideList: () => rerenderSlideList(),
    rerenderEditor: () => rerenderEditor(),
    rerenderPreview: () => rerenderPreview(),
    updateSelectedSlideListItem: () => updateSelectedSlideListItem?.(),
  });

  // Shared undo/redo actions — drive both the keyboard shortcuts and the
  // topbar buttons from one implementation. In live-edit mode they delegate
  // to the binder's Y.UndoManager (own edits only) instead.
  const { performUndo: performSnapshotUndo, performRedo: performSnapshotRedo } =
    createUndoActions({
      pres,
      undoManager,
      getSelectedSlideId: () => selectedSlideId,
      setSelectedSlideId: setSelectedSlideIdWithLock,
      markDirty,
      editorState,
    });
  const performUndo = liveEditsActive ? () => !!liveEdits?.undo() : performSnapshotUndo;
  const performRedo = liveEditsActive ? () => !!liveEdits?.redo() : performSnapshotRedo;
  const canUndo = liveEditsActive
    ? () => !!liveEdits?.canUndo()
    : () => undoManager.canUndo();
  const canRedo = liveEditsActive
    ? () => !!liveEdits?.canRedo()
    : () => undoManager.canRedo();

  // ============================================================
  // DROPDOWNS (SHARE + EXPORT)
  // ============================================================

  const dropdowns = createEditorDropdowns({
    h,
    api,
    toast,
    root,
    pres,
    id,
    saveManager,
    openOverlayClosers,
    editorState,
    user,
  });
  cleanup.register('dropdowns', dropdowns.detach);

  // ============================================================
  // DECK OVERVIEW (LIGHT TABLE)
  // ============================================================

  // Jump used by the overview grid, the AI deck review, and (already) the
  // comments panel. slideListEl is referenced lazily (defined further down,
  // before any click can happen).
  const jumpToSlide = (slideId) => {
    if (!slideId || !pres.slides?.some((s) => s?.id === slideId)) return;
    setSelectedSlideIdWithLock(slideId);
    rerenderSlideList();
    rerenderEditor();
    rerenderPreview();
    requestAnimationFrame(() => {
      try {
        const active = slideListEl?.querySelector?.('.list-item.is-active');
        active?.scrollIntoView?.({ block: 'nearest' });
      } catch { /* ignore */ }
    });
  };

  // Shared by the topbar button and the "Review" affordance on the AI-added
  // toast.
  const openDeckOverview = () => {
    openDeckOverviewModal({
      h,
      root,
      pres,
      theme,
      SLIDE_TYPES,
      openOverlayClosers,
      onJumpToSlide: jumpToSlide,
    });
  };

  // Whole-deck AI review (per-slide rationale + section refine). Opened
  // automatically after AI generation (?aiReview=1).
  const openAiDeckReview = ({ postGeneration = false } = {}) => {
    openAiDeckReviewModal({
      h,
      root,
      api,
      pres,
      theme,
      SLIDE_TYPES,
      openOverlayClosers,
      editorState,
      onJumpToSlide: jumpToSlide,
      postGeneration,
      nav,
    });
  };

  // ============================================================
  // TOPBAR
  // ============================================================

  const topbarApi = createEditorTopbar({
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
    isDirty: saveManager.isDirty,
    getSelectedSlideId: () => selectedSlideId,
    setSelectedSlideId: setSelectedSlideIdWithLock,
    editorState,
    openTitleModal,
    ensureNotesSession: notesSession.ensureNotesSession,
    getNotesSessionId: notesSession.getNotesSessionId,
    onError: (e) => saveManager.setLastError(e),
    onUndo: performUndo,
    onRedo: performRedo,
    canUndo,
    canRedo,
    // Live-edit mode: language switching + translate flows go through the
    // live doc (null/undefined handles fall back to the server fetch).
    collabLanguage: liveEditsActive
      ? {
          loadLanguageVersion: (lang) => liveEdits?.projectLanguage(lang) || null,
        }
      : null,
    // Defined later in this controller; the button is only clickable afterwards.
    onShowShortcuts: () => shortcutsHelp.open(),
    normalizeLang,
    otherLang,
    topbarExportEl: dropdowns.topbarExport,
    topbarShareEl: dropdowns.topbarShare,
    syncShareUi: dropdowns.syncShareUi,
    openOverlayClosers,
    markDirty,
    setPresenceText: (setter) => {
      // Live-edit mode: no lock plumbing at all. CRDT merging replaces edit
      // exclusivity and the presence layer (avatar stack, slide dots) covers
      // awareness, so the presence-lock module is never attached — the
      // topbar lock-request UI stays dormant (its buttons only appear when
      // a lock-state callback fires) and no fake holder state is reported.
      if (liveEditsActive) return;
      const detachPresenceLock = attachPresentationPresenceLock({
        api,
        id,
        onPresenceText: (t) => setter?.(t),
        onLockStateChange: (state, actions) => {
          setLockStateCallbackFn?.(state, actions);
        },
        // Use slide-level locking instead of presentation-level locking
        // This allows multiple users to edit different slides simultaneously
        useSlideLevelLocking: true,
      });
      cleanup.register('presenceLock', detachPresenceLock);
    },
    setLockStateCallback: (fn) => { setLockStateCallbackFn = fn; },
    onOpenOverview: openDeckOverview,
    onAnalyze: () => {
      openAnalyzeModalImpl({
        h,
        root,
        api,
        toast,
        pres,
        id,
        openOverlayClosers,
        onComplete: ({ suggestionCount } = {}) => {
          if (suggestionCount > 0) {
            // AI suggestions can land on any slide: widen the pane to the
            // deck scope, then open the rail on it (syncRailState shows the
            // panel, which loads the fresh suggestions).
            commentsPanel?.setScope?.('all');
            inspectorPanes.open('comments');
          }
        },
      });
    },
    onReadOnlyChange: (() => {
      let wasReadOnly = false;
      return (isReadOnly, lockInfo) => {
        readOnlyMode = !!isReadOnly;
        shell.classList.toggle('is-read-only', isReadOnly);
        if (isReadOnly) {
          const bannerText = t('editor.readOnly.banner', 'View only - someone else is editing');
          shell.style.setProperty('--read-only-banner-text', `"${bannerText}"`);
        }
        if (isReadOnly && !wasReadOnly && lockInfo) {
          const who = lockInfo.holderName || lockInfo.holderEmail || t('editor.readOnly.someone', 'someone else');
          toast.info(
            t('editor.readOnly.toast', 'This presentation is being edited by {who}. You can view but not edit.', { who }),
            { id: 'editor-read-only', durationMs: 6000 }
          );
        }
        wasReadOnly = isReadOnly;
      };
    })(),
  });

  topbarTitle = topbarApi.topbarTitleEl;
  cleanup.register('topbar', topbarApi.detach);
  shell.append(topbarApi.topbarEl);

  // Now that the topbar exists, route save-state transitions to its chip and
  // reflect the current state (idle for a freshly-opened deck).
  setSaveStatus = topbarApi.setSaveStatus;
  setSaveStatus(saveManager.getStatus());

  // Let the undo manager drive the topbar undo/redo button states, and set the
  // initial (disabled) state now.
  if (typeof topbarApi.syncUndoButtons === 'function') {
    syncTopbarUndo = topbarApi.syncUndoButtons;
    syncTopbarUndo();
  }

  // The real syncRailState is assigned once the comments panel exists (it
  // also drives that panel's visibility); until then the topbar buttons get
  // their initial state from that assignment further down.

  // ============================================================
  // SLIDES PANEL
  // ============================================================

  const slidesPanel = createSlidesPanel({
    h,
    root,
    pres,
    user,
    api,
    features,
    theme,
    SLIDE_TYPES,
    disabledSlideTypes,
    editorState,
    markDirty,
    rerenderSlideList: () => rerenderSlideList(),
    rerenderEditor: () => rerenderEditor(),
    rerenderPreview: () => rerenderPreview(),
    getSelectedSlideId: () => selectedSlideId,
    setSelectedSlideId: setSelectedSlideIdWithLock,
    getSelectedSlideIds: () => selectedSlideIds,
    setSelectedSlideIds: (ids) => {
      selectedSlideIds = ids instanceof Set ? ids : new Set(ids);
    },
    clearMultiSelection: () => { selectedSlideIds = new Set(); },
    openOverlayClosers,
    openAiAppendWizardModal,
    openDeckOverview,
    isSlidesCollapsed: () =>
      document.documentElement.classList.contains('is-slides-collapsed'),
    setSlidesCollapsed: (collapsed) => {
      slidesCollapsedPref.set(collapsed);
      try { rerenderSlideList(); } catch { /* ignore */ }
    },
    isAuthor,
  });

  const { leftEl: left, slideListEl, openSlideTypeModal, openSlideLibraryModal } = slidesPanel;

  // ============================================================
  // INSPECTOR PANEL (rail with swappable panes)
  // ============================================================

  const inspectorPanel = h('div', { class: 'panel inspector-panel' });

  // Pane host: settings + comments (registered further down, once the
  // comments panel exists).
  const inspectorPanes = createInspectorPanes({
    panelEl: inspectorPanel,
    setCollapsed: setInspectorCollapsed,
    isCollapsed: isInspectorCollapsed,
    onActivePaneChange: () => syncRailState(),
  });

  const editorMount = h('div', { class: 'editor-mount' });
  const inspectorScroll = h('div', { class: 'panel-scroll' });
  inspectorScroll.append(editorMount);
  const settingsPane = h('div', {}, [inspectorScroll]);
  inspectorPanes.registerPane('settings', settingsPane);

  // Presenter notes live in a collapsible strip under the slide preview
  // (Keynote / PowerPoint convention), not in the rail: notes are not
  // position-bound the way comments are, and the strip fills the otherwise
  // empty space beneath the 16:9 stage. Mounted into the preview panel below.
  const notesStrip = createNotesStrip({
    h,
    pres,
    getSelectedSlideId: () => selectedSlideId,
    markDirty,
    onOpenQr: () => topbarApi.openNotesQr?.(),
  });

  // Drag-to-resize handle on the left edge: trades inspector width for canvas width.
  const inspectorResize = createInspectorResize({
    h,
    panelEl: inspectorPanel,
    isCollapsed: isInspectorCollapsed,
  });
  inspectorPanel.append(inspectorResize.handleEl);

  // ============================================================
  // PREVIEW PANEL
  // ============================================================

  const commentsApi = createCommentsApi({ api, presentationId: id });

  // Pane tabs (Inspector / Comments / Notes) at the far right of the slide
  // toolbar, directly above the rail. The panes are slide-scoped, so the
  // tabs live in the slide row, not the deck-level topbar. Toggle semantics
  // (open on my pane = dismiss, else open/switch) live in the pane host;
  // dereferenced at click time (inspectorPanes is built above).
  const paneTabs = createPaneTabs({
    h,
    onToggleInspector: () => inspectorPanes.toggle('settings'),
    onToggleComments: () => inspectorPanes.toggle('comments'),
  });
  setCommentsBadgeFn = paneTabs.updateBadge;

  const previewPanel = createPreviewPanel({
    h,
    root,
    pres,
    theme,
    iconUrl,
    lockDocumentScroll,
    attachThumbScale,
    attachThumbScaleContain,
    renderSlideElement,
    openOverlayClosers,
    getSelectedSlideId: () => selectedSlideId,
    nav,
    commentsApi,
    user,
    // Positioned-marker click: open the rail on the comments pane and
    // highlight the thread (the under-slide list this used to expand is
    // folded into that pane).
    onOpenComments: (commentId) => {
      inspectorPanes.open('comments');
      commentsPanel?.highlightComment?.(commentId);
    },
    onLightboxNavigate: (slideId) => {
      setSelectedSlideIdWithLock(slideId);
      rerenderSlideList();
      rerenderEditor();
      rerenderPreview();
      requestAnimationFrame(() => {
        try {
          const active = slideListEl?.querySelector?.('.list-item.is-active');
          active?.scrollIntoView?.({ block: 'nearest' });
        } catch { /* ignore */ }
      });
    },
    notesStripEl: notesStrip.el,
  });

  const { previewEl: preview, thumbEl: thumb, slideBarEl: slideBar } = previewPanel;
  // Dock the pane openers (labeled) at the far right of the slide bar, above
  // the inspector column they control (Option A). They live in the slide bar,
  // not the deck-level topbar, and the bar is always present, so the rail stays
  // re-openable when it collapses.
  previewPanel.openersSlotEl?.append(paneTabs.el);
  // The notes textarea lives in the under-slide strip; every consumer
  // (live-edits binder, search focus, slide-change refresh) keeps using this
  // reference (the strip is persistent DOM, so it holds).
  const previewNotesTa = notesStrip.textarea;
  cleanup.register('thumbScale', previewPanel.detachThumbScale);

  // ============================================================
  // COLLABORATOR PRESENCE (feature-flagged: collab)
  // ============================================================

  // Dynamic import so flag-off sessions never load the yjs vendor bundle.
  // The cleanup entry is registered before the import resolves, so a fast
  // navigate-away can't leave a dangling WebSocket connection.
  if (features.collab && user?.email) {
    let presenceClosed = false;
    cleanup.register('presence', () => {
      presenceClosed = true;
      presenceHandle?.destroy?.();
      presenceHandle = null;
    });
    import('./presence/index.js')
      .then(({ initEditorPresence }) => {
        if (presenceClosed) return;
        presenceHandle = initEditorPresence({
          h,
          pres,
          user,
          topbarEl: topbarApi.topbarEl,
          listEl: slideListEl,
          thumb,
          editorMount,
          getSelectedSlideId: () => selectedSlideId,
        });
        presenceHandle.setViewSlide(selectedSlideId);

        // Live edits ride on the same provider/doc as presence.
        if (!liveEditsActive) return undefined;
        return import('./live-edits/index.js').then(({ initEditorLiveEdits }) => {
          if (presenceClosed) return;
          liveEdits = initEditorLiveEdits({
            session: presenceHandle.session,
            pres,
            normalizeLang,
            hadEarlyEdits: liveEditsHadEarlyEdits,
            getSelectedSlideId: () => selectedSlideId,
            setSelectedSlideId: setSelectedSlideIdWithLock,
            rerenderSlideList: () => rerenderSlideList(),
            rerenderEditor: () => rerenderEditor(),
            rerenderPreview: () => rerenderPreview(),
            updateSelectedSlideListItem: () => updateSelectedSlideListItem?.(),
            editorMount,
            previewNotesTa,
            setSaveStatus: (s) => setSaveStatus(s),
            onTitleChanged: (next) => {
              if (!topbarTitle) return;
              topbarTitle.textContent = next;
              topbarTitle.title = next;
              setDocumentTitle(next);
            },
            onUndoStateChanged: () => syncTopbarUndo(),
          });
          cleanup.register('liveEdits', () => {
            liveEdits?.destroy();
            liveEdits = null;
          });
        });
      })
      .catch((e) => {
        console.warn('[collab] presence unavailable:', e?.message || e);
        // In live-edit mode there is no autosave fallback: markDirty routes
        // into a binder that will now never arrive, so edits would be lost
        // silently. Make the failure loud instead.
        if (liveEditsActive) {
          setSaveStatus('error');
          toast.error(
            t(
              'editor.collab.liveEditsUnavailable',
              'Live collaboration failed to load; changes are not being saved. Reload the editor.'
            ),
            { durationMs: 15000 }
          );
        }
      });
  }

  // ============================================================
  // LAYOUT
  // ============================================================

  // Column order slides | canvas | inspector (Keynote/Figma convention).
  // Grid children (Option A): the slides column spans both rows; the slide bar
  // spans preview + inspector on row 1; preview and inspector sit on row 2.
  // Placement is by class (see 20-editor-layout.css), so DOM order here is not
  // load-bearing.
  const layout = h('div', { class: 'layout' }, [left, slideBar, preview, inspectorPanel]);
  shell.append(layout);

  // ============================================================
  // COMMENTS PANEL
  // ============================================================

  commentsPanel = createCommentsPanel({
    h,
    api,
    toast,
    presentationId: id,
    pres,
    user,
    getSelectedSlideId: () => selectedSlideId,
    onCommentCountChange: (count) => setCommentsBadgeFn?.(count),
    onSlideCommentCountsChange: (counts) => {
      slideCommentCounts = counts || {};
      try { rerenderSlideList?.(); } catch { /* ignore */ }
    },
    onJumpToSlide: (slideId) => {
      if (slideId && pres.slides?.some((s) => s?.id === slideId)) {
        // Through the wrapper so presence view + slide locks follow the jump
        // (a bare assignment left the collab view-dot on the old slide).
        setSelectedSlideIdWithLock(slideId);
        rerenderSlideList();
        rerenderEditor();
        rerenderPreview();
        requestAnimationFrame(() => {
          try {
            const active = slideListEl?.querySelector?.('.list-item.is-active');
            active?.scrollIntoView?.({ block: 'nearest' });
          } catch { /* ignore */ }
        });
      }
    },
    // The x in the pane header dismisses the rail (same as the topbar
    // toggle); plain hide() would leave an open rail with an empty pane.
    onRequestClose: () => setInspectorCollapsed(true),
  });

  // Comments mount as the second inspector pane (fase 4): the old fixed
  // right slide-over now lives inside the rail. Visibility is driven by
  // rail state below, not by the panel's own toggle.
  const commentsPane = h('div', {}, [commentsPanel.panelEl]);
  inspectorPanes.registerPane('comments', commentsPane);

  // Single mirror of the rail state: per-pane tab pressed-states and the
  // comments panel's visible/seen tracking (show() marks as seen + loads).
  syncRailState = () => {
    const open = !isInspectorCollapsed();
    const pane = inspectorPanes.getActivePane();
    paneTabs.setState({ open, pane });
    if (open && pane === 'comments') commentsPanel.show();
    else commentsPanel.hide();
  };
  syncRailState();

  root.append(shell);

  // ============================================================
  // RESPONSIVE DRAWERS
  // ============================================================

  const responsiveDrawers = createResponsiveDrawers({ h, root: shell });
  cleanup.register('responsiveDrawers', responsiveDrawers.detach);

  // ============================================================
  // KEYBOARD SHORTCUTS
  // ============================================================

  const detachFindShortcut = attachEditorFindShortcut({
    focusSearch: () => slidesPanel?.focusSearch?.(),
  });
  cleanup.register('findShortcut', detachFindShortcut);

  // `?` / Cmd+/ opens the keyboard-shortcut help overlay (also reachable via the
  // topbar help button).
  const shortcutsHelp = attachEditorShortcutsHelp();
  cleanup.register('shortcutsHelp', shortcutsHelp.detach);

  // Prompt for title if new
  titleCtl.maybePromptNewTitle({ newTitleKey, openTitleModal });

  // ============================================================
  // SLIDE LIST
  // ============================================================

  const slideListApi = setupSlideList({
    h,
    slideListEl,
    pres,
    getSelectedSlideId: () => selectedSlideId,
    setSelectedSlideId: setSelectedSlideIdWithLock,
    getSelectedSlideIds: () => selectedSlideIds,
    setSelectedSlideIds: (ids) => {
      selectedSlideIds = ids instanceof Set ? ids : new Set(ids);
    },
    clearMultiSelection: () => { selectedSlideIds = new Set(); },
    onMultiSelectionChange: () => { slidesPanel?.updateBulkActionBar?.(); },
    SLIDE_TYPES,
    renderSlideElement: (s, opts) => renderSlideElement(s, { ...(opts || {}), theme, presentationId: pres?.id }),
    editorState,
    markDirty,
    rerenderEditor: () => rerenderEditor(),
    rerenderPreview: () => rerenderPreview(),
    onRequestInsert: ({ afterSlideId, parentId } = {}) => openSlideTypeModal({ afterSlideId, parentId }),
    getSearchQuery: () => slidesPanel?.getSearchQuery?.() || '',
    onAfterSelectSlide: ({ slideId, query } = {}) => {
      focusSearchHitInEditor({
        query,
        slideId,
        pres,
        editorMount,
        previewNotesTa,
        // Both live in rail panes now: surface the right pane before focusing.
        onFocusNotes: () => inspectorPanes.open('notes'),
        onFocusField: () => inspectorPanes.open('settings'),
      });
    },
    getSlideCommentCount: (slideId) => slideCommentCounts?.[slideId] || 0,
    getSlideLockInfo: (slideId) => slideLockManager.getLockInfo(slideId),
    isSlideLockedByOther: (slideId) => slideLockManager.isLockedByOther(slideId),
    isSlideAuthorLocked: (slideId) => {
      const slide = pres.slides?.find((s) => s.id === slideId);
      return !!slide?.lockedByAuthor;
    },
    isAuthor,
    performUndo,
    performRedo,
  });

  const rawRerenderSlideList = slideListApi.rerenderSlideList;
  rerenderSlideList = () => {
    const stats = rawRerenderSlideList?.();
    try {
      slidesPanel?.setSearchStats?.(stats);
      slidesPanel?.updateBulkActionBar?.();
    } catch { /* ignore */ }
    return stats;
  };
  updateSelectedSlideListItem = slideListApi.updateSelectedSlideListItem;
  cleanup.register('slideListKeys', slideListApi.detach);

  // Initialize slide lock manager. In live-edit mode the lock machinery is
  // fully retired: the manager is never initialized (no SSE listener, no
  // refresh timer, no acquisitions — its lock getters just report "no
  // locks"), the presence-lock module above is never attached, and slide
  // selection skips acquisition. Concurrent editing through the CRDT doc is
  // the whole point; presence indicators cover awareness. Author locks
  // (lockedByAuthor) are checked directly on the slide data and keep
  // working in both modes. The flag-off path is untouched.
  if (!liveEditsActive) {
    slideLockManager.init().then((cleanupSSE) => {
      if (cleanupSSE) cleanup.register('slideLockSSE', cleanupSSE);
    }).catch(() => {});
    cleanup.register('slideLockManager', () => slideLockManager.destroy());

    // Acquire lock on initial slide
    if (selectedSlideId) {
      slideLockManager.onSlideSelected(selectedSlideId).catch(() => {});
    }
  }

  // Real-time slide update handler (syncs remote changes into local state).
  // Not attached in live-edit mode: remote changes arrive through the doc,
  // and the SSE refetch would race it with (up to a debounce window) stale
  // server JSON.
  if (!liveEditsActive) {
    const slideUpdateHandler = createSlideUpdateHandler({
      api,
      presentationId: id,
      pres,
      getSelectedSlideId: () => selectedSlideId,
      getCurrentLockedSlideId: () => slideLockManager.getCurrentLockedSlideId(),
      rerenderSlideList: () => rerenderSlideList(),
      rerenderEditor: () => rerenderEditor(),
      rerenderPreview: () => rerenderPreview(),
      saveManager,
    });
    cleanup.register('slideUpdateHandler', () => slideUpdateHandler.destroy());
  }

  // Wake-up staleness guard: a tab that slept through remote saves checks the
  // server revision on visible/focus/online (wired into the lifecycle below)
  // and refreshes or merges before the user edits stale content.
  const remoteRefresh = createRemoteRefresh({
    api,
    id,
    pres,
    saveManager,
    isEnabled: () => !liveEditsActive,
    onRefreshed: ({ changedSlideIds } = {}) => {
      let reselected = false;
      // The selected slide may be gone after adopting the server state.
      if (selectedSlideId && !pres.slides.some((s) => s?.id === selectedSlideId)) {
        setSelectedSlideIdWithLock(pres.slides[0]?.id || null);
        reselected = true;
      }
      try { rerenderSlideList(); } catch { /* ignore */ }
      try { rerenderPreview(); } catch { /* ignore */ }
      if (
        reselected ||
        (Array.isArray(changedSlideIds) && changedSlideIds.includes(selectedSlideId))
      ) {
        try { rerenderEditor(); } catch { /* ignore */ }
      }
    },
  });

  // Load initial comment counts
  commentsPanel?.loadComments?.().catch(() => {});
  commentsPanel?.startPolling?.();

  // ============================================================
  // IMAGE PICKERS
  // ============================================================

  const openImageLibrary = (opts) =>
    openImageLibraryPicker({
      ...opts,
      user,
      api,
      h,
      root,
      openOverlayClosers,
      features,
    });

  const openImageKit = (opts) =>
    openImageKitPicker({
      ...opts,
      api,
      h,
      root,
      openOverlayClosers,
    });

  // Single pluggable seam over the raw pickers above. Every image call site —
  // side-form fields AND the inline WYSIWYG popover — goes through this, so a
  // new entry point can no longer silently forget a provider (the bug that let
  // the inline popover ignore ImageKit). See media/picker-provider.js.
  const openImagePicker = createImagePickerSeam({
    h,
    root,
    features,
    openImageLibrary,
    openImageKit,
  });

  // ============================================================
  // FIELD RENDERERS
  // ============================================================

  const fieldRenderers = createFieldRenderers({
    h,
    api,
    user,
    features,
    BACKGROUNDS,
    theme,
    pres,
    normalizeLang,
    otherLang,
    openImagePicker,
    readFileAsDataUrl,
    markDirty,
    scheduleUiRefresh,
    rerenderEditor: () => rerenderEditor(),
    updateSelectedSlideListItem,
  });

  // ============================================================
  // TRANSLATE MODALS
  // ============================================================

  const openTranslateSlideModal = ({ slideId } = {}) =>
    openTranslateSlideModalImpl({
      slideId,
      h,
      api,
      id,
      pres,
      SLIDE_TYPES,
      toast,
      root,
      lockDocumentScroll,
      openOverlayClosers,
      normalizeLang,
      otherLang,
      translatableKeysForType: translatableKeysForSlideType,
      markDirty,
      rerenderEditor,
      rerenderPreview,
      requestSave,
    });

  const openTranslateFieldModal = ({ slideId, key } = {}) =>
    openTranslateFieldModalImpl({
      slideId,
      key,
      h,
      api,
      id,
      pres,
      SLIDE_TYPES,
      toast,
      root,
      lockDocumentScroll,
      openOverlayClosers,
      normalizeLang,
      otherLang,
      markDirty,
      rerenderEditor,
      rerenderPreview,
      requestSave,
    });

  // ============================================================
  // EDITOR FORM
  // ============================================================

  // Shared between the panel form and the bulk-edit modal (which runs a second
  // createRerenderEditor instance in contentOnly mode on its own mount).
  const editorFormDeps = {
    h,
    editorMount,
    pres,
    SLIDE_TYPES,
    api,
    toast,
    openSlideLibraryModal,
    getSelectedSlideId: () => selectedSlideId,
    setSelectedSlideId: setSelectedSlideIdWithLock,
    editorState,
    markDirty,
    requestSave,
    rerenderSlideList,
    rerenderPreview: () => rerenderPreview(),
    scheduleUiRefresh,
    updateSelectedSlideListItem,
    PARTNER_LOGOS,
    fieldRenderers,
    // Needed for the theme's override locks: a locked brand property hides its
    // control instead of offering an edit the renderer will ignore.
    theme,
    onTranslateSlide: ({ slideId }) => openTranslateSlideModal({ slideId }),
    onTranslateField: ({ slideId, key }) => openTranslateFieldModal({ slideId, key }),
    user,
    openOverlayClosers,
    isAuthor: isAuthor(),
    disabledSlideTypes,
    features,
    setInspectorCollapsed,
    // Canvas-header mounts for the slide-scoped toolbar (type chip, All
    // text, lock, actions). The contentOnly (bulk modal) instance renders
    // no chrome, so sharing this dep is harmless there.
    slideToolbar: previewPanel.slideToolbar,
  };

  const bulkEditModal = createBulkEditModal({
    h,
    pres,
    getSelectedSlideId: () => selectedSlideId,
    setSelectedSlideId: setSelectedSlideIdWithLock,
    getTheme: () => theme,
    // The shell-scoped locked-slide CSS can't reach the modal (it mounts on
    // document.body), so it asks for the lock state and gates itself.
    getSlideLockKind,
    openOverlayClosers,
    // Resync the panel form after the modal closes: the modal's structural
    // edits rerender its own form instance, not the panel behind it.
    onClosed: () => rerenderEditor(),
    createFormRenderer: (formMount, refreshModalPreview) =>
      createRerenderEditor({
        ...editorFormDeps,
        editorMount: formMount,
        contentOnly: true,
        // Keep the main canvas live too, and repaint the modal preview.
        scheduleUiRefresh: () => {
          scheduleUiRefresh();
          refreshModalPreview();
        },
        rerenderPreview: () => {
          rerenderPreview();
          refreshModalPreview();
        },
      }),
  });

  rerenderEditor = createRerenderEditor({
    ...editorFormDeps,
    onOpenBulkEdit: () => bulkEditModal.open(),
    getSelectedElement: () => selectedElement,
  });

  // Set (or clear) the selection-aware inspector's current element and rebuild
  // the inspector. Kept non-intrusive: it does not open a dismissed rail (the
  // element tab just becomes the active view when the pane is next shown).
  const setSelectedElement = (el) => {
    selectedElement = el || null;
    rerenderEditor();
  };

  // ============================================================
  // INLINE (WYSIWYG) EDITOR
  // ============================================================

  const inlineEditor = createInlineEditor({
    h,
    api,
    // Drag & drop image upload onto empty canvas placeholders is gated on the
    // same flag as every other upload path (off in imagekit-only / sandbox /
    // demo, where there is no upload destination).
    uploadsEnabled: !features?.disableUploads,
    thumb,
    previewStage: thumb.parentElement || thumb,
    overlayHost: preview,
    getSlide: () => pres.slides.find((s) => s.id === selectedSlideId),
    getSlideDef: (type) => SLIDE_TYPES[type],
    // State-driven, not classList-driven: the lock seam is the source of
    // truth; the shell classes are presentation only.
    getCanEdit: () => !readOnlyMode && !getSlideLockKind(selectedSlideId),
    // While placing a positioned comment, the inline editor must yield its
    // click capture so the pin lands anywhere on the slide (not just margins).
    isCommentAddMode: () => previewPanel.isCommentAddMode?.(),
    markDirty,
    requestSave,
    rerenderPreview: () => rerenderPreview(),
    rerenderEditor: () => rerenderEditor(),
    openImagePicker,
    pres,
    normalizeLang,
    canConvertSlideTo: (slide, toType) =>
      canConvertSlideTo(slide, toType, SLIDE_TYPES),
    // The shared convert action (lossy confirm + convert seam + refresh); on
    // "+ Add image" the fresh placeholder gets the media popover right away.
    // One markDirty per conversion = one undo step for the whole switch.
    convertSlideType: async (toType, { openMedia = false } = {}) => {
      const slide = pres.slides.find((s) => s.id === selectedSlideId);
      if (!slide) return false;
      const ok = await convertSlideWithConfirm({
        h,
        slide,
        toType,
        pres,
        editorState,
        SLIDE_TYPES,
      });
      if (ok && openMedia) {
        requestAnimationFrame(() => inlineEditor.openMediaByIndex(0));
      }
      return ok;
    },
    // Canvas → inspector selection. Clicking an element updates the inspector
    // (visible iff the settings pane is already open). The "Settings" chip is
    // the deliberate doorway: it also opens the pane on the element tab.
    onSelectElement: (el) => setSelectedElement(el),
    onOpenElementSettings: (el) => {
      setSelectedElement(el);
      inspectorPanes.open('settings');
    },
  });
  cleanup.register('inlineEditor', inlineEditor.destroy);

  // Custom (non-bundled) slide types render a placeholder synchronously and
  // get their real DOM from the server afterwards — re-apply the inline-edit
  // affordances then (refresh() is a no-op mid-edit and for undecorated types).
  const onSlideServerRendered = () => inlineEditor.refresh();
  thumb.addEventListener('slide-server-rendered', onSlideServerRendered);
  cleanup.register('inlineServerRenderRefresh', () =>
    thumb.removeEventListener('slide-server-rendered', onSlideServerRendered)
  );

  // ============================================================
  // PREVIEW RERENDER
  // ============================================================

  rerenderPreview = () => {
    // Never wipe the DOM while an inline edit is active — it would destroy the
    // element the user is typing in (and their caret/selection).
    if (inlineEditor.isEditing()) return;
    const slide = pres.slides.find((s) => s.id === selectedSlideId);
    // `mode: 'edit'` marks this as the inline-editable canvas so slide types can
    // suppress non-editing affordances (e.g. icon-card link overlays that would
    // otherwise intercept click-to-edit). Behaves like the default mode for all
    // runtime guards in slide-render (verified: only 'thumb'/'present'/'follow'
    // are special-cased).
    mountSlideInto(thumb, slide, { mode: 'edit', theme, presentationId: pres?.id });
    if (!slide) {
      inlineEditor.refresh();
      return;
    }
    previewPanel.rerenderLightboxIfOpen();

    if (lastNotesSlideId !== slide.id) {
      lastNotesSlideId = slide.id;
      previewNotesTa.value = slide.notes || '';
      previewPanel.refreshSlideComments?.();
    } else {
      // mountSlideInto wiped thumb.innerHTML — restore the markers container
      // so positioned comments stay visible during edit-time rerenders too.
      previewPanel.reattachCommentMarkers?.();
    }
    // Re-apply inline-edit affordances (ghosts, card buttons, hover class).
    inlineEditor.refresh();
  };

  // ============================================================
  // INITIAL RENDER
  // ============================================================

  rerenderSlideList();
  rerenderEditor();
  rerenderPreview();

  // Apply initial author lock state if the selected slide is locked
  if (selectedSlideId) {
    const authorLocked = isSlideAuthorLockedForUser(selectedSlideId);
    if (authorLocked) {
      shell?.classList?.add?.('is-slide-locked');
      shell?.classList?.add?.('is-author-locked-slide');
      const bannerText = t('editor.authorLocked.banner', 'This slide is locked by the author');
      shell?.style?.setProperty?.('--slide-locked-banner-text', `"${bannerText}"`);
    }
  }

  if (shouldScrollSelectionOnLoad) {
    requestAnimationFrame(() => {
      try {
        const active = slideListEl?.querySelector?.('.list-item.is-active');
        active?.scrollIntoView?.({ block: 'nearest' });
      } catch { /* ignore */ }
    });
  }

  // Fresh AI-generated deck: open the whole-deck review grid on top of the
  // editor. The flag is stripped from the URL so a refresh doesn't reopen it.
  if (startUrl?.searchParams?.get?.('aiReview') === '1') {
    try {
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete('aiReview');
      history.replaceState(history.state, '', cleanUrl.pathname + cleanUrl.search);
    } catch { /* ignore */ }
    requestAnimationFrame(() => openAiDeckReview({ postGeneration: true }));
  }

  updatePills();

  // ============================================================
  // LIFECYCLE
  // ============================================================

  const detachLifecycle = attachEditorLifecycle({
    saveManager,
    detachThumbScale: () => cleanup.run('thumbScale'),
    onWake: () => remoteRefresh.check(),
  });
  cleanup.register('lifecycle', detachLifecycle);

  // ============================================================
  // CLEANUP
  // ============================================================

  const detach = () => {
    try {
      cleanup.runAll();
      closeAllOverlays();
      cleanupSlideRuntimes(thumb);
      saveManager.cancelAutosave();
      if (uiRefreshTimer) clearTimeout(uiRefreshTimer);
      commentsPanel?.stopPolling?.();
      commentsPanel?.detach?.();
      slidesCollapsedPref.clearClass();
      inspectorCollapsedPref.clearClass();
    } catch { /* ignore */ }
  };

  return { detach, pres, theme, SLIDE_TYPES };
}