import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';
import { t } from '../lib/ui-i18n.js';
import { loadThemeById } from '../lib/theme/theme.js';
import { resolveRevealStyle } from '../../shared/reveal-style.js';
import {
  cleanupSlideRuntimes,
  pauseVideoEmbeds,
  activateVideoEmbeds,
  renderSlideElement,
} from '../lib/slide-runtime/slide-render.js';
import { createPresenterAnimator } from './presenter/animations.js';
import { createPresenterStageScaffold } from './presenter/stage-scaffold.js';
import { attachStageScale } from './presenter/stage-scale.js';
import { createPresenterFullscreenController } from './presenter/fullscreen.js';
import {
  createPresenterDeckController,
  normalizeNotesStrings,
} from './presenter/deck-controller.js';
import { STEP_DEPS } from './presenter/step.js';
import { createPresenterHighlighter } from './presenter/highlighter.js';
import { createPresentChannel } from '../lib/net/present-channel.js';
import { readDeckLangFromUrl } from './presenter/present-lang.js';

/**
 * Projector window for the two-window presenter view.
 *
 * Opened via `window.open('/present/:id/window')` from the presenter (master)
 * window, this renders the clean deck full-screen on a second display (beamer)
 * with no chrome. It reuses the deck-controller as its render engine and
 * mirrors state from the master over a local `BroadcastChannel` — it never
 * navigates on its own and holds no presenter session.
 *
 * @param {HTMLElement} root
 * @param {string} id presentation id
 * @returns {Promise<() => void>} cleanup
 */
export async function renderPresentWindow(root, id) {
  const { langQs } = readDeckLangFromUrl();
  const pres = await api(`/api/presentations/${id}${langQs}`);
  const theme = await loadThemeById(pres?.theme);
  normalizeNotesStrings(pres);

  const shell = h('div', { class: 'present-window' });

  const { deck, stageWrap, stage } = createPresenterStageScaffold({ h, pres });
  shell.append(deck);
  root.append(shell);

  const detachStageScale = attachStageScale(stageWrap, stage, {
    baseW: 1600,
    baseH: 900,
  });

  const fullscreenCtl = createPresenterFullscreenController({ shell });
  const { toggleFullscreen, syncFullscreenClass } = fullscreenCtl;

  const animator = createPresenterAnimator();

  // Follower state seeded from the deck; the master's first `state` message is
  // authoritative.
  let stepParagraphs = !!pres?.settings?.stepParagraphs;
  // Reveal style (theme default → deck override); keeps the projector's builds
  // in sync with the presenter window.
  const revealStyle = resolveRevealStyle({ settings: pres?.settings, theme });
  // Session join codes, mirrored from the master so follow-invite/poll/feedback
  // slides render the same alternative codes on the beamer.
  let followCodes = null;

  const deckCtl = createPresenterDeckController({
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
    // No session, no local broadcasting: this window is a pure follower.
    onPostState: () => {},
    onStateChange: () => {},
    onSteps: () => {},
    onEdgeHint: () => {},
    getSessionReady: () => false,
    getFollowCodes: () => followCodes,
    getStepParagraphs: () => stepParagraphs,
    setStepParagraphs: (v) => {
      stepParagraphs = !!v;
    },
    getRevealStyle: () => revealStyle,
  });
  deckCtl.setStepModeEnabled(stepParagraphs);
  deckCtl.setPresentation(pres);

  // Display-only highlighter overlay: mirrors the master's laser/drawings so the
  // audience on the beamer sees the pointer. Never captures input.
  const highlighter = createPresenterHighlighter({
    stageWrap,
    stage,
    baseW: 1600,
    baseH: 900,
    interactive: false,
  });

  // --- Curtain (fullscreen needs a user gesture) + status ---------------
  const statusPill = h('div', {
    class: 'present-window-status pill',
    hidden: true,
    text: '',
  });
  const channel = createPresentChannel(id);
  const curtainBtn = h('button', {
    class: 'btn btn-primary',
    text: t('presentWindow.curtain.button', 'Present on this screen'),
    onclick: () => {
      toggleFullscreen();
      curtain.hidden = true;
      channel.sendHello();
    },
  });
  const curtain = h('div', { class: 'present-window-curtain' }, [
    h('div', { class: 'present-window-curtain-inner' }, [
      h('div', {
        class: 'present-window-curtain-title',
        text: pres?.title || t('presentWindow.title', 'Presentation'),
      }),
      h('div', {
        class: 'present-window-curtain-hint help',
        text: t(
          'presentWindow.curtain.hint',
          'Drag this window to the projector, then go full-screen. Navigate from the presenter window.'
        ),
      }),
      curtainBtn,
    ]),
  ]);
  shell.append(curtain, statusPill);

  // --- Sync channel ------------------------------------------------------
  channel.onState((state) => {
    statusPill.hidden = true;
    deckCtl.applyRemoteState(state);
  });
  channel.onHighlighter((ev) => highlighter.applyRemoteEvent(ev));
  channel.onCodes((codes) => {
    if (!codes || typeof codes !== 'object') return;
    // Only re-render when the codes actually change (avoid needless re-mounts).
    const sig = `${codes.nl || ''}|${codes.en || ''}`;
    if (sig === `${followCodes?.nl || ''}|${followCodes?.en || ''}`) return;
    followCodes = codes;
    const curId = deckCtl.getState()?.current?.id || '';
    deckCtl.setPresentation(pres, { keepCurrentSlideId: curId });
  });
  // If the master leaves, keep the last slide up but flag the disconnect.
  channel.onBye(() => {
    statusPill.textContent = t(
      'presentWindow.disconnected',
      'Presenter disconnected'
    );
    statusPill.hidden = false;
  });
  // Ask the master for the current state (covers opening mid-presentation).
  channel.sendHello();

  document.addEventListener('fullscreenchange', syncFullscreenClass);
  syncFullscreenClass();

  return () => {
    animator.cancel();
    try {
      highlighter.destroy();
    } catch {
      // ignore
    }
    try {
      cleanupSlideRuntimes(stage);
    } catch {
      // ignore
    }
    try {
      channel.close();
    } catch {
      // ignore
    }
    document.removeEventListener('fullscreenchange', syncFullscreenClass);
    document.documentElement.classList.remove('is-fullscreen');
    try {
      detachStageScale?.();
    } catch {
      // ignore
    }
    if (document.fullscreenElement) {
      try {
        const p = document.exitFullscreen && document.exitFullscreen();
        if (p?.catch) p.catch(() => {});
      } catch {
        // ignore
      }
    }
  };
}
