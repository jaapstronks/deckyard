/**
 * Presenter view.
 *
 * This is the public seam for the presenter view; it owns the live playback /
 * session orchestration and composes the concern modules beside it in this
 * folder. The deck/auto-advance/highlighter/present-channel/session core is one
 * tightly-interwoven closure and is kept intact here; its further decomposition
 * is tracked separately (the P4 long-file split, docs/plans/TODO.md).
 */

import { api } from '../../lib/api.js';
import { h } from '../../lib/dom.js';
import {
  activateVideoEmbeds,
  cleanupSlideRuntimes,
  pauseVideoEmbeds,
  renderSlideElement,
} from '../../lib/slide-runtime/slide-render.js';
import { createPresenterAnimator } from './animations.js';
import { STEP_DEPS } from './step.js';
import { startPresenterSession } from './session.js';
import { normalizeLang } from '../../lib/format/i18n.js';
import { t } from '../../lib/ui-i18n.js';
import { setDocumentTitle } from '../../lib/theme/branding.js';
import { copyToClipboardWithPromptFallback } from '../../lib/util/clipboard.js';
import { loadThemeById } from '../../lib/theme/theme.js';
import { attachStageScale } from './stage-scale.js';
import { createEdgeHint } from './edge-hint.js';
import { createSessionStatePoster } from './session-state.js';
import {
  createPresenterDeckController,
  normalizeNotesStrings,
} from './deck-controller.js';
import { attachPresenterKeys } from './keys.js';
import { attachSwipeNavigation } from '../../lib/dom/swipe-nav.js';
import { ensureOtherLanguageFollowAlong } from './translate-fill.js';
import {
  applyLikertInteractionStateToStage,
  applyPollInteractionStateToStage,
} from './interactions.js';
import { createPresenterToolsMenu } from './tools-menu.js';
import { createPresenterFollowCodesPill } from './follow-codes-pill.js';
import { createPresenterLangSeg } from './lang-seg.js';
import { createPresenterInteractionControls } from './interaction-controls.js';
import { createPresenterStageScaffold } from './stage-scaffold.js';
import { createPresenterConsole } from './console.js';
import { openPresenterShortcuts } from './shortcuts-overlay.js';
import { confirmModal } from '../../lib/dom/modal.js';
import { createPresenterFullscreenController } from './fullscreen.js';
import { createStartCurtain } from './start-curtain.js';
import { createChromeAutoHide } from './chrome-autohide.js';
import { createPresenterHighlighter } from './highlighter.js';
import { fetchMySettings } from '../../lib/net/settings.js';
import { createVideoLayer } from '../../lib/slide-runtime/video-layer.js';
import { createPresentChannel } from '../../lib/net/present-channel.js';
import { readDeckLangFromUrl } from './present-lang.js';
import { readDeckLangParam } from '../../lib/format/i18n.js';
import { createPresenterAutoAdvanceUi } from './auto-advance-ui.js';
import { createPresenterTeardown } from './teardown.js';
import { resolveRevealStyle } from '../../../shared/reveal-style.js';
import { createStepIndicatorRenderer } from './step-indicator.js';
import { createPresenterConsoleToggle } from './console-toggle.js';
import { buildPresenterTopbar } from './topbar.js';
import { nav, queryParam } from '../../lib/state/router.js';
import {
  DEFAULT_DECK_LANG,
  resolveDeckLang,
} from '../../../shared/i18n-utils.js';

export async function renderPresenter(root, id) {
  const { activeLang, langQs } = readDeckLangFromUrl();
  let pres = await api(`/api/presentations/${id}${langQs}`);
  setDocumentTitle(pres?.title);
  const theme = await loadThemeById(pres?.theme);
  const modeLang =
    activeLang ||
    normalizeLang(pres?.i18n?.active) ||
    normalizeLang(pres?.i18n?.dominant) ||
    DEFAULT_DECK_LANG;
  normalizeNotesStrings(pres);
  const shell = h('div', { class: 'presenter-shell' });
  let sessionId = null;
  let sessionPresId = null;
  let sessionFollowCodes = null;
  const lastInteractionBySlideId = new Map();
  let postSessionState = () => {};
  // Presenter console (opt-in notes/next/timer rail); wired after the deck exists.
  let presenterConsole = null;
  let updateConsole = () => {};

  // Presenter console toggle ("stage only" vs "console" with notes/next/timer).
  // Windowed-mode aid on the presenter's own screen; hidden in fullscreen (the
  // projector view). Preference persists across sessions.
  const consoleToggleCtl = createPresenterConsoleToggle({
    shell,
    getUpdateConsole: () => updateConsole,
  });
  const setConsoleMode = consoleToggleCtl.setConsoleMode;
  const consoleToggle = consoleToggleCtl.el;

  // Two-window presenter: a local BroadcastChannel that mirrors this window's
  // navigation to a clean projector window (see present-window.js).
  const presentChannel = createPresentChannel(id);
  let projectorWindow = null;
  // Whether a projector window is currently listening. Gates the per-frame
  // highlighter/laser broadcast so we don't serialize+postMessage every frame
  // when nobody's mirroring. Set optimistically on open + on the `hello`
  // handshake (covers direct-URL/reloaded projectors), cleared on `bye`.
  let hasProjector = false;
  presentChannel.onBye(() => {
    hasProjector = false;
  });
  const openProjectorWindow = () => {
    const url = `/present/${encodeURIComponent(id)}/window${langQs}`;
    // A stable window name so re-clicking focuses the existing projector.
    projectorWindow = window.open(url, `deckyard-projector-${id}`);
    hasProjector = true;
    try {
      projectorWindow?.focus?.();
    } catch {
      // ignore
    }
    // Keep the notes/next/timer console here on the laptop while the beamer
    // window shows the clean deck — the whole point of two windows.
    setConsoleMode(true);
  };
  // Tell the projector we're gone even on a hard tab close (SPA cleanup only
  // runs on in-app navigation). pagehide fires on close/reload/bfcache.
  const handlePageHide = () => {
    try {
      presentChannel.close();
    } catch {
      // ignore
    }
  };
  window.addEventListener('pagehide', handlePageHide);
  const copyText = async (label, text) => {
    await copyToClipboardWithPromptFallback(text, label);
  };

  // Developer convenience: show /go + 4-letter code in the top bar (outside the
  // slide). The tools menu re-parents the pill and relabels its copy button.
  const followCodes = createPresenterFollowCodesPill({ modeLang });

  const translatePill = h('div', {
    class: 'pill',
    hidden: true,
    text: '',
  });

  const toolsMenu = createPresenterToolsMenu({
    modeLang,
    getSessionId: () => sessionId,
    getSessionPresentationId: () => sessionPresId,
    copyText,
    followCodesPill: followCodes.el,
    followCodesCopyBtn: followCodes.copyBtn,
  });
  const toolsWrap = toolsMenu.el;
  const interactionCtl = createPresenterInteractionControls({
    api,
    getSessionId: () => sessionId,
    getCurrentSlide: () => deckCtl?.getState?.()?.current || null,
    getInteractionStateBySlideId: (slideId) =>
      lastInteractionBySlideId.get(slideId) || null,
  });
  const interactionPill = interactionCtl.el;

  const langCtl = createPresenterLangSeg({
    modeLang,
    getCurrentSlideId: () => deckCtl?.getState?.()?.current?.id || '',
  });
  const langSeg = langCtl.el;

  const animator = createPresenterAnimator();
  const goToEditor = () => {
    const lang = readDeckLangParam();
    const slideId = deckCtl?.getState?.()?.current?.id || '';
    const u = new URL(`/app/${id}`, location.origin);
    if (lang) u.searchParams.set('lang', lang);
    if (slideId) u.searchParams.set('slideId', slideId);
    const dest = u.pathname + u.search;
    // Prefer SPA navigation; fallback to hard navigation (works even in a fresh tab).
    nav(dest);
  };
  const fullscreenCtl = createPresenterFullscreenController({ shell });
  const syncFullscreenClass = fullscreenCtl.syncFullscreenClass;
  const toggleFullscreen = fullscreenCtl.toggleFullscreen;

  let closeSessionEvents = null;
  let keepAliveTid = null;

  // Deck-level presenter stepping ("Stappen"). Controlled from the editor settings modal
  // and persisted with the presentation (single source of truth).
  let stepParagraphs = !!pres?.settings?.stepParagraphs;
  // Reveal style for step-by-step builds (theme default → deck override). Phase
  // 1 is a single global style; typewriter-per-bullet is the notable one.
  const revealStyle = resolveRevealStyle({ settings: pres?.settings, theme });
  let deckCtl = null;

  // Auto-advance config (read early so the button can be created before actions.append)
  const autoAdvanceCfg = pres?.settings?.autoAdvance;
  const autoAdvanceEnabled = !!autoAdvanceCfg?.enabled;
  const autoAdvanceMode = autoAdvanceCfg?.mode === 'pacing' ? 'pacing' : 'auto';

  // Topbar pause/resume button (hidden when auto-advance is disabled; handlers wired after timer creation)
  const autoAdvanceBtn = h('button', {
    class: 'btn btn-secondary',
    text:
      autoAdvanceMode === 'pacing'
        ? t('presenter.pacingPause', 'Pause timer')
        : t('presenter.autoAdvancePause', 'Pause auto'),
    title: t('presenter.autoAdvanceToggle', 'Toggle auto-advance (A)'),
    hidden: !autoAdvanceEnabled,
  });

  // Highlighter toolbar buttons (handlers wired after highlighter is created)
  const laserBtn = h('button', {
    class: 'btn btn-secondary presenter-highlighter-btn',
    text: t('presenter.laser', 'Laser'),
    title: t('presenter.laserToggle', 'Toggle laser pointer (L)'),
  });
  const drawBtn = h('button', {
    class: 'btn btn-secondary presenter-highlighter-btn',
    text: t('presenter.draw', 'Draw'),
    title: t('presenter.drawToggle', 'Toggle draw mode (D)'),
  });

  const syncHighlighterButtons = (mode) => {
    laserBtn.classList.toggle('is-active', mode === 'laser');
    drawBtn.classList.toggle('is-active', mode === 'draw');
  };

  const { top } = buildPresenterTopbar({
    pres,
    langSeg,
    translatePill,
    interactionPill,
    toolsWrap,
    autoAdvanceBtn,
    laserBtn,
    drawBtn,
    consoleToggle,
    getSessionId: () => sessionId,
    onOpenProjector: () => openProjectorWindow(),
    onEdit: () => goToEditor(),
    onToggleFullscreen: () => toggleFullscreen(),
  });

  const {
    deck,
    stageWrap,
    stage,
    stepIndicator,
    progress,
    progressText,
    progressFill,
    edgeHint,
  } = createPresenterStageScaffold({ pres });

  // Render the remaining-build indicator (dots) for the current slide.
  const renderStepIndicator = createStepIndicatorRenderer(stepIndicator);
  const edgeHintCtl = createEdgeHint(edgeHint);

  shell.append(top, deck, progress);
  root.append(shell);

  // Presenter console rail: docked inside the deck, revealed by the toggle.
  // Same language source as the stage (deck-controller's `mountSlides`): the
  // console's next-slide thumb renders the same slide types and reads the same
  // built-in copy, so it must not be left on the default language.
  presenterConsole = createPresenterConsole({
    theme,
    presentationId: id,
    lang: resolveDeckLang(pres),
  });
  deck.append(presenterConsole.el);

  const videoLayer = createVideoLayer({
    containerEl: stageWrap,
    getCurrentSlide: () => deckCtl?.getState?.()?.current || null,
  });
  videoLayer.setConfig(pres?.settings?.liveVideo);

  // Auto-advance UI: countdown bar, deck-time readout and the pause button's
  // label/handler around the timer engine. The deck controller is created
  // below, so it's reached through a thunk (as it was when this lived inline).
  const { autoAdvance, syncProgressTime } = createPresenterAutoAdvanceUi({
    pres,
    autoAdvanceCfg,
    autoAdvanceEnabled,
    autoAdvanceMode,
    autoAdvanceBtn,
    progress,
    stageWrap,
    edgeHintCtl,
    getDeck: () => deckCtl,
  });

  const detachStageScale = attachStageScale(stageWrap, stage, {
    baseW: 1600,
    baseH: 900,
  });

  // Highlighter / laser pointer overlay - load user settings for color/thickness
  let highlighterColor = '#ef4444';
  let highlighterThickness = 4;
  let highlighterPersistentDraw = false;
  try {
    const mySettings = await fetchMySettings({ maxAgeMs: 5000 });
    if (mySettings?.highlighter?.color)
      highlighterColor = mySettings.highlighter.color;
    if (mySettings?.highlighter?.thickness)
      highlighterThickness = mySettings.highlighter.thickness;
    if (mySettings?.highlighter?.persistentDraw)
      highlighterPersistentDraw = true;
  } catch {
    // Use defaults if settings fail to load
  }
  const highlighter = createPresenterHighlighter({
    stageWrap,
    stage,
    baseW: 1600,
    baseH: 900,
    initialColor: highlighterColor,
    initialThickness: highlighterThickness,
    initialPersistentDraw: highlighterPersistentDraw,
    // Mirror the laser/drawings to the projector window — only while one is
    // connected, so an active laser doesn't post 60 msgs/s to nobody.
    onEvent: (ev) => {
      if (hasProjector) presentChannel.postHighlighter(ev);
    },
  });

  // Wire up highlighter toolbar buttons
  const toggleHighlighterMode = (mode) => {
    const current = highlighter.getMode();
    const newMode = current === mode ? null : mode;
    highlighter.setMode(newMode);
    syncHighlighterButtons(newMode);
  };
  laserBtn.onclick = () => toggleHighlighterMode('laser');
  drawBtn.onclick = () => toggleHighlighterMode('draw');

  // Track current slide for clearing drawings on slide change
  let lastSlideIdForHighlighter = '';

  deckCtl = createPresenterDeckController({
    api,
    presentationId: id,
    langQs,
    stage,
    theme,
    renderSlideElement,
    cleanupSlideRuntimes,
    animator,
    pauseVideoEmbeds,
    activateVideoEmbeds,
    step: STEP_DEPS,
    progressText,
    progressFill,
    onSteps: (s) => renderStepIndicator(s),
    onEdgeHint: (msg) => edgeHintCtl.show(msg),
    onStateChange: (state) => {
      // Mirror to the projector window (no-op if none is open).
      presentChannel.postState(state);
    },
    onPostState: (payload) => {
      postSessionState(payload);
      try {
        const sid = String(payload?.slideId || '').trim();
        // Clear drawings when slide changes
        if (sid && sid !== lastSlideIdForHighlighter) {
          lastSlideIdForHighlighter = sid;
          highlighter.clearDrawings();
        }
        // Reset auto-advance timer on slide change
        if (autoAdvanceEnabled) {
          const st = deckCtl?.getState?.();
          autoAdvance.onSlideChanged(st?.idx ?? 0, st?.slidesCount ?? 0);
        }
        if (sid && lastInteractionBySlideId.has(sid)) {
          const st = lastInteractionBySlideId.get(sid);
          if (String(st?.type || '') === 'likert')
            applyLikertInteractionStateToStage(stage, st);
          else applyPollInteractionStateToStage(stage, st);
        }
      } catch {
        // ignore
      }
      interactionCtl.sync();
      videoLayer.updatePosition();
      syncProgressTime();
      updateConsole();
    },
    getSessionReady: () => !!(sessionId && sessionPresId),
    getFollowCodes: () => sessionFollowCodes,
    getStepParagraphs: () => stepParagraphs,
    setStepParagraphs: (v) => {
      stepParagraphs = !!v;
    },
    getRevealStyle: () => revealStyle,
  });
  // Ensure initial step mode is applied to the current slide.
  deckCtl?.setStepModeEnabled?.(stepParagraphs);

  // A projector window that opens mid-presentation asks for the current state;
  // reply with an authoritative snapshot so it catches up immediately.
  presentChannel.onHello(() => {
    hasProjector = true;
    const st = deckCtl?.getState?.();
    if (st) {
      presentChannel.postState({
        slideIndex: st.idx ?? 0,
        stepIdx: st.stepIdx ?? 0,
        stepParagraphs,
      });
    }
    // Re-emit the current highlighter mode/color so a projector that opens
    // while the laser is active starts rendering it immediately.
    highlighter.emitSnapshot();
    // Follow-invite/poll/feedback slides need the session join codes to render
    // them on the beamer; hand them to a projector that just connected.
    if (sessionFollowCodes) presentChannel.postCodes(sessionFollowCodes);
  });

  // Refresh the presenter console with the current + next slide and notes.
  updateConsole = () => {
    if (!presenterConsole) return;
    const st = deckCtl?.getState?.();
    if (!st) return;
    presenterConsole.update({
      current: st.current,
      next: st.next,
      idx: st.idx ?? 0,
      total: st.slidesCount ?? 0,
    });
  };

  const statePoster = createSessionStatePoster({
    api,
    getSessionId: () => sessionId,
    getSessionPresentationId: () => sessionPresId,
    getCurrentSlide: () => deckCtl?.getState?.()?.current || null,
    getCurrentIndex: () => deckCtl?.getState?.()?.idx ?? 0,
    getStepParagraphs: () => stepParagraphs,
  });
  postSessionState = (partial) => statePoster.postSessionState(partial);

  const syncInteractionUi = () => interactionCtl.sync();

  const startSlideId = queryParam('slideId') || queryParam('s') || '';
  deckCtl.setPresentation(pres, {
    keepCurrentSlideId: startSlideId,
  });
  syncInteractionUi();
  updateConsole();

  consoleToggleCtl.restorePreference();

  // Auto-advance is configured now but only *starts* once the presenter
  // dismisses the start curtain, so the timer can't run behind the curtain.
  if (autoAdvanceEnabled) {
    const st = deckCtl?.getState?.();
    autoAdvance.onSlideChanged(st?.idx ?? 0, st?.slidesCount ?? 0);
  }
  syncProgressTime();

  // Kick off actual playback (deferred until the curtain is dismissed).
  let presentationStarted = false;
  const beginPresentation = () => {
    if (presentationStarted) return;
    presentationStarted = true;
    presenterConsole?.startTimer?.();
    if (autoAdvanceEnabled) autoAdvance.start();
  };

  // Shortcut help overlay ("?"): toggle open/closed.
  let shortcutsOverlay = null;
  const toggleShortcutsHelp = () => {
    if (shortcutsOverlay) {
      shortcutsOverlay.close();
      return;
    }
    shortcutsOverlay = openPresenterShortcuts({
      onClose: () => {
        shortcutsOverlay = null;
      },
    });
  };

  // Esc guard: a stray Esc mid-talk shouldn't yank the presenter to the editor.
  // Escape first dismisses the help overlay / highlighter / fullscreen; only a
  // deliberate confirm leaves the presentation.
  let leaveConfirmOpen = false;

  // Strict pacing: when enabled the timer is the only thing that changes slides,
  // so manual navigation is ignored. Auto mode only — in pacing mode (or with no
  // timer) strict would trap the deck with no way to move.
  const isStrictNav = () =>
    autoAdvanceEnabled &&
    autoAdvanceMode === 'auto' &&
    !!autoAdvanceCfg?.strict;
  const guardNav = (fn) => () => {
    if (isStrictNav()) {
      edgeHintCtl.show(
        t('presenter.strictNav', 'Timer only — manual navigation is off'),
      );
      return;
    }
    fn();
  };

  const detachKeys = attachPresenterKeys({
    onNext: guardNav(() => deckCtl?.next?.()),
    onPrev: guardNav(() => deckCtl?.prev?.()),
    onRevealAll: () => {
      // Reveal every remaining build at once; if there's nothing left, advance
      // (unless strict pacing owns slide navigation).
      if (!deckCtl?.revealAll?.() && !isStrictNav()) deckCtl?.next?.();
    },
    onCollapseAll: () => {
      // Collapse the current build; if already empty, step back a slide
      // (unless strict pacing owns slide navigation).
      if (!deckCtl?.collapseAll?.() && !isStrictNav()) deckCtl?.prev?.();
    },
    onHome: guardNav(() => deckCtl?.show?.(0)),
    onEnd: guardNav(() => {
      const n = deckCtl?.getState?.()?.slidesCount || 0;
      deckCtl?.show?.(Math.max(0, n - 1));
    }),
    onToggleFullscreen: () => toggleFullscreen(),
    onToggleLaser: () => toggleHighlighterMode('laser'),
    onToggleDraw: () => toggleHighlighterMode('draw'),
    onClearDrawings: () => highlighter.clearDrawings(),
    onTogglePersistentDraw: () => {
      const newValue = !highlighter.getPersistentDraw();
      highlighter.setPersistentDraw(newValue);
      edgeHintCtl.show(
        newValue
          ? t('presenter.persistentDrawOn', 'Drawings: persistent')
          : t('presenter.persistentDrawOff', 'Drawings: fading'),
      );
    },
    onToggleAutoAdvance: () => {
      if (!autoAdvanceEnabled) return;
      autoAdvance.toggle();
    },
    onToggleHelp: () => toggleShortcutsHelp(),
    onEscape: async () => {
      // Escape cascades from "least destructive" to "leave": dismiss the help
      // overlay, then the highlighter, then fullscreen. Only when nothing is
      // left to dismiss does it offer to leave — behind a confirm so a single
      // stray press can't drop the presenter out of a live talk.
      if (shortcutsOverlay) {
        shortcutsOverlay.close();
        return;
      }
      if (highlighter.getMode()) {
        highlighter.setMode(null);
        syncHighlighterButtons(null);
        return;
      }
      if (document.fullscreenElement) {
        document.exitFullscreen();
        return;
      }
      if (leaveConfirmOpen) return;
      leaveConfirmOpen = true;
      let ok = false;
      try {
        ok = await confirmModal(document.body, {
          title: t('presenter.leave.title', 'Leave presentation?'),
          message: t(
            'presenter.leave.message',
            'Return to the editor? You can start presenting again anytime.',
          ),
          confirmLabel: t('presenter.leave.confirm', 'Leave'),
          cancelLabel: t('presenter.leave.stay', 'Stay'),
        });
      } finally {
        leaveConfirmOpen = false;
      }
      if (ok) goToEditor();
    },
  });
  document.addEventListener('fullscreenchange', syncFullscreenClass);
  syncFullscreenClass();

  // Swipe navigation for presenting from a phone or tablet. Bound to
  // stageWrap, not stage: the highlighter canvas is layered over stage as a
  // sibling, so touches never reach stage itself. stageWrap also covers the
  // letterbox bars, which is where a thumb lands on a phone anyway.
  // Suppressed while laser or draw mode owns the stage, otherwise every
  // stroke would also flip the slide.
  const detachSwipe = attachSwipeNavigation(stageWrap, {
    enabled: () => !highlighter.getMode(),
    onPrev: guardNav(() => deckCtl?.prev?.()),
    onNext: guardNav(() => deckCtl?.next?.()),
  });

  // Auto-hiding chrome: collapses the progress bar (and cursor) after idle in
  // fullscreen so the deck fills a true 16:9 with no pillarbox bars.
  const chromeAutoHide = createChromeAutoHide({ shell });

  // Start curtain: primary path into fullscreen (and the required user gesture).
  const startCurtain = createStartCurtain({
    title: pres?.title || '',
    slideCount: deckCtl?.getState?.()?.slidesCount || 0,
    onStartFullscreen: () => {
      toggleFullscreen();
      beginPresentation();
    },
    onStartWindowed: () => {
      beginPresentation();
    },
  });
  shell.append(startCurtain.el);

  // Create presenter session (for notes companion)
  try {
    const sess = await startPresenterSession({
      api,
      presentationId: id,
      onNext: guardNav(() => deckCtl?.next?.()),
      onPrev: guardNav(() => deckCtl?.prev?.()),
      onGoto: (slideIndex) => {
        if (isStrictNav()) return;
        const cur = deckCtl?.getState?.()?.idx ?? 0;
        deckCtl?.show?.(Number(slideIndex ?? cur));
      },
      onDeckUpdated: (data) => {
        // Live-update deck when a question is promoted into the presentation.
        if (data?.presentationId && String(data.presentationId) !== String(id))
          return;
        deckCtl
          ?.refreshDeck?.()
          .then(() => {
            const nextPres = deckCtl?.getState?.()?.presentation || null;
            if (nextPres) pres = nextPres;
          })
          .catch(() => {});
      },
      onInteractionState: (data) => {
        const slideId = String(data?.slideId || '').trim();
        if (!slideId) return;
        lastInteractionBySlideId.set(slideId, data);
        if (String(data?.type || '') === 'likert')
          applyLikertInteractionStateToStage(stage, data);
        else if (String(data?.type || '') === 'poll')
          applyPollInteractionStateToStage(stage, data);
        // feedback: no stage UI updates (not displayed on slide)
        syncInteractionUi();
      },
      onBranch: (data) => {
        const onClose = String(data?.onClose || 'stay').trim();
        const onCloseTarget = String(data?.onCloseTarget || '').trim();
        if (onClose === 'next') {
          deckCtl?.next?.();
        } else if (onClose === 'goto' && onCloseTarget) {
          // Find the slide index by ID
          const state = deckCtl?.getState?.();
          const slides = state?.slides || [];
          const targetIdx = slides.findIndex(
            (s) => String(s?.id || '') === onCloseTarget,
          );
          if (targetIdx >= 0) {
            deckCtl?.show?.(targetIdx);
          }
        }
      },
    });
    sessionId = sess?.sessionId || null;
    sessionPresId = id;
    sessionFollowCodes = sess?.followCodes || null;
    closeSessionEvents = sess?.close || null;

    if (sessionFollowCodes) {
      followCodes.setCodes(sessionFollowCodes);
      // Mirror the join codes to an already-open projector window so the beamer
      // shows the same follow-invite/poll/feedback codes.
      presentChannel.postCodes(sessionFollowCodes);
      // Re-render slides now that follow codes are available.
      // The deck is initially rendered before the presenter session is created,
      // so follow-invite slides would otherwise miss the "Alternative" codes block.
      try {
        const curId = deckCtl?.getState?.()?.current?.id || '';
        deckCtl?.setPresentation?.(pres, {
          keepCurrentSlideId: curId,
        });
        if (curId && lastInteractionBySlideId.has(curId)) {
          const st = lastInteractionBySlideId.get(curId);
          if (String(st?.type || '') === 'likert')
            applyLikertInteractionStateToStage(stage, st);
          else applyPollInteractionStateToStage(stage, st);
        }
      } catch {
        // ignore
      }
    }
    toolsMenu.syncEnabled();
    // Keep the session "live" while the presenter is talking (even if no slide/step changes happen).
    if (sessionId) {
      try {
        if (keepAliveTid) clearInterval(keepAliveTid);
      } catch {}
      keepAliveTid = setInterval(() => {
        try {
          const st = deckCtl?.getState?.();
          const current = st?.current;
          if (!current) return;
          postSessionState({
            slideId: current.id,
            slideIndex: st?.idx ?? 0,
            stepIdx: st?.stepIdx ?? 0,
            stepParagraphs,
          });
        } catch {
          // ignore
        }
      }, 25_000);
      keepAliveTid.unref?.();
    }
  } catch {
    // Ignore: presenter works without notes session
  }

  // Background: ensure the other-language follow-along can render (fill missing only; preserve any manual translations).
  ensureOtherLanguageFollowAlong({
    api,
    presentationId: id,
    pres,
    activeLang,
    translatePill,
  });

  // Let the SPA router unmount this view cleanly (pushState navigation doesn't fire popstate).
  return createPresenterTeardown({
    animator,
    stage,
    pauseVideoEmbeds,
    cleanupSlideRuntimes,
    detachKeys,
    detachSwipe,
    syncFullscreenClass,
    closeSessionEvents,
    toolsMenu,
    detachStageScale,
    chromeAutoHide,
    startCurtain,
    highlighter,
    autoAdvance,
    presenterConsole,
    handlePageHide,
    presentChannel,
    getShortcutsOverlay: () => shortcutsOverlay,
    videoLayer,
    edgeHintCtl,
    keepAliveTid,
  });
}
