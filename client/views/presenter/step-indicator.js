import { h } from '../../lib/dom.js';

/**
 * Create the remaining-build indicator renderer (the row of dots that shows how
 * many step-by-step builds are still to come on the current slide).
 *
 * Owns its own `lastStepTotal` cache so it only rebuilds the dot elements when
 * the total changes; otherwise it just re-toggles the on/complete state.
 *
 * @param {HTMLElement|null} stepIndicator - the indicator container (may be null).
 * @returns {(state?: { shown?: number, total?: number }) => void}
 */
export function createStepIndicatorRenderer(stepIndicator) {
  let lastStepTotal = -1;

  return function renderStepIndicator({ shown = 0, total = 0 } = {}) {
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
}
