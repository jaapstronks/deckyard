import { h } from '../../lib/dom.js';
import { createAutoAdvance } from '../presenter/auto-advance.js';
import { getSlideEffectiveDuration, DEFAULT_ADVANCE_INTERVAL_SECONDS } from '../../../shared/slide-timing.js';

/**
 * Wire up auto-advance for the share viewer: appends a progress bar to the
 * stage and returns a configured {@link createAutoAdvance} instance, or `null`
 * when auto-advance is disabled (or the deck is in presenter-only pacing mode).
 *
 * Navigation is delegated to the orchestrator via callbacks so this module owns
 * no viewer state.
 *
 * @param {object} opts
 * @param {object} opts.presentation
 * @param {HTMLElement} opts.stage - stage element to host the progress bar.
 * @param {() => void} opts.onAdvance - advance one slide.
 * @param {() => void} opts.onLoopReset - reset the deck to the first slide on loop.
 * @returns {object|null} the auto-advance instance, or null when inactive.
 */
export function setupShareAutoAdvance({ presentation, stage, onAdvance, onLoopReset }) {
  // Skip entirely in pacing mode — pacing is presenter-only.
  const cfg = presentation?.settings?.autoAdvance;
  const mode = cfg?.mode === 'pacing' ? 'pacing' : 'auto';
  const enabled = !!cfg?.enabled && mode === 'auto';
  if (!enabled) return null;

  const barEl = h('div', { class: 'auto-advance-bar' });
  const barFill = h('div', { class: 'auto-advance-bar-fill' });
  barEl.append(barFill);
  barEl.hidden = cfg?.showCountdown === false;
  stage.append(barEl);

  // Per-slide duration lookup
  const getSlideInterval = (idx) => {
    const slides = presentation.slides || [];
    return getSlideEffectiveDuration(slides[idx], cfg?.intervalSeconds || DEFAULT_ADVANCE_INTERVAL_SECONDS);
  };

  const instance = createAutoAdvance({
    onAdvance,
    onTick: (progress) => {
      barFill.style.width = `${(progress * 100).toFixed(1)}%`;
    },
    onStateChange: (s) => {
      barEl.classList.toggle('is-paused', s === 'paused');
    },
    onLoopComplete: () => {
      onLoopReset();
      instance?.onSlideChanged(0, (presentation.slides || []).length);
    },
  });
  instance.configure({
    intervalSeconds: cfg?.intervalSeconds || DEFAULT_ADVANCE_INTERVAL_SECONDS,
    loop: !!cfg?.loop,
    mode: 'auto',
    getSlideInterval,
  });
  return instance;
}
