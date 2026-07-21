import { api } from '../lib/api.js';
import { logout } from '../lib/auth.js';
import { h } from '../lib/dom.js';
import {
  activateVideoEmbeds,
  cleanupSlideRuntimes,
  pauseVideoEmbeds,
  renderSlideElement,
} from '../lib/slide-render.js';
import { createPresenterAnimator } from './presenter/animations.js';
import { STEP_DEPS } from './presenter/step.js';
import { startPresenterSession } from './presenter/session.js';
import { normalizeLang } from '../lib/i18n.js';
import { t } from '../lib/ui-i18n.js';
import { setDocumentTitle } from '../lib/branding.js';
import { copyToClipboardWithPromptFallback } from '../lib/clipboard.js';
import { loadThemeById } from '../lib/theme.js';
import { attachStageScale } from './presenter/stage-scale.js';
import { createEdgeHint } from './presenter/edge-hint.js';
import { createSessionStatePoster } from './presenter/session-state.js';
import {
  createPresenterDeckController,
  normalizeNotesStrings,
} from './presenter/deck-controller.js';
import { attachPresenterKeys } from './presenter/keys.js';
import { attachSwipeNavigation } from '../lib/swipe-nav.js';
import { ensureOtherLanguageFollowAlong } from './presenter/translate-fill.js';
import {
  applyLikertInteractionStateToStage,
  applyPollInteractionStateToStage,
} from './presenter/interactions.js';
import { createPresenterToolsMenu } from './presenter/tools-menu.js';
import { createPresenterLangSeg } from './presenter/lang-seg.js';
import { createPresenterInteractionControls } from './presenter/interaction-controls.js';
import { createPresenterControlToggle } from './presenter/control-toggle.js';
import { createPresenterStageScaffold } from './presenter/stage-scaffold.js';
import { createPresenterConsole } from './presenter/console.js';
import { openPresenterShortcuts } from './presenter/shortcuts-overlay.js';
import { confirmModal } from '../lib/modal.js';
import { createPresenterFullscreenController } from './presenter/fullscreen.js';
import { createStartCurtain } from './presenter/start-curtain.js';
import { createChromeAutoHide } from './presenter/chrome-autohide.js';
import { createPresenterHighlighter } from './presenter/highlighter.js';
import { fetchMySettings } from '../lib/settings.js';
import { createVideoLayer } from '../lib/video-layer.js';
import { createAutoAdvance } from './presenter/auto-advance.js';
import { createPresentChannel } from '../lib/present-channel.js';
import { readDeckLangFromUrl } from './presenter/present-lang.js';
import { getSlideEffectiveDuration, calculateDeckTime, DEFAULT_ADVANCE_INTERVAL_SECONDS } from '../../shared/slide-timing.js';

export async function renderPresenter(
  root,
  id,
  { nav, user } = {}
) {
  // Make presentation ID globally available for lead capture forms
  window.__PRESENTATION_ID__ = id;

  const startUrl = new URL(location.href);
  const { activeLang, langQs } = readDeckLangFromUrl(startUrl);
  let pres = await api(`/api/presentations/${id}${langQs}`);
  setDocumentTitle(pres?.title);
  const theme = await loadThemeById(pres?.theme);
  const modeLang =
    activeLang ||
    normalizeLang(pres?.i18n?.active) ||
    normalizeLang(pres?.i18n?.dominant) ||
    'nl';
  normalizeNotesStrings(pres);
  const shell = h('div', { class: 'presenter-shell' });
  const top = h('div', { class: 'presenter-topbar' });
  const actions = h('div', { class: 'presenter-actions' });
  let sessionId = null;
  let sessionPresId = null;
  let sessionFollowCodes = null;
  let controlEnabled = false;
  let eventsEs = null;
  const lastInteractionBySlideId = new Map();
  let postSessionState = () => {};
  // Presenter console (opt-in notes/next/timer rail); wired after the deck exists.
  let presenterConsole = null;
  let updateConsole = () => {};

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

  // Developer convenience: show /go + 4-letter code in the top bar (outside the slide).
  const followCodesPill = h('div', {
    class: 'presenter-followcodes',
    hidden: true,
    title: t('presenter.followCodes.title', 'Follow-along: /go + code'),
  });
  const followCodesText = h('div', {
    class: 'presenter-followcodes-text',
    text: '',
  });
  const followCodesCopyBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('presenter.followCodes.copy', 'Copy /go + code'),
    disabled: true,
    onclick: async () => {
      if (!sessionFollowCodes) return;
      const code =
        (modeLang === 'nl'
          ? sessionFollowCodes?.nl
          : sessionFollowCodes?.en) ||
        sessionFollowCodes?.nl ||
        sessionFollowCodes?.en;
      if (!code) return;
      const payload = `/go ${code}`;
      await copyToClipboardWithPromptFallback(payload, 'Copy:');
    },
  });
  followCodesPill.append(
    followCodesText,
    followCodesCopyBtn
  );

  const translatePill = h('div', {
    class: 'pill',
    hidden: true,
    text: '',
  });

  const toolsMenu = createPresenterToolsMenu({
    h,
    modeLang,
    getSessionId: () => sessionId,
    getSessionPresentationId: () => sessionPresId,
    copyText,
    followCodesPill,
    followCodesCopyBtn,
  });
  const toolsWrap = toolsMenu.el;
  const interactionCtl = createPresenterInteractionControls({
    h,
    api,
    getSessionId: () => sessionId,
    getCurrentSlide: () => deckCtl?.getState?.()?.current || null,
    getInteractionStateBySlideId: (slideId) =>
      lastInteractionBySlideId.get(slideId) || null,
  });
  const interactionPill = interactionCtl.el;

  const langCtl = createPresenterLangSeg({
    h,
    modeLang,
    getCurrentSlideId: () => deckCtl?.getState?.()?.current?.id || '',
  });
  const langSeg = langCtl.el;

  const animator = createPresenterAnimator();
  const goToEditor = () => {
    const lang = startUrl.searchParams.get('lang');
    const slideId = deckCtl?.getState?.()?.current?.id || '';
    const u = new URL(`/app/${id}`, location.origin);
    if (lang === 'nl' || lang === 'en-GB') u.searchParams.set('lang', lang);
    if (slideId) u.searchParams.set('slideId', slideId);
    const dest = u.pathname + u.search;
    // Prefer SPA navigation; fallback to hard navigation (works even in a fresh tab).
    if (typeof nav === 'function') nav(dest);
    else location.href = dest;
  };
  const fullscreenCtl = createPresenterFullscreenController({ shell });
  const syncFullscreenClass = fullscreenCtl.syncFullscreenClass;
  const toggleFullscreen = fullscreenCtl.toggleFullscreen;

  let closeSessionEvents = null;
  let keepAliveTid = null;

  // Deck-level presenter stepping ("Stappen"). Controlled from the editor settings modal
  // and persisted with the presentation (single source of truth).
  let stepParagraphs = !!pres?.settings?.stepParagraphs;
  let deckCtl = null;

  // Auto-advance config (read early so the button can be created before actions.append)
  const autoAdvanceCfg = pres?.settings?.autoAdvance;
  const autoAdvanceEnabled = !!autoAdvanceCfg?.enabled;
  const autoAdvanceMode = autoAdvanceCfg?.mode === 'pacing' ? 'pacing' : 'auto';

  // Topbar pause/resume button (hidden when auto-advance is disabled; handlers wired after timer creation)
  const autoAdvanceBtn = h('button', {
    class: 'btn btn-secondary',
    text: autoAdvanceMode === 'pacing'
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

  // Presenter console toggle ("stage only" vs "console" with notes/next/timer).
  // Windowed-mode aid on the presenter's own screen; hidden in fullscreen (the
  // projector view). Preference persists across sessions.
  const CONSOLE_PREF_KEY = 'deckyard:presenterConsole';
  const consoleToggleInput = h('input', {
    type: 'checkbox',
    'aria-label': t('presenter.console.toggle', 'Console'),
  });
  const consoleToggle = h(
    'label',
    {
      class: 'presenter-toggle',
      title: t(
        'presenter.console.toggleTitle',
        'Presenter console: notes, next slide and elapsed time on your own screen'
      ),
    },
    [
      consoleToggleInput,
      h('span', { text: t('presenter.console.toggle', 'Console') }),
    ]
  );
  const setConsoleMode = (on) => {
    const enabled = !!on;
    shell.classList.toggle('is-console', enabled);
    consoleToggleInput.checked = enabled;
    try {
      localStorage.setItem(CONSOLE_PREF_KEY, enabled ? '1' : '0');
    } catch {
      // ignore storage failures
    }
    if (enabled) updateConsole();
  };
  consoleToggleInput.addEventListener('change', () => {
    setConsoleMode(consoleToggleInput.checked);
  });

  actions.append(
    // Notes companion + remote control
    langSeg,
    translatePill,
    interactionPill,
    toolsWrap,
    createPresenterControlToggle({
      h,
      api,
      getSessionId: () => sessionId,
      setControlEnabled: (enabled) => {
        controlEnabled = !!enabled;
      },
    }).el,
    laserBtn,
    drawBtn,
    consoleToggle,
    h('button', {
      class: 'btn btn-secondary',
      text: t('presenter.projector.open', 'Second screen'),
      title: t(
        'presenter.projector.openTitle',
        'Open the clean deck in a second window for the projector, and keep the console on this screen'
      ),
      onclick: () => openProjectorWindow(),
    }),
    h('button', {
      class: 'btn btn-secondary',
      text: t('presenter.edit', 'Edit'),
      onclick: () => goToEditor(),
    }),
    h('button', {
      class: 'btn btn-secondary',
      text: t('presenter.fullscreen', 'Fullscreen'),
      onclick: () => toggleFullscreen(),
    }),
    autoAdvanceBtn,
    h('div', {
      class: 'presenter-help',
      text: t('presenter.help', '←/→ move · F fullscreen · ? shortcuts'),
    })
  );

  top.append(
    h('div', {
      class: 'presenter-title',
      text: pres.title,
    }),
    actions
  );

  const {
    deck,
    stageWrap,
    stage,
    stepIndicator,
    progress,
    progressText,
    progressFill,
    edgeHint,
  } = createPresenterStageScaffold({ h, pres });

  // Render the remaining-build indicator (dots) for the current slide.
  let lastStepTotal = -1;
  const renderStepIndicator = ({ shown = 0, total = 0 } = {}) => {
    if (!stepIndicator) return;
    if (total <= 0) {
      stepIndicator.classList.remove('is-visible', 'is-complete');
      stepIndicator.replaceChildren();
      lastStepTotal = 0;
      return;
    }
    // Rebuild dots only when the count changes; otherwise just retoggle state.
    if (total !== lastStepTotal) {
      const dots = [];
      for (let i = 0; i < total; i += 1) {
        dots.push(h('span', { class: 'presenter-step-dot' }));
      }
      stepIndicator.replaceChildren(...dots);
      lastStepTotal = total;
    }
    const dots = stepIndicator.children;
    for (let i = 0; i < dots.length; i += 1) {
      dots[i].classList.toggle('is-on', i < shown);
    }
    stepIndicator.classList.add('is-visible');
    // When everything is revealed, mark complete so CSS can fade it away —
    // absence of the indicator is the "nothing more coming" signal.
    stepIndicator.classList.toggle('is-complete', shown >= total);
  };
  const edgeHintCtl = createEdgeHint(edgeHint);

  // Total deck time in progress area (visible when auto-advance is enabled)
  const progressTimeEl = h('div', { class: 'presenter-progress-time', text: '' });
  if (autoAdvanceEnabled) {
    progress.append(progressTimeEl);
  }
  const syncProgressTime = () => {
    if (!autoAdvanceEnabled) return;
    const slides = deckCtl?.getState?.()?.presentation?.slides || pres?.slides || [];
    const { formatted } = calculateDeckTime(slides, autoAdvanceCfg?.intervalSeconds || DEFAULT_ADVANCE_INTERVAL_SECONDS);
    const st = deckCtl?.getState?.();
    const idx = (st?.idx ?? 0) + 1;
    const total = st?.slidesCount ?? slides.length;
    progressTimeEl.textContent = `${idx} / ${total} \u00b7 ${formatted}`;
  };

  shell.append(top, deck, progress);
  root.append(shell);

  // Presenter console rail: docked inside the deck, revealed by the toggle.
  presenterConsole = createPresenterConsole({ theme, presentationId: id });
  deck.append(presenterConsole.el);

  const videoLayer = createVideoLayer({
    containerEl: stageWrap,
    getCurrentSlide: () => deckCtl?.getState?.()?.current || null,
  });
  videoLayer.setConfig(pres?.settings?.liveVideo);

  // Auto-advance countdown bar
  const autoAdvanceBarEl = h('div', { class: 'auto-advance-bar' });
  const autoAdvanceBarFill = h('div', { class: 'auto-advance-bar-fill' });
  autoAdvanceBarEl.append(autoAdvanceBarFill);
  // Only show bar if enabled + showCountdown
  autoAdvanceBarEl.hidden = !(autoAdvanceEnabled && autoAdvanceCfg?.showCountdown !== false);
  stageWrap.append(autoAdvanceBarEl);

  const autoAdvance = createAutoAdvance({
    onAdvance: () => deckCtl?.next?.(),
    onTick: (progress) => {
      if (progress <= 1) {
        autoAdvanceBarFill.style.width = `${(progress * 100).toFixed(1)}%`;
        autoAdvanceBarEl.classList.remove('is-overtime');
      } else {
        // Pacing overtime: bar stays at 100%, visual indicator changes
        autoAdvanceBarFill.style.width = '100%';
        autoAdvanceBarEl.classList.add('is-overtime');
      }
    },
    onStateChange: (s) => {
      autoAdvanceBarEl.classList.toggle('is-paused', s === 'paused');
      syncAutoAdvanceBtn();
    },
    onLoopComplete: () => deckCtl?.show?.(0),
    onTimerExpired: () => {
      // Pacing mode: show edge hint when timer runs out
      edgeHintCtl.show(t('presenter.timesUp', "Time's up"));
    },
  });

  // Wire up auto-advance button handlers (button created earlier, timer available now)
  const syncAutoAdvanceBtn = () => {
    const s = autoAdvance.getState();
    if (autoAdvanceMode === 'pacing') {
      autoAdvanceBtn.textContent = s === 'running'
        ? t('presenter.pacingPause', 'Pause timer')
        : t('presenter.pacingResume', 'Resume timer');
    } else {
      autoAdvanceBtn.textContent = s === 'running'
        ? t('presenter.autoAdvancePause', 'Pause auto')
        : t('presenter.autoAdvanceResume', 'Resume auto');
    }
    autoAdvanceBtn.classList.toggle('is-active', s === 'running');
  };
  autoAdvanceBtn.addEventListener('click', () => {
    autoAdvance.toggle();
  });

  // Per-slide duration lookup: reads live from deck state
  const getSlideInterval = (idx) => {
    const slides = deckCtl?.getState?.()?.presentation?.slides || pres?.slides || [];
    return getSlideEffectiveDuration(slides[idx], autoAdvanceCfg?.intervalSeconds || DEFAULT_ADVANCE_INTERVAL_SECONDS);
  };

  if (autoAdvanceEnabled) {
    autoAdvance.configure({
      intervalSeconds: autoAdvanceCfg?.intervalSeconds || DEFAULT_ADVANCE_INTERVAL_SECONDS,
      loop: !!autoAdvanceCfg?.loop,
      mode: autoAdvanceMode,
      getSlideInterval,
    });
  }

  const detachStageScale = attachStageScale(
    stageWrap,
    stage,
    {
      baseW: 1600,
      baseH: 900,
    }
  );

  // Highlighter / laser pointer overlay - load user settings for color/thickness
  let highlighterColor = '#ef4444';
  let highlighterThickness = 4;
  let highlighterPersistentDraw = false;
  try {
    const mySettings = await fetchMySettings({ maxAgeMs: 5000 });
    if (mySettings?.highlighter?.color) highlighterColor = mySettings.highlighter.color;
    if (mySettings?.highlighter?.thickness) highlighterThickness = mySettings.highlighter.thickness;
    if (mySettings?.highlighter?.persistentDraw) highlighterPersistentDraw = true;
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
    h,
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
          autoAdvance.onSlideChanged(
            st?.idx ?? 0,
            st?.slidesCount ?? 0
          );
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
    getCurrentSlide: () =>
      deckCtl?.getState?.()?.current || null,
    getCurrentIndex: () => deckCtl?.getState?.()?.idx ?? 0,
    getStepParagraphs: () => stepParagraphs,
  });
  postSessionState = (partial) =>
    statePoster.postSessionState(partial);

  const syncInteractionUi = () => interactionCtl.sync();

  const startSlideId =
    startUrl.searchParams.get('slideId') ||
    startUrl.searchParams.get('s') ||
    '';
  deckCtl.setPresentation(pres, {
    keepCurrentSlideId: startSlideId,
  });
  syncInteractionUi();
  updateConsole();

  // Restore the presenter's console preference (opt-in, off by default).
  try {
    if (localStorage.getItem(CONSOLE_PREF_KEY) === '1') setConsoleMode(true);
  } catch {
    // ignore storage failures
  }

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
    autoAdvanceEnabled && autoAdvanceMode === 'auto' && !!autoAdvanceCfg?.strict;
  const guardNav = (fn) => () => {
    if (isStrictNav()) {
      edgeHintCtl.show(
        t('presenter.strictNav', 'Timer only — manual navigation is off')
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
          : t('presenter.persistentDrawOff', 'Drawings: fading')
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
        ok = await confirmModal(h, document.body, {
          title: t('presenter.leave.title', 'Leave presentation?'),
          message: t(
            'presenter.leave.message',
            'Return to the editor? You can start presenting again anytime.'
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
  document.addEventListener(
    'fullscreenchange',
    syncFullscreenClass
  );
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
    h,
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
      onControlEnabled: (enabled) => {
        controlEnabled = !!enabled;
      },
      onDeckUpdated: (data) => {
        // Live-update deck when a question is promoted into the presentation.
        if (
          data?.presentationId &&
          String(data.presentationId) !== String(id)
        )
          return;
        deckCtl
          ?.refreshDeck?.()
          .then(() => {
            const nextPres =
              deckCtl?.getState?.()?.presentation || null;
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
            (s) => String(s?.id || '') === onCloseTarget
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
      try {
        const code =
          (modeLang === 'nl'
            ? sessionFollowCodes?.nl
            : sessionFollowCodes?.en) ||
          sessionFollowCodes?.nl ||
          sessionFollowCodes?.en;
        followCodesText.textContent = code
          ? `/go ${code}`
          : '/go';
        followCodesPill.hidden = !code;
        followCodesCopyBtn.disabled = !code;
      } catch {
        // ignore
      }
      // Mirror the join codes to an already-open projector window so the beamer
      // shows the same follow-invite/poll/feedback codes.
      presentChannel.postCodes(sessionFollowCodes);
      // Re-render slides now that follow codes are available.
      // The deck is initially rendered before the presenter session is created,
      // so follow-invite slides would otherwise miss the "Alternative" codes block.
      try {
        const curId =
          deckCtl?.getState?.()?.current?.id || '';
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
  return () => {
    animator.cancel();
    try {
      const section =
        stage?.querySelector?.('.deck-slide.is-active') ||
        null;
      if (section) pauseVideoEmbeds(section);
    } catch {}
    cleanupSlideRuntimes(stage);
    try {
      stage.innerHTML = '';
    } catch {}
    try {
      detachKeys?.();
    } catch {}
    try {
      detachSwipe?.();
    } catch {}
    document.removeEventListener(
      'fullscreenchange',
      syncFullscreenClass
    );
    document.documentElement.classList.remove(
      'is-fullscreen'
    );
    if (typeof closeSessionEvents === 'function')
      closeSessionEvents();
    closeSessionEvents = null;
    toolsMenu.cleanup();
    try {
      detachStageScale?.();
    } catch {}
    try {
      chromeAutoHide?.destroy?.();
    } catch {}
    try {
      startCurtain?.dismiss?.();
    } catch {}
    try {
      highlighter?.destroy?.();
    } catch {}
    try {
      autoAdvance?.destroy?.();
    } catch {}
    try {
      presenterConsole?.destroy?.();
    } catch {}
    try {
      window.removeEventListener('pagehide', handlePageHide);
    } catch {}
    try {
      presentChannel.close();
    } catch {}
    try {
      shortcutsOverlay?.close?.();
    } catch {}
    videoLayer.destroy();
    edgeHintCtl.destroy();
    if (keepAliveTid) {
      try {
        clearInterval(keepAliveTid);
      } catch {}
      keepAliveTid = null;
    }
    if (document.fullscreenElement) {
      try {
        const p =
          document.exitFullscreen &&
          document.exitFullscreen();
        if (p?.catch) p.catch(() => {});
      } catch {}
    }
  };
}