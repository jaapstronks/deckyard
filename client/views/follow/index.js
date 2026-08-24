/**
 * Follow-along (audience) view.
 *
 * This is the public seam for the follow view; it owns the live session state
 * machine and composes the concern modules beside it in this folder (layout,
 * sse, qa, interactions, lang, render-slide, stage-ui, translating-poll, i18n).
 */

import { api } from '../../lib/api.js';
import { disposeAll } from '../../lib/dom/disposal.js';
import { attachThumbScaleContain } from '../../lib/slide-runtime/thumb-scale.js';
import { cleanupSlideRuntimes } from '../../lib/slide-runtime/slide-render.js';
import { normalizeLang } from '../../lib/format/i18n.js';
import {
  createAnalyticsTracker,
  isAnalyticsEnabled,
} from '../../lib/format/analytics-tracker.js';
import { createEraseMyDataButton } from '../../lib/format/analytics-erase-button.js';
import { me } from '../../lib/user/auth.js';
import {
  addMyQuestionId,
  getMyQuestionIds,
  getQaName,
  hasUpvoted,
  markUpvoted,
  removeMyQuestionId,
  setQaName,
} from '../../lib/slide-runtime/questions.js';
import { loadThemeById } from '../../lib/theme/theme.js';
import { createFollowQaController } from './qa.js';
import { createFollowSse } from './sse.js';
import { renderFollowLangButtons } from './lang.js';
import { createFollowInteractionController } from './interactions.js';
import { createFollowCopy } from './i18n.js';
import { createTranslatingPoll } from './translating-poll.js';
import { applyCapabilitiesToStage, showFollowMessage } from './stage-ui.js';
import { renderFollowSlide } from './render-slide.js';
import { createVideoLayer } from '../../lib/slide-runtime/video-layer.js';
import { buildFollowLayout } from './layout.js';

export async function renderFollow(root, presentationId) {
  const startUrl = new URL(location.href);
  let lang = normalizeLang(startUrl.searchParams.get('lang')) || 'nl';
  let meta = { dominantLang: null, availableLangs: [] };
  let copy = await createFollowCopy(lang);

  document.documentElement.classList.add('is-follow');

  const {
    shell,
    title,
    langWrap,
    eraseSlot,
    status,
    uiMode,
    stageWrap,
    slideWrap,
    interactionWrap,
    qaWrap,
    qaTitle,
    qaHint,
    qaNameBtn,
    qaInput,
    qaAskBtn,
    qaList,
  } = buildFollowLayout({ getCopy: () => copy });

  const videoLayer = createVideoLayer({
    containerEl: stageWrap,
    getCurrentSlide: () => {
      if (!pres?.slides?.length) return null;
      return pres.slides[lastSlideIndex] || null;
    },
  });

  root.append(shell);

  // Contain, not the width-driven scale: the audience view is the one place a
  // slide has to share the screen with the Q&A panel, and a width-driven thumb
  // claims the stage's full height while the 16:9 slide only occupies a band
  // of it. Containing sizes the box to the slide itself, so on a phone the
  // Q&A rises to meet it instead of sitting below a dead area.
  let detachThumb = () => {};
  detachThumb = attachThumbScaleContain(slideWrap, {
    virtualWidth: 1600,
    virtualHeight: 900,
    containerEl: stageWrap,
    padding: 0,
  });

  let pres = null;
  let theme = null;
  let sse = null;
  let lastSlideId = '';
  let lastSlideIndex = 0;
  let lastSlideType = '';
  let capabilities = null;
  let lastStepIdx = 0;
  let lastStepParagraphs = false;
  let stateRefreshTid = null;
  let translatingPoll = null;
  let qa = null;
  let interactions = null;
  let translatingInfo = null; // { lang, missing, jobStatus }
  let analyticsTracker = null;
  let analyticsChecked = false; // Whether we've checked auth status for analytics

  const stopTranslatingPoll = () => translatingPoll?.stop?.();
  const ensureTranslatingPoll = () => translatingPoll?.ensure?.();

  // (Re)build the "forget me" button from the current deck-language copy and
  // drop it into its topbar slot. Called when tracking starts and again on a
  // live language switch so the label follows the deck language. Nulls the
  // tracker after a successful erase so it is not rebuilt for a dead session.
  const mountEraseButton = () => {
    if (!analyticsTracker) return;
    const eraseBtn = createEraseMyDataButton({
      tracker: analyticsTracker,
      labels: copy.erase,
      onErased: () => {
        analyticsTracker = null;
        eraseSlot.replaceChildren();
      },
    });
    if (eraseBtn) eraseSlot.replaceChildren(eraseBtn);
  };

  // Start anonymous analytics tracking and surface the erase control. Runs once,
  // only for a viewer we could not identify as logged in.
  const startAnonymousTracking = () => {
    analyticsTracker = createAnalyticsTracker({
      presentationId,
      sourceType: 'follow',
      sourceId: presentationId,
      viewerType: 'anonymous',
    });
    analyticsTracker.start();
    mountEraseButton();
  };

  const getTranslatingLang = () => {
    const ts = meta?.translationStatus;
    if (!ts) return null;
    const otherLang = lang === 'nl' ? 'en-GB' : 'nl';
    const status = ts[otherLang];
    if (!status) return null;
    if (status.complete) return null;
    return otherLang;
  };

  const renderLangButtons = () => {
    const avail = Array.isArray(meta?.availableLangs)
      ? meta.availableLangs
      : [];
    renderFollowLangButtons({
      langWrap,
      currentLang: lang,
      availableLangs: avail,
      translatingLang: getTranslatingLang(),
      onSelect: async (code) => {
        lang = code;
        copy = await createFollowCopy(lang);
        title.textContent = copy.title;
        qaTitle.textContent = copy.qaTitle;
        qaAskBtn.textContent = copy.qaAsk;
        qaInput.placeholder = copy.qaPlaceholder;
        mountEraseButton();
        qa?.syncQaNameBtn?.();
        qa?.renderQuestions?.();
        try {
          const u = new URL(location.href);
          u.searchParams.set('lang', lang);
          history.replaceState(null, '', u.toString());
        } catch {
          // ignore
        }
        pres = null;
        try {
          const ok = await refreshPresentationIfLive();
          if (ok) renderSlide();
        } catch {
          // ignore
        }
        renderLangButtons();
      },
    });
  };

  const renderSlide = () =>
    renderFollowSlide({
      pres,
      theme,
      slideWrap,
      interactionWrap,
      capabilities,
      statusEl: status,
      lastSlideId,
      lastSlideIndex,
      lastStepIdx,
      lastStepParagraphs,
      followInviteMessage: copy.followInviteSuccess,
    });

  const applyCapabilities = (next) => {
    capabilities = next && typeof next === 'object' ? next : null;
    qa?.setCapabilities?.(capabilities);
    interactions?.setCapabilities?.(capabilities);
    applyCapabilitiesToStage({ capabilities, slideWrap, interactionWrap });
  };

  const showMessage = (msg) => {
    showFollowMessage({
      slideWrap,
      interactionWrap,
      cleanupSlideRuntimes,
      msg,
    });
  };

  const refreshPresentationIfLive = async () => {
    const base = `/api/follow/${encodeURIComponent(
      presentationId,
    )}/presentation`;
    const resp = await api(`${base}?lang=${encodeURIComponent(lang)}`);
    if (resp?.status !== 'live') {
      pres = null;
      if (resp?.status === 'not_started') {
        stopTranslatingPoll();
        status.textContent = '';
        showMessage(copy.notStarted);
      } else if (resp?.status === 'translating') {
        status.textContent = '';
        translatingInfo = {
          lang: resp?.lang,
          missing: resp?.missing,
          jobStatus: resp?.job?.status,
        };
        const msg =
          typeof copy.translatingWithProgress === 'function'
            ? copy.translatingWithProgress(translatingInfo)
            : copy.translating;
        showMessage(msg);
        ensureTranslatingPoll();
      } else {
        stopTranslatingPoll();
        status.textContent = '';
        showMessage(copy.ended);
      }
      return false;
    }
    pres = resp.presentation;
    // The theme comes with the payload the follow code authorizes; the
    // login-gated config route answers 401 to this anonymous audience.
    theme = await loadThemeById(pres?.theme, { config: pres?.themeConfig });
    meta = resp?.meta || meta;
    applyCapabilities(resp?.capabilities || null);
    stopTranslatingPoll();
    translatingInfo = null;

    // Configure video layer from presentation settings
    videoLayer.setConfig(pres?.settings?.liveVideo);

    // Initialize analytics tracking (only once, and only for non-logged-in users)
    // We skip tracking for logged-in users to protect coworker privacy
    if (!analyticsTracker && !analyticsChecked && isAnalyticsEnabled(pres)) {
      analyticsChecked = true;
      // Check if user is logged in - if so, skip tracking
      me()
        .then((user) => {
          if (user) {
            // User is logged in - don't track coworkers
            return;
          }
          // Anonymous viewer - initialize tracking
          startAnonymousTracking();
        })
        .catch(() => {
          // On auth check failure, assume anonymous and track
          startAnonymousTracking();
        });
    }
    // Also sync current slide/step state (helps initial render before SSE connects).
    lastSlideId = String(resp?.slideId || lastSlideId || '');
    lastSlideType = String(resp?.slideType || lastSlideType || '');
    lastSlideIndex = Number(resp?.slideIndex ?? lastSlideIndex) || 0;
    lastStepIdx = Math.max(0, Number(resp?.stepIdx || 0) || 0);
    lastStepParagraphs = !!resp?.stepParagraphs;
    interactions?.setSlideContext?.({
      slideId: lastSlideId,
      slideType: lastSlideType,
    });
    renderLangButtons();
    return true;
  };

  translatingPoll = createTranslatingPoll({
    refreshPresentationIfLive,
    onUpdated: () => renderSlide(),
    intervalMs: 1500,
  });

  const refreshStateIfLive = async () => {
    try {
      const resp = await api(
        `/api/follow/${encodeURIComponent(presentationId)}/state`,
      );
      if (resp?.status !== 'live') {
        pres = null;
        applyCapabilities(resp?.capabilities || null);
        status.textContent = '';
        if (resp?.status === 'not_started') {
          stopTranslatingPoll();
          showMessage(copy.notStarted);
        } else if (resp?.status === 'translating') {
          const msg =
            translatingInfo &&
            typeof copy.translatingWithProgress === 'function'
              ? copy.translatingWithProgress(translatingInfo)
              : copy.translating;
          showMessage(msg);
          ensureTranslatingPoll();
        } else {
          stopTranslatingPoll();
          showMessage(copy.ended);
        }
        return false;
      }
      applyCapabilities(resp?.capabilities || null);
      const nextSlideId = String(resp?.slideId || '');
      const nextSlideType = String(resp?.slideType || lastSlideType || '');
      const nextSlideIndex = Number(resp?.slideIndex ?? lastSlideIndex) || 0;
      const nextStepIdx = Math.max(0, Number(resp?.stepIdx || 0) || 0);
      const nextStepParagraphs = !!resp?.stepParagraphs;
      const changed =
        nextSlideId !== lastSlideId ||
        nextSlideType !== lastSlideType ||
        nextSlideIndex !== lastSlideIndex ||
        nextStepIdx !== lastStepIdx ||
        nextStepParagraphs !== lastStepParagraphs;
      lastSlideId = nextSlideId;
      lastSlideType = nextSlideType;
      lastSlideIndex = nextSlideIndex;
      lastStepIdx = nextStepIdx;
      lastStepParagraphs = nextStepParagraphs;
      interactions?.setSlideContext?.({
        slideId: lastSlideId,
        slideType: lastSlideType,
      });
      if (!pres) {
        const ok = await refreshPresentationIfLive();
        if (!ok) return false;
        renderSlide();
        return true;
      }
      // Only remount the slide DOM when something actually changed; this
      // poll used to rebuild the slide (and restart video embeds) every tick.
      if (changed) renderSlide();
      return true;
    } catch {
      return false;
    }
  };

  const refreshQuestionsIfLive = async () => qa?.refreshQuestionsIfLive?.();

  // Initial load
  try {
    const ok = await refreshPresentationIfLive();
    if (ok) renderSlide();
  } catch {
    status.textContent = '';
    showMessage(copy.ended);
  }

  qa = createFollowQaController({
    api,
    presentationId,
    qaWrap,
    qaHint,
    qaNameBtn,
    qaInput,
    qaAskBtn,
    qaList,
    getLang: () => lang,
    getCopy: () => copy,
    onCapabilities: applyCapabilities,
    questionsApi: {
      addMyQuestionId,
      getMyQuestionIds,
      getQaName,
      hasUpvoted,
      markUpvoted,
      removeMyQuestionId,
      setQaName,
    },
  });

  interactions = createFollowInteractionController({
    api,
    presentationId,
    mountEl: interactionWrap,
    getLang: () => lang,
    getCopy: () => copy,
    onCapabilities: applyCapabilities,
  });

  // Initial questions (only meaningful when Q&A is enabled for the current slide/capabilities.)
  refreshQuestionsIfLive().catch(() => {});

  sse = createFollowSse({
    presentationId,
    getCopy: () => copy,
    statusEl: status,
    onStatusEvent: (data) => {
      if (data?.capabilities) applyCapabilities(data.capabilities);
      if (data?.status !== 'live') {
        pres = null;
        status.textContent = '';
        showMessage(
          data?.status === 'not_started' ? copy.notStarted : copy.ended,
        );
      }
    },
    onStateEvent: async (data) => {
      const previousSlideId = lastSlideId;
      lastSlideId = String(data?.slideId || '');
      lastSlideIndex = Number(data?.slideIndex || 0) || 0;
      lastSlideType = String(data?.slideType || '');
      lastStepIdx = Math.max(0, Number(data?.stepIdx || 0) || 0);
      lastStepParagraphs = !!data?.stepParagraphs;

      // Track slide change
      if (
        lastSlideId &&
        lastSlideId !== previousSlideId &&
        analyticsTracker?.isTracking()
      ) {
        analyticsTracker.trackSlide(lastSlideId, lastSlideIndex);
      }

      // Keep the status indicator useful even while the interaction UI is active.
      // (renderSlide() early-returns in interaction mode.)
      if (pres?.slides?.length)
        status.textContent = `${lastSlideIndex + 1} / ${pres.slides.length}`;
      interactions?.setSlideContext?.({
        slideId: lastSlideId,
        slideType: lastSlideType,
      });
      if (!pres) {
        const ok = await refreshPresentationIfLive();
        if (!ok) return;
      }
      renderSlide();
      videoLayer.updatePosition();
    },
    onInteractionStateEvent: (data) => {
      interactions?.onInteractionStateEvent?.(data);
    },
    onDeckUpdatedEvent: async () => {
      // Deck content changed mid-session (live edit, API, MCP): drop the
      // cached deck and re-fetch so the current slide reflects the change.
      try {
        const ok = await refreshPresentationIfLive();
        if (ok) renderSlide();
      } catch {}
    },
  });
  sse.connect();

  // Start/stop Q&A subsystem based on capabilities.
  // (This also creates the polling safety-net only when Q&A is visible.)
  applyCapabilities(capabilities);

  // Safety net: periodically refresh presenter state so slide updates still work
  // even if SSE is blocked/wedged on some devices/browsers. Skipped while the
  // SSE stream is demonstrably healthy, so a healthy audience doesn't add
  // polling load on top of the push channel.
  stateRefreshTid = setInterval(() => {
    if (sse?.isHealthy?.()) return;
    refreshStateIfLive().catch(() => {});
  }, 2500);
  stateRefreshTid.unref?.();

  return () => {
    document.documentElement.classList.remove('is-follow');
    disposeAll([() => uiMode.detach?.()]);
    cleanupSlideRuntimes(slideWrap);
    try {
      detachThumb();
    } catch {}
    detachThumb = () => {};
    sse?.destroy?.();
    sse = null;
    qa?.destroy?.();
    qa = null;
    interactions?.destroy?.();
    interactions = null;
    if (stateRefreshTid) {
      try {
        clearInterval(stateRefreshTid);
      } catch {}
      stateRefreshTid = null;
    }
    stopTranslatingPoll();
    videoLayer.destroy();
    // Clean up analytics tracker
    if (analyticsTracker) {
      analyticsTracker.destroy();
      analyticsTracker = null;
    }
  };
}
