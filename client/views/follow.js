import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';
import { attachThumbScaleContain } from '../lib/thumb-scale.js';
import {
  cleanupSlideRuntimes,
} from '../lib/slide-render.js';
import { normalizeLang } from '../lib/i18n.js';
import { createAnalyticsTracker, isAnalyticsEnabled } from '../lib/analytics-tracker.js';
import { me } from '../lib/auth.js';
import {
  addMyQuestionId,
  getMyQuestionIds,
  getOrCreateQaUserId,
  getQaName,
  hasUpvoted,
  markUpvoted,
  removeMyQuestionId,
  setQaName,
} from '../lib/questions.js';
import {
  applyCardsVisibility,
  applyChartVisibility,
  applyFragmentsVisibility,
  getStepMode,
} from './presenter/step.js';
import { loadThemeById } from '../lib/theme.js';
import { createFollowQaController } from './follow/qa.js';
import { createFollowSse } from './follow/sse.js';
import { renderFollowLangButtons } from './follow/lang.js';
import { createFollowInteractionController } from './follow/interactions.js';
import { createFollowCopy } from './follow/i18n.js';
import { createUiModeSwitcher } from './ui-mode-switcher.js';
import { createTranslatingPoll } from './follow/translating-poll.js';
import { applyCapabilitiesToStage, showFollowMessage } from './follow/stage-ui.js';
import { renderFollowSlide } from './follow/render-slide.js';
import { createVideoLayer } from '../lib/video-layer.js';

export async function renderFollow(root, presentationId) {
  // Make presentation ID globally available for lead capture forms
  window.__PRESENTATION_ID__ = presentationId;

  const startUrl = new URL(location.href);
  let lang =
    normalizeLang(startUrl.searchParams.get('lang')) ||
    'nl';
  let meta = { dominantLang: null, availableLangs: [] };
  let copy = await createFollowCopy(lang);

  document.documentElement.classList.add('is-follow');

  const shell = h('div', { class: 'follow-shell' });
  const topbar = h('div', { class: 'follow-topbar' });
  const title = h('div', {
    class: 'follow-title',
    text: copy.title,
  });
  const langWrap = h('div', { class: 'follow-lang' });
  const actions = h('div', { class: 'follow-actions' });
  const uiMode = createUiModeSwitcher({ h, className: 'follow-ui-mode' });
  const status = h('div', {
    class: 'follow-status',
    text: copy.connecting,
  });
  actions.append(langWrap, uiMode.el);
  topbar.append(title, actions, status);

  const stageWrap = h('div', {
    class: 'follow-stage',
  });
  const slideWrap = h('div', { class: 'follow-slide thumb' });
  const interactionWrap = h('div', {
    class: 'follow-interaction',
    style: 'display:none;',
  });
  stageWrap.append(slideWrap, interactionWrap);

  const videoLayer = createVideoLayer({
    containerEl: stageWrap,
    getCurrentSlide: () => {
      if (!pres?.slides?.length) return null;
      return pres.slides[lastSlideIndex] || null;
    },
  });

  const qaWrap = h('div', { class: 'follow-qa' });
  const qaHeader = h('div', {
    class: 'row spread',
  });
  const qaTitle = h('div', {
    class: 'follow-qa-title',
    text: copy.qaTitle,
  });
  const qaActionsTop = h('div', {
    class: 'row',
  });
  const qaHint = h('div', { class: 'help', text: '' });
  const qaNameBtn = h('button', {
    class: 'btn btn-secondary follow-qa-name-btn',
    text: '',
  });
  qaActionsTop.append(qaNameBtn, qaHint);
  qaHeader.append(qaTitle, qaActionsTop);

  const qaInput = h('textarea', {
    class: 'form-input follow-qa-input',
    placeholder: copy.qaPlaceholder,
  });
  qaInput.addEventListener('keydown', (ev) => {
    // Submit on Enter (mobile-friendly). Keep Shift+Enter as a newline escape hatch.
    if (ev.key !== 'Enter') return;
    if (ev.shiftKey) return;
    // Avoid interfering with IME composition.
    if (ev.isComposing) return;
    ev.preventDefault();
    try {
      qaAskBtn.click();
    } catch {
      // ignore
    }
  });
  const qaAskBtn = h('button', {
    class: 'btn btn-primary',
    text: copy.qaAsk,
  });
  const qaForm = h('div', { class: 'follow-qa-form' }, [
    qaInput,
    qaAskBtn,
  ]);
  const qaList = h('div', { class: 'follow-qa-list' });
  // Put questions ABOVE the input (so your own question shows above the box after posting).
  qaWrap.append(qaHeader, qaList, qaForm);

  shell.append(topbar, stageWrap, qaWrap);
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
    const avail = Array.isArray(meta?.availableLangs) ? meta.availableLangs : [];
    renderFollowLangButtons({
      h,
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
      h,
      slideWrap,
      interactionWrap,
      cleanupSlideRuntimes,
      msg,
    });
  };

  const renderQuestions = () => qa?.renderQuestions?.();

  const refreshPresentationIfLive = async () => {
    const base = `/api/follow/${encodeURIComponent(
      presentationId
    )}/presentation`;
    const resp = await api(
      `${base}?lang=${encodeURIComponent(lang)}`
    );
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
        const msg = typeof copy.translatingWithProgress === 'function'
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
    theme = await loadThemeById(pres?.theme);
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
      me().then((user) => {
        if (user) {
          // User is logged in - don't track coworkers
          return;
        }
        // Anonymous viewer - initialize tracking
        analyticsTracker = createAnalyticsTracker({
          presentationId,
          sourceType: 'follow',
          sourceId: presentationId,
          viewerType: 'anonymous',
        });
        analyticsTracker.start();
      }).catch(() => {
        // On auth check failure, assume anonymous and track
        analyticsTracker = createAnalyticsTracker({
          presentationId,
          sourceType: 'follow',
          sourceId: presentationId,
          viewerType: 'anonymous',
        });
        analyticsTracker.start();
      });
    }
    // Also sync current slide/step state (helps initial render before SSE connects).
    lastSlideId = String(
      resp?.slideId || lastSlideId || ''
    );
    lastSlideType = String(resp?.slideType || lastSlideType || '');
    lastSlideIndex =
      Number(resp?.slideIndex ?? lastSlideIndex) || 0;
    lastStepIdx = Math.max(
      0,
      Number(resp?.stepIdx || 0) || 0
    );
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
        `/api/follow/${encodeURIComponent(
          presentationId
        )}/state`
      );
      if (resp?.status !== 'live') {
        pres = null;
        applyCapabilities(resp?.capabilities || null);
        status.textContent = '';
        if (resp?.status === 'not_started') {
          stopTranslatingPoll();
          showMessage(copy.notStarted);
        } else if (resp?.status === 'translating') {
          const msg = translatingInfo && typeof copy.translatingWithProgress === 'function'
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

  const refreshQuestionsIfLive = async () =>
    qa?.refreshQuestionsIfLive?.();

  // Initial load
  try {
    const ok = await refreshPresentationIfLive();
    if (ok) renderSlide();
  } catch {
    status.textContent = '';
    showMessage(copy.ended);
  }

  qa = createFollowQaController({
    h,
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
    h,
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
          data?.status === 'not_started'
            ? copy.notStarted
            : copy.ended
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
      if (lastSlideId && lastSlideId !== previousSlideId && analyticsTracker?.isTracking()) {
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
    try {
      uiMode.detach?.();
    } catch {}
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