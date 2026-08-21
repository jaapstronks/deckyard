/**
 * Presenter auto-advance UI wiring.
 *
 * Owns everything that turns the deck's auto-advance/pacing config into
 * on-screen behaviour: the countdown bar over the stage, the deck-time readout
 * in the progress area, and the pause/resume toolbar button's label + handler.
 * The underlying timer engine is `auto-advance.js`; this module only builds the
 * chrome around it and connects it to the deck.
 *
 * Lifted out of `renderPresenter` as a P4 seam (docs/plans/TODO.md B10). It is a
 * behaviour-preserving move: the deck is reached through the `getDeck` thunk
 * (the controller is created after this factory runs, exactly as before), the
 * shared pause button and edge-hint controller are passed in, and the two
 * escaping handles — the `autoAdvance` timer and `syncProgressTime` — are
 * returned for the deck/session wiring to drive.
 */

import { t } from '../../lib/ui-i18n.js';
import { createAutoAdvance } from './auto-advance.js';
import {
  calculateDeckTime,
  getSlideEffectiveDuration,
  DEFAULT_ADVANCE_INTERVAL_SECONDS,
} from '../../../shared/slide-timing.js';
import { h } from '../../lib/dom.js';

/**
 * @param {object} ctx
 * @param {object} ctx.pres
 * @param {object} [ctx.autoAdvanceCfg] `pres.settings.autoAdvance`.
 * @param {boolean} ctx.autoAdvanceEnabled
 * @param {'auto'|'pacing'} ctx.autoAdvanceMode
 * @param {HTMLButtonElement} ctx.autoAdvanceBtn Pre-built toolbar pause button.
 * @param {HTMLElement} ctx.progress Progress area; the time readout mounts here.
 * @param {HTMLElement} ctx.stageWrap Stage wrapper; the countdown bar mounts here.
 * @param {{ show: (msg: string) => void }} ctx.edgeHintCtl
 * @param {() => any} ctx.getDeck Returns the deck controller (created later).
 * @returns {{ autoAdvance: any, syncProgressTime: () => void }}
 */
export function createPresenterAutoAdvanceUi({
  pres,
  autoAdvanceCfg,
  autoAdvanceEnabled,
  autoAdvanceMode,
  autoAdvanceBtn,
  progress,
  stageWrap,
  edgeHintCtl,
  getDeck,
}) {
  // Total deck time in progress area (visible when auto-advance is enabled)
  const progressTimeEl = h('div', {
    class: 'presenter-progress-time',
    text: '',
  });
  if (autoAdvanceEnabled) {
    progress.append(progressTimeEl);
  }
  const syncProgressTime = () => {
    if (!autoAdvanceEnabled) return;
    const deckCtl = getDeck();
    const slides =
      deckCtl?.getState?.()?.presentation?.slides || pres?.slides || [];
    const { formatted } = calculateDeckTime(
      slides,
      autoAdvanceCfg?.intervalSeconds || DEFAULT_ADVANCE_INTERVAL_SECONDS,
    );
    const st = deckCtl?.getState?.();
    const idx = (st?.idx ?? 0) + 1;
    const total = st?.slidesCount ?? slides.length;
    progressTimeEl.textContent = `${idx} / ${total} · ${formatted}`;
  };

  // Auto-advance countdown bar
  const autoAdvanceBarEl = h('div', { class: 'auto-advance-bar' });
  const autoAdvanceBarFill = h('div', { class: 'auto-advance-bar-fill' });
  autoAdvanceBarEl.append(autoAdvanceBarFill);
  // Only show bar if enabled + showCountdown
  autoAdvanceBarEl.hidden = !(
    autoAdvanceEnabled && autoAdvanceCfg?.showCountdown !== false
  );
  stageWrap.append(autoAdvanceBarEl);

  const autoAdvance = createAutoAdvance({
    onAdvance: () => getDeck()?.next?.(),
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
    onLoopComplete: () => getDeck()?.show?.(0),
    onTimerExpired: () => {
      // Pacing mode: show edge hint when timer runs out
      edgeHintCtl.show(t('presenter.timesUp', "Time's up"));
    },
  });

  // Wire up auto-advance button handlers (button created earlier, timer available now)
  const syncAutoAdvanceBtn = () => {
    const s = autoAdvance.getState();
    if (autoAdvanceMode === 'pacing') {
      autoAdvanceBtn.textContent =
        s === 'running'
          ? t('presenter.pacingPause', 'Pause timer')
          : t('presenter.pacingResume', 'Resume timer');
    } else {
      autoAdvanceBtn.textContent =
        s === 'running'
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
    const slides =
      getDeck()?.getState?.()?.presentation?.slides || pres?.slides || [];
    return getSlideEffectiveDuration(
      slides[idx],
      autoAdvanceCfg?.intervalSeconds || DEFAULT_ADVANCE_INTERVAL_SECONDS,
    );
  };

  if (autoAdvanceEnabled) {
    autoAdvance.configure({
      intervalSeconds:
        autoAdvanceCfg?.intervalSeconds || DEFAULT_ADVANCE_INTERVAL_SECONDS,
      loop: !!autoAdvanceCfg?.loop,
      mode: autoAdvanceMode,
      getSlideInterval,
    });
  }

  return { autoAdvance, syncProgressTime };
}
