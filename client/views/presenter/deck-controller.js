import { isSlideVisibleIn } from '../../../shared/slide-visibility.js';
import { morphTransition } from './morph-engine.js';

export function filterPresentSlides(presentation) {
  return (presentation?.slides || []).filter((s) => {
    // Skip disabled follow-invite slides (original behavior)
    if (
      s?.type === 'follow-invite-slide' &&
      s?.content &&
      typeof s.content === 'object' &&
      s.content.enabled === false
    ) {
      return false;
    }
    // Skip slides hidden in presentation mode
    return isSlideVisibleIn(s, 'presentation');
  });
}

export function normalizeNotesStrings(presentation) {
  // Back-compat: notes are optional; normalize to empty string
  for (const s of presentation?.slides || []) {
    if (!s || typeof s !== 'object') continue;
    if (typeof s.notes !== 'string') s.notes = '';
  }
}

export function createPresenterDeckController({
  h,
  api,
  presentationId,
  langQs = '',
  stage,
  theme,
  renderSlideElement,
  cleanupSlideRuntimes,
  animator,
  pauseVideoEmbeds,
  activateVideoEmbeds,
  step,
  progressText,
  progressFill,
  onEdgeHint,
  onPostState,
  onStateChange,
  onSteps,
  getSessionReady,
  getFollowCodes,
  getStepParagraphs,
  setStepParagraphs,
  getRevealStyle,
} = {}) {
  let pres = null;
  let presentSlides = [];
  let slides = [];
  let idx = 0;
  let stepIdx = 0;
  let cubeTransitionCancel = null;
  let morphTransitionCancel = null;

  const clamp = (n) => Math.max(0, Math.min(slides.length - 1, n));

  // In-deck card navigation: a card whose `link` targets another slide renders
  // an overlay anchor (see cardLinkOverlayHtml) — `data-card-nav-id="<slideId>"`
  // (stable, chosen via the editor picker) or the legacy positional
  // `data-card-nav="N"`. One delegated click listener resolves it to a slide
  // jump. It lives for the controller's lifetime (the stage element persists),
  // so no per-slide cleanup is needed.
  stage?.addEventListener?.('click', (e) => {
    const a = e.target?.closest?.('a[data-card-nav-id], a[data-card-nav]');
    if (!a || !stage.contains(a)) return;
    e.preventDefault();
    const navId = a.getAttribute('data-card-nav-id');
    if (navId) {
      const targetIdx = slides.findIndex(
        (sec) => sec?.getAttribute?.('data-slide-id') === navId
      );
      if (targetIdx >= 0) show(targetIdx);
      return;
    }
    const n = Number(a.getAttribute('data-card-nav'));
    if (Number.isFinite(n)) show(clamp(n - 1));
  });

  const getStageWrap = () => {
    try {
      return stage?.closest?.('.deck-stage') || null;
    } catch {
      return null;
    }
  };

  const syncSlidePositionClasses = (activeIdx) => {
    slides.forEach((s, j) => {
      s.classList.toggle('is-active', j === activeIdx);
      s.classList.toggle('is-prev', j === activeIdx - 1);
      s.classList.toggle('is-next', j === activeIdx + 1);
      s.classList.toggle('is-before', j < activeIdx);
      s.classList.toggle('is-after', j > activeIdx);
      s.classList.toggle('is-far', Math.abs(j - activeIdx) > 1);
    });
  };

  const mountSlides = () => {
    cleanupSlideRuntimes(stage);
    stage.innerHTML = '';
    slides = presentSlides.map((s) => {
      const section = h('section', {
        class: 'deck-slide',
        'data-slide-id': s.id,
      });
      
      // Pass follow codes for follow-invite slides during presentations
      const renderOptions = { theme, mode: 'present' };
      // Also pass `presentationId` so slides can render follow URLs/QR codes.
      renderOptions.presentationId = presentationId;
      if (
        s?.type === 'follow-invite-slide' ||
        s?.type === 'poll-slide' ||
        s?.type === 'feedback-slide'
      ) {
        const followCodes = getFollowCodes?.();
        if (followCodes) {
          renderOptions.followCodes = followCodes;
        }
      }
      
      section.append(renderSlideElement(s, renderOptions));
      return section;
    });
    for (const s of slides) stage.append(s);
  };

  const applyStepToSection = (section) => {
    const stepParagraphsVal = !!getStepParagraphs?.();
    const mode = step.getStepMode(section);
    if (!stepParagraphsVal || !mode) {
      stepIdx = Number.POSITIVE_INFINITY;
      step.applyFragmentsVisibility(section, Number.POSITIVE_INFINITY);
      step.applyCardsVisibility(section, Number.POSITIVE_INFINITY);
      step.applyChartVisibility(section, Number.POSITIVE_INFINITY);
      step.applyImageZoomStep(section, 0); // Reset zoom
      // Mark section as ready (CSS flash prevention uses this)
      section.classList.add('sb-steps-ready');
      return;
    }
    if (mode === 'image-zoom') {
      step.applyFragmentsVisibility(section, Number.POSITIVE_INFINITY);
      step.applyCardsVisibility(section, Number.POSITIVE_INFINITY);
      step.applyChartVisibility(section, Number.POSITIVE_INFINITY);
      step.applyImageZoomStep(section, stepIdx);
    } else if (mode === 'body') {
      step.applyCardsVisibility(section, Number.POSITIVE_INFINITY);
      step.applyChartVisibility(section, Number.POSITIVE_INFINITY);
      step.applyImageZoomStep(section, 0);
      step.applyFragmentsVisibility(section, stepIdx);
    } else if (mode === 'cards') {
      step.applyFragmentsVisibility(section, Number.POSITIVE_INFINITY);
      step.applyChartVisibility(section, Number.POSITIVE_INFINITY);
      step.applyImageZoomStep(section, 0);
      step.applyCardsVisibility(section, stepIdx);
    } else if (mode === 'chart') {
      step.applyFragmentsVisibility(section, Number.POSITIVE_INFINITY);
      step.applyCardsVisibility(section, Number.POSITIVE_INFINITY);
      step.applyImageZoomStep(section, 0);
      step.applyChartVisibility(section, stepIdx);
    }
    // Mark section as ready (CSS flash prevention uses this)
    section.classList.add('sb-steps-ready');
  };

  // Highest valid stepIdx for a section: the point at which every fragment/
  // card/zoom step is revealed. Mirrors the per-mode caps used in next().
  const getMaxStepIdx = (section) => {
    const mode = step.getStepMode(section);
    if (!mode) return 0;
    if (mode === 'image-zoom')
      return step.collectImageZoomSteps(section).length;
    if (mode === 'body')
      return step.collectFragmentsForSlide(section).length;
    if (mode === 'cards') return step.collectCardsForSlide(section).length;
    if (mode === 'chart')
      return step.collectChartFragmentsForSlide(section).length;
    return 0;
  };

  // When entering a slide, decide where its build should start. Going forward
  // (or non-stepped) starts empty; going backward lands fully revealed so a
  // presenter who overshot only pays one "back" press, not a full rebuild.
  const resolveInitialStepIdx = (section, direction) => {
    if (direction === 'backward' && !!getStepParagraphs?.()) {
      return getMaxStepIdx(section);
    }
    return 0;
  };

  // Subtle "that was the last build" settle on the active slide. Non-blocking:
  // the next forward press still advances normally.
  let pulseTid = null;
  const pulseStepComplete = (section) => {
    if (!section) return;
    try {
      if (pulseTid) clearTimeout(pulseTid);
    } catch {}
    section.classList.remove('sb-step-complete');
    // Force reflow so re-adding the class restarts the animation.
    void section.offsetWidth;
    section.classList.add('sb-step-complete');
    pulseTid = setTimeout(() => {
      try {
        section.classList.remove('sb-step-complete');
      } catch {}
      pulseTid = null;
    }, 520);
  };

  // Report current build state so the presenter UI can show a remaining-steps
  // indicator (how many builds are still hidden on this slide).
  const reportSteps = () => {
    const section = slides?.[idx];
    if (!section) {
      onSteps?.({ shown: 0, total: 0 });
      return;
    }
    const enabled = !!getStepParagraphs?.();
    const mode = enabled ? step.getStepMode(section) : null;
    if (!mode) {
      onSteps?.({ shown: 0, total: 0 });
      return;
    }
    const total = getMaxStepIdx(section);
    const shown = Math.max(0, Math.min(Number(stepIdx) || 0, total));
    onSteps?.({ shown, total });
  };

  // Local (session-independent) notification that navigation/step state changed.
  // Unlike post() this always fires, so the two-window projector stays in sync
  // even when there's no SSE present-session.
  const notifyStateChange = () => {
    onStateChange?.({
      slideIndex: idx,
      stepIdx,
      stepParagraphs: !!getStepParagraphs?.(),
    });
  };

  // Post session state (may no-op if no session), broadcast local state, and
  // always refresh step UI.
  const afterChange = () => {
    post();
    notifyStateChange();
    reportSteps();
  };

  const syncProgressUi = () => {
    if (progressText)
      progressText.textContent = `${idx + 1} / ${slides.length}`;
    if (progressFill) {
      progressFill.style.width = slides.length
        ? `${((idx + 1) / slides.length) * 100}%`
        : '0%';
    }
  };

  const post = () => {
    const current = presentSlides?.[idx];
    if (!current) return;
    if (!getSessionReady?.()) return;
    onPostState?.({
      slideId: current.id,
      slideIndex: idx,
      stepIdx,
      stepParagraphs: !!getStepParagraphs?.(),
    });
  };

  const show = (i, { direction = 'forward' } = {}) => {
    const prevSection = slides?.[idx] || null;
    const nextIdx = clamp(i);
    const stageWrap = getStageWrap();
    const preset = String(stageWrap?.dataset?.slideTransition || '').trim();

    // Cancel any in-flight morph transition.
    if (typeof morphTransitionCancel === 'function') {
      try { morphTransitionCancel(); } catch {}
      morphTransitionCancel = null;
    }

    // Morph transition: FLIP-based element morphing between slides.
    if (preset === 'morph' && nextIdx !== idx && stageWrap) {
      const fromSection = slides[idx];
      const toSection = slides[nextIdx];

      let cancelled = false;
      morphTransitionCancel = () => { cancelled = true; };

      morphTransition(fromSection, toSection, stage, {
        onCancel: () => cancelled,
      }).then(() => {
        morphTransitionCancel = null;
        idx = nextIdx;
        syncSlidePositionClasses(idx);
        syncProgressUi();

        const section = slides[idx];
        stepIdx = resolveInitialStepIdx(section, direction);
        applyStepToSection(section);
        animator.runSlideAnimations(section);

        if (prevSection && prevSection !== section)
          pauseVideoEmbeds(prevSection);
        activateVideoEmbeds(section);

        afterChange();
      });

      return;
    }

    // Special case: cube transition needs a two-phase state so faces align like a cube,
    // instead of instantly switching which slide is "active".
    if (preset === 'cube' && nextIdx !== idx && stageWrap) {
      // Cancel any in-flight cube transition.
      if (typeof cubeTransitionCancel === 'function') {
        try {
          cubeTransitionCancel();
        } catch {
          // ignore
        }
      }
      cubeTransitionCancel = null;

      const dir = nextIdx > idx ? 'next' : 'prev';
      stageWrap.dataset.cubeDir = dir;
      stageWrap.dataset.cubePhase = 'prep';
      stageWrap.classList.add('is-cube-animating');

      // Prep classes based on the current slide index (outgoing is active; incoming is neighbor).
      syncSlidePositionClasses(idx);

      const incoming =
        dir === 'next' ? slides[idx + 1] : slides[idx - 1];
      const outgoing = slides[idx] || null;

      // Force style flush so moving to "go" reliably triggers transitions.
      // eslint-disable-next-line no-unused-expressions
      stageWrap.offsetWidth;

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        stageWrap.classList.remove('is-cube-animating');
        delete stageWrap.dataset.cubePhase;
        delete stageWrap.dataset.cubeDir;
        idx = nextIdx;
        syncSlidePositionClasses(idx);
        syncProgressUi();

        // Reset stepping when a new slide is shown (backward lands revealed).
        const section = slides[idx];
        stepIdx = resolveInitialStepIdx(section, direction);
        applyStepToSection(section);
        animator.runSlideAnimations(section);

        if (prevSection && prevSection !== section)
          pauseVideoEmbeds(prevSection);
        activateVideoEmbeds(section);

        afterChange();
      };

      const onEnd = (e) => {
        // Only care about the main transform transition on either incoming/outgoing slide section.
        if (e?.propertyName !== 'transform') return;
        if (e?.target !== incoming && e?.target !== outgoing) return;
        finish();
      };

      stageWrap.addEventListener('transitionend', onEnd);
      const tid = setTimeout(() => finish(), 900);
      cubeTransitionCancel = () => {
        try {
          clearTimeout(tid);
        } catch {}
        try {
          stageWrap.removeEventListener('transitionend', onEnd);
        } catch {}
        try {
          stageWrap.classList.remove('is-cube-animating');
          delete stageWrap.dataset.cubePhase;
          delete stageWrap.dataset.cubeDir;
        } catch {}
      };

      requestAnimationFrame(() => {
        try {
          stageWrap.dataset.cubePhase = 'go';
        } catch {
          // ignore
        }
      });

      return;
    }

    idx = nextIdx;
    syncSlidePositionClasses(idx);
    syncProgressUi();

    // Reset stepping when a new slide is shown (backward lands revealed).
    const section = slides[idx];
    stepIdx = resolveInitialStepIdx(section, direction);
    applyStepToSection(section);

    animator.runSlideAnimations(section);

    // Video safety: make sure videos can't keep playing when their slide isn't active.
    // Also enables autoplay only when the slide becomes active.
    if (prevSection && prevSection !== section) pauseVideoEmbeds(prevSection);
    activateVideoEmbeds(section);

    afterChange();
  };

  const showEdgeHint = (msg) => onEdgeHint?.(msg);

  const next = () => {
    const section = slides[idx];
    const stepParagraphsVal = !!getStepParagraphs?.();
    if (stepParagraphsVal) {
      const mode = step.getStepMode(section);
      if (mode === 'image-zoom') {
        // Image zoom: step 0 = full view, steps 1+ = zoom positions
        const zoomSteps = step.collectImageZoomSteps(section);
        // Total steps = zoomSteps.length + 1 (full view + each position)
        const totalSteps = zoomSteps.length + 1;
        if (stepIdx < totalSteps - 1) {
          stepIdx += 1;
          step.applyImageZoomStep(section, stepIdx);
          if (stepIdx >= totalSteps - 1) pulseStepComplete(section);
          afterChange();
          return;
        }
      }
      if (mode === 'body') {
        const frags = step.collectFragmentsForSlide(section);
        if (stepIdx < frags.length) {
          stepIdx += 1;
          step.applyFragmentsVisibility(section, stepIdx);
          // Typewriter-reveal the bullet we just showed, when the deck's reveal
          // style asks for it (theme/deck default). Instant otherwise; the
          // animator no-ops under reduced motion and for rich fragments.
          if (getRevealStyle?.() === 'typewriter') {
            animator.typewrite?.(frags[stepIdx - 1]);
          }
          if (stepIdx >= frags.length) pulseStepComplete(section);
          afterChange();
          return;
        }
      }
      if (mode === 'cards') {
        const cards = step.collectCardsForSlide(section);
        if (stepIdx < cards.length) {
          stepIdx += 1;
          step.applyCardsVisibility(section, stepIdx);
          if (stepIdx >= cards.length) pulseStepComplete(section);
          afterChange();
          return;
        }
      }
      if (mode === 'chart') {
        const frags = step.collectChartFragmentsForSlide(section);
        if (stepIdx < frags.length) {
          stepIdx += 1;
          step.applyChartVisibility(section, stepIdx);
          if (stepIdx >= frags.length) pulseStepComplete(section);
          afterChange();
          return;
        }
      }
    }
    if (idx >= slides.length - 1) {
      showEdgeHint('Einde van de presentatie.');
      return;
    }
    show(idx + 1);
  };

  // Power-user reveal: show every remaining build on the current slide at once.
  // Returns false when there's nothing to reveal (no steps / already complete),
  // so callers can fall back to advancing the slide.
  const revealAll = () => {
    const section = slides[idx];
    if (!getStepParagraphs?.()) return false;
    const mode = step.getStepMode(section);
    if (!mode) return false;
    const max = getMaxStepIdx(section);
    if (stepIdx >= max) return false;
    stepIdx = max;
    applyStepToSection(section);
    pulseStepComplete(section);
    afterChange();
    return true;
  };

  // Inverse of revealAll: collapse the current slide's build back to empty.
  // Returns false when nothing is revealed, so callers can step back a slide.
  const collapseAll = () => {
    const section = slides[idx];
    if (!getStepParagraphs?.()) return false;
    const mode = step.getStepMode(section);
    if (!mode || stepIdx <= 0) return false;
    stepIdx = 0;
    applyStepToSection(section);
    afterChange();
    return true;
  };

  const prev = () => {
    const section = slides[idx];
    const stepParagraphsVal = !!getStepParagraphs?.();
    if (stepParagraphsVal) {
      const mode = step.getStepMode(section);
      if (mode === 'image-zoom' && stepIdx > 0) {
        stepIdx -= 1;
        step.applyImageZoomStep(section, stepIdx);
        afterChange();
        return;
      }
      if (mode === 'body' && stepIdx > 0) {
        stepIdx -= 1;
        step.applyFragmentsVisibility(section, stepIdx);
        afterChange();
        return;
      }
      if (mode === 'cards' && stepIdx > 0) {
        stepIdx -= 1;
        step.applyCardsVisibility(section, stepIdx);
        afterChange();
        return;
      }
      if (mode === 'chart' && stepIdx > 0) {
        stepIdx -= 1;
        step.applyChartVisibility(section, stepIdx);
        afterChange();
        return;
      }
    }
    show(idx - 1, { direction: 'backward' });
  };

  const setPresentation = (nextPres, { keepCurrentSlideId = '' } = {}) => {
    pres = nextPres;
    normalizeNotesStrings(pres);
    presentSlides = filterPresentSlides(pres);
    mountSlides();
    const nextIdx = keepCurrentSlideId
      ? presentSlides.findIndex((s) => s?.id === keepCurrentSlideId)
      : -1;
    idx = nextIdx >= 0 ? nextIdx : clamp(idx);
    show(idx);
  };

  const refreshDeck = async () => {
    const currentId = presentSlides?.[idx]?.id || '';
    try {
      const nextPres = await api(
        `/api/presentations/${presentationId}${langQs}`
      );
      normalizeNotesStrings(nextPres);
      pres = nextPres;
      presentSlides = filterPresentSlides(pres);
      mountSlides();
      const nextIdx = currentId
        ? presentSlides.findIndex((s) => s?.id === currentId)
        : -1;
      idx = nextIdx >= 0 ? nextIdx : clamp(idx);
      show(idx);
    } catch {
      // ignore
    }
  };

  const setStepModeEnabled = (enabled) => {
    const next = !!enabled;
    setStepParagraphs?.(next);
    // Re-apply to current slide: enabling starts at 0; disabling shows all.
    const section = slides?.[idx];
    if (!section) return;
    const mode = step.getStepMode(section);
    if (!next || !mode) {
      stepIdx = 0;
      applyStepToSection(section);
      afterChange();
      return;
    }
    stepIdx = 0;
    applyStepToSection(section);
    afterChange();
  };

  const getState = () => ({
    idx,
    stepIdx,
    slidesCount: slides.length,
    current: presentSlides?.[idx] || null,
    next: presentSlides?.[idx + 1] || null,
    presentation: pres,
  });

  // Mirror an authoritative state from another window (two-window projector).
  // On a slide change we delegate to show({direction}), whose natural step reset
  // matches how the master itself resets on a jump; on a same-slide update we
  // set the exact stepIdx and re-apply. Same-slide updates never trigger a
  // transition, so there's no async race with morph/cube. Does not re-broadcast
  // (this window is a follower, not a source of truth).
  const applyRemoteState = ({
    slideIndex,
    stepIdx: remoteStepIdx,
    stepParagraphs: remoteStepParagraphs,
  } = {}) => {
    setStepParagraphs?.(!!remoteStepParagraphs);
    const target = clamp(Number(slideIndex) || 0);
    if (target !== idx) {
      show(target, {
        direction: target >= idx ? 'forward' : 'backward',
      });
      return;
    }
    const section = slides?.[idx];
    if (!section) return;
    stepIdx = Number.isFinite(remoteStepIdx)
      ? remoteStepIdx
      : Number.POSITIVE_INFINITY;
    applyStepToSection(section);
    reportSteps();
  };

  return {
    setPresentation,
    refreshDeck,
    show,
    next,
    prev,
    revealAll,
    collapseAll,
    setStepModeEnabled,
    applyRemoteState,
    getState,
  };
}
